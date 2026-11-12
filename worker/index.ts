// API du quiz Le bon civique (Cloudflare Workers + D1).
//
// Principe : la banque de questions ne quitte jamais le serveur en bloc.
//  - POST /api/session  crée une partie (Turnstile obligatoire, limité par IP)
//  - GET  /api/question?i=N  renvoie UNE question, sans la bonne réponse
//  - POST /api/answer   enregistre la réponse ; en mode « instant », renvoie la correction
//  - POST /api/finish   clôt la partie et renvoie le bilan (questions de CETTE partie uniquement)
// Les options sont mélangées par partie : l'index affiché ne révèle rien d'une partie à l'autre.

import {
  EXAM_KNOWLEDGE,
  EXAM_SITUATIONS,
  FREE_SIZES,
  MODES,
  PASS_RATIO,
  PROCEDURES,
  canAccess,
  correctDisplayed,
  displayedOptions,
  isCorrect,
  levelFor,
  makeItems,
  pickQuestionIds,
  type Item,
  type Kind,
  type Mode,
  type Procedure,
} from './quiz.ts';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Secret Turnstile (wrangler secret put TURNSTILE_SECRET). */
  TURNSTILE_SECRET?: string;
  /** Clé HMAC pour hacher les IP (wrangler secret put IP_HASH_KEY). */
  IP_HASH_KEY?: string;
  /** "production" ou "development". En développement seulement, Turnstile peut être absent. */
  ENVIRONMENT?: string;
  /** Origines autorisées pour les requêtes POST, séparées par des virgules. */
  ALLOWED_ORIGINS?: string;
  SESSIONS_PER_HOUR?: string;
  SESSIONS_PER_DAY?: string;
  REQUESTS_PER_MINUTE?: string;
}

const COOKIE = '__Host-lbc_sid';
const SESSION_TTL_S = 2 * 60 * 60;
const MIN_ANSWER_DELAY_MS = 700;
const MAX_BODY = 2048;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const API_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Robots-Tag': 'noindex, nofollow',
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...API_HEADERS, ...extra } });
}

function int(v: string | undefined, fallback: number): number {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function isDev(env: Env): boolean {
  return env.ENVIRONMENT === 'development';
}

// ---------------------------------------------------------------- utilitaires

function randomId(bytes = 18): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacHex(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)]
    .slice(0, 16)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}

function clientIp(req: Request): string {
  return req.headers.get('CF-Connecting-IP') ?? '0.0.0.0';
}

/** Empreinte d'IP non réversible, qui change chaque jour (aucune IP en clair n'est stockée). */
async function ipFingerprint(req: Request, env: Env): Promise<string> {
  const key = env.IP_HASH_KEY;
  if (!key) {
    if (isDev(env)) return 'dev';
    throw new HttpError(500, 'config', 'Configuration serveur incomplète.');
  }
  const day = new Date().toISOString().slice(0, 10);
  return hmacHex(key, `${day}|${clientIp(req)}`);
}

function getCookie(req: Request, name: string): string | null {
  const header = req.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function sessionCookie(id: string): string {
  return `${COOKIE}=${id}; Path=/; Max-Age=${SESSION_TTL_S}; HttpOnly; Secure; SameSite=Strict`;
}

/** Protection CSRF : JSON obligatoire, origine identique, corps limité. */
async function readJson(req: Request, env: Env): Promise<Record<string, unknown>> {
  const origin = req.headers.get('Origin');
  const self = new URL(req.url).origin;
  const allowed = new Set([self, ...(env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)]);
  if (!origin || !allowed.has(origin)) throw new HttpError(403, 'origin', 'Origine refusée.');
  const site = req.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin') throw new HttpError(403, 'origin', 'Origine refusée.');
  if (!(req.headers.get('Content-Type') ?? '').startsWith('application/json')) {
    throw new HttpError(415, 'content_type', 'Format attendu : JSON.');
  }
  const len = Number(req.headers.get('Content-Length') ?? '0');
  if (len > MAX_BODY) throw new HttpError(413, 'too_large', 'Requête trop volumineuse.');
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'too_large', 'Requête trop volumineuse.');
  try {
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'bad_json', 'JSON invalide.');
  }
}

// ------------------------------------------------------- limitation de débit

async function hit(env: Env, key: string, windowS: number, limit: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const win = Math.floor(now / windowS);
  const row = await env.DB.prepare(
    'INSERT INTO rate_limits (k, n, exp) VALUES (?1, 1, ?2) ON CONFLICT (k) DO UPDATE SET n = n + 1 RETURNING n',
  )
    .bind(`${key}:${windowS}:${win}`, (win + 1) * windowS)
    .first<{ n: number }>();
  if (row && row.n > limit) {
    throw new HttpError(429, 'rate_limited', 'Trop de demandes. Réessayez un peu plus tard.');
  }
}

// ---------------------------------------------------------------- Turnstile

async function verifyTurnstile(req: Request, env: Env, token: unknown): Promise<void> {
  if (!env.TURNSTILE_SECRET) {
    if (isDev(env)) return;
    throw new HttpError(500, 'config', 'Configuration serveur incomplète.');
  }
  if (typeof token !== 'string' || token.length < 10 || token.length > 2048) {
    throw new HttpError(403, 'captcha', 'Vérification anti-robot requise.');
  }
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  form.append('remoteip', clientIp(req));
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const out = (await r.json()) as { success?: boolean; action?: string; hostname?: string };
  const host = new URL(req.url).hostname;
  // Les clés de test Turnstile ne renvoient ni l'action ni le bon nom d'hôte : contrôle strict hors développement.
  const strict = !isDev(env);
  if (!out.success || (strict && (out.action !== 'start_quiz' || out.hostname !== host))) {
    throw new HttpError(403, 'captcha', 'Vérification anti-robot échouée.');
  }
}

// ------------------------------------------------------------------ sessions

interface SessionRow {
  id: string;
  expires_at: number;
  procedure: Procedure;
  mode: Mode;
  exam: number;
  items: string;
  answers: string;
  finished: number;
  last_at: number;
}

interface Session {
  row: SessionRow;
  items: Item[];
  answers: (number | null)[];
}

async function loadSession(req: Request, env: Env): Promise<Session> {
  const id = getCookie(req, COOKIE);
  if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) throw new HttpError(401, 'no_session', 'Aucune partie en cours.');
  const row = await env.DB.prepare('SELECT * FROM sessions WHERE id = ?1').bind(id).first<SessionRow>();
  if (!row || row.expires_at < Math.floor(Date.now() / 1000)) {
    throw new HttpError(401, 'no_session', 'Partie expirée. Commencez-en une nouvelle.');
  }
  return { row, items: JSON.parse(row.items) as Item[], answers: JSON.parse(row.answers) as (number | null)[] };
}

interface QuestionRow {
  id: number;
  theme: string;
  kind: Kind;
  text: string;
  options: string;
  explanation: string;
  source: string | null;
}

async function loadQuestions(env: Env, ids: number[]): Promise<Map<number, QuestionRow>> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map((_, i) => `?${i + 1}`).join(',');
  const { results } = await env.DB.prepare(
    `SELECT id, theme, kind, text, options, explanation, source FROM questions WHERE id IN (${placeholders})`,
  )
    .bind(...ids)
    .all<QuestionRow>();
  return new Map(results.map((r) => [r.id, r]));
}

function correction(item: Item, q: QuestionRow, choice: number) {
  return {
    correct: isCorrect(item, choice),
    correctIndex: correctDisplayed(item),
    explanation: q.explanation,
    source: q.source,
  };
}

// ---------------------------------------------------------------- handlers

async function createSession(req: Request, env: Env): Promise<Response> {
  const body = await readJson(req, env);
  const fp = await ipFingerprint(req, env);
  await hit(env, `s:${fp}`, 3600, int(env.SESSIONS_PER_HOUR, 8));
  await hit(env, `s:${fp}`, 86400, int(env.SESSIONS_PER_DAY, 20));

  const procedure = body.procedure as Procedure;
  const mode = body.mode as Mode;
  const exam = body.exam === true;
  const size = exam ? EXAM_KNOWLEDGE + EXAM_SITUATIONS : Number(body.size);
  if (!PROCEDURES.includes(procedure)) throw new HttpError(400, 'bad_input', 'Démarche inconnue.');
  if (!MODES.includes(mode)) throw new HttpError(400, 'bad_input', 'Mode inconnu.');
  if (!exam && !FREE_SIZES.includes(size)) throw new HttpError(400, 'bad_input', 'Nombre de questions invalide.');

  await verifyTurnstile(req, env, body.turnstile);

  const { results: pool } = await env.DB.prepare('SELECT id, kind FROM questions WHERE instr(procedures, ?1) > 0')
    .bind(`,${procedure},`)
    .all<{ id: number; kind: Kind }>();
  const ids = pickQuestionIds(pool, { exam, size });
  if (ids.length === 0) throw new HttpError(503, 'empty_bank', 'Banque de questions indisponible.');
  const items = makeItems(ids);

  const id = randomId();
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    'INSERT INTO sessions (id, created_at, expires_at, procedure, mode, exam, items, answers, finished, last_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9)',
  )
    .bind(id, now, now + SESSION_TTL_S, procedure, mode, exam ? 1 : 0, JSON.stringify(items), JSON.stringify(items.map(() => null)), Date.now())
    .run();

  return json({ total: items.length, procedure, mode, exam, durationS: exam ? 45 * 60 : null }, 201, {
    'Set-Cookie': sessionCookie(id),
  });
}

async function getQuestion(req: Request, env: Env): Promise<Response> {
  const s = await loadSession(req, env);
  if (s.row.finished) throw new HttpError(409, 'finished', 'Partie terminée.');
  const i = Number(new URL(req.url).searchParams.get('i'));
  if (!canAccess(s.answers, i)) throw new HttpError(403, 'locked', 'Répondez d’abord aux questions précédentes.');
  const item = s.items[i]!;
  const q = (await loadQuestions(env, [item.q])).get(item.q);
  if (!q) throw new HttpError(500, 'missing', 'Question introuvable.');

  await env.DB.prepare('UPDATE sessions SET last_at = ?1 WHERE id = ?2').bind(Date.now(), s.row.id).run();

  const answered = s.answers[i] ?? null;
  return json({
    i,
    total: s.items.length,
    theme: q.theme,
    kind: q.kind,
    text: q.text,
    options: displayedOptions(item, JSON.parse(q.options) as string[]),
    answered,
    feedback: answered !== null && s.row.mode === 'instant' ? correction(item, q, answered) : null,
  });
}

async function postAnswer(req: Request, env: Env): Promise<Response> {
  const body = await readJson(req, env);
  const s = await loadSession(req, env);
  if (s.row.finished) throw new HttpError(409, 'finished', 'Partie terminée.');
  const i = Number(body.i);
  const choice = Number(body.choice);
  if (!canAccess(s.answers, i)) throw new HttpError(403, 'locked', 'Question non disponible.');
  if (!Number.isInteger(choice) || choice < 0 || choice >= s.items[i]!.p.length) {
    throw new HttpError(400, 'bad_input', 'Réponse invalide.');
  }
  // En mode correction immédiate, une réponse corrigée ne peut plus être modifiée.
  if (s.row.mode === 'instant' && s.answers[i] !== null) throw new HttpError(409, 'already', 'Réponse déjà corrigée.');
  // Un humain ne répond pas en moins de 0,7 s après l'affichage de la question.
  if (Date.now() - s.row.last_at < MIN_ANSWER_DELAY_MS) throw new HttpError(429, 'too_fast', 'Réponse trop rapide.');

  s.answers[i] = choice;
  await env.DB.prepare('UPDATE sessions SET answers = ?1 WHERE id = ?2').bind(JSON.stringify(s.answers), s.row.id).run();

  if (s.row.mode === 'final') return json({ saved: true });
  const item = s.items[i]!;
  const q = (await loadQuestions(env, [item.q])).get(item.q)!;
  return json({ saved: true, feedback: correction(item, q, choice) });
}

async function finish(req: Request, env: Env): Promise<Response> {
  await readJson(req, env);
  const s = await loadSession(req, env);
  const questions = await loadQuestions(env, s.items.map((it) => it.q));

  const review: unknown[] = [];
  const byTheme = new Map<string, { correct: number; total: number }>();
  let correct = 0;
  s.items.forEach((item, i) => {
    const choice = s.answers[i];
    if (choice === null || choice === undefined) return;
    const q = questions.get(item.q);
    if (!q) return;
    const opts = displayedOptions(item, JSON.parse(q.options) as string[]);
    const ok = isCorrect(item, choice);
    if (ok) correct++;
    const t = byTheme.get(q.theme) ?? { correct: 0, total: 0 };
    t.total++;
    if (ok) t.correct++;
    byTheme.set(q.theme, t);
    review.push({
      text: q.text,
      kind: q.kind,
      theme: q.theme,
      chosen: opts[choice],
      answer: opts[correctDisplayed(item)],
      correct: ok,
      explanation: q.explanation,
      source: q.source,
    });
  });

  if (!s.row.finished) {
    await env.DB.prepare('UPDATE sessions SET finished = 1 WHERE id = ?1').bind(s.row.id).run();
  }
  const answered = review.length;
  const pct = answered ? Math.round((correct / answered) * 100) : 0;
  return json({
    procedure: s.row.procedure,
    exam: s.row.exam === 1,
    total: s.items.length,
    answered,
    correct,
    pct,
    level: levelFor(pct),
    passed: s.row.exam === 1 ? correct >= Math.ceil(s.items.length * PASS_RATIO) : null,
    themes: [...byTheme.entries()].map(([theme, v]) => ({ theme, ...v })),
    review,
  });
}

async function handleApi(req: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(req.url);
  try {
    const fp = await ipFingerprint(req, env);
    await hit(env, `r:${fp}`, 60, int(env.REQUESTS_PER_MINUTE, 90));

    if (pathname === '/api/session' && req.method === 'POST') return await createSession(req, env);
    if (pathname === '/api/question' && req.method === 'GET') return await getQuestion(req, env);
    if (pathname === '/api/answer' && req.method === 'POST') return await postAnswer(req, env);
    if (pathname === '/api/finish' && req.method === 'POST') return await finish(req, env);
    throw new HttpError(404, 'not_found', 'Ressource inconnue.');
  } catch (e) {
    if (e instanceof HttpError) {
      return json({ error: e.code, message: e.message }, e.status, e.status === 429 ? { 'Retry-After': '60' } : {});
    }
    console.error('api_error', pathname, e instanceof Error ? e.message : 'unknown');
    return json({ error: 'server', message: 'Erreur interne.' }, 500);
  }
}

export default {
  async fetch(req, env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname.startsWith('/api/')) return handleApi(req, env);
    return env.ASSETS.fetch(req);
  },

  // Purge quotidienne des parties expirées et des compteurs périmés.
  async scheduled(_event, env): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?1').bind(now),
      env.DB.prepare('DELETE FROM rate_limits WHERE exp < ?1').bind(now),
    ]);
  },
} satisfies ExportedHandler<Env>;
