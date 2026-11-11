// Client du quiz : il ne connaît jamais la bonne réponse avant d'avoir répondu.
// Toute la logique de tirage et de correction est côté serveur (worker/index.ts).

type Mode = 'instant' | 'final';
interface Feedback { correct: boolean; correctIndex: number; explanation: string; source: string | null }
interface Question {
  i: number; total: number; theme: string; kind: 'knowledge' | 'situation';
  text: string; options: string[]; answered: number | null; feedback: Feedback | null;
}
interface Results {
  procedure: string; exam: boolean; total: number; answered: number; correct: number; pct: number;
  level: 'maitrise' | 'bon' | 'fragile' | 'lacune'; passed: boolean | null;
  themes: { theme: string; correct: number; total: number }[];
  review: { text: string; kind: string; theme: string; chosen: string; answer: string; correct: boolean; explanation: string; source: string | null }[];
}
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, o: Record<string, unknown>) => string;
      getResponse: (id: string) => string | undefined;
      reset: (id: string) => void;
    };
  }
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const root = $('quiz');
const LETTERS = ['A', 'B', 'C', 'D'];
const LEVELS = { maitrise: 'Maîtrisé', bon: 'Bon niveau', fragile: 'Fragile', lacune: 'À travailler' } as const;
const PROC = { csp: 'Carte de séjour pluriannuelle', cr: 'Carte de résident', nat: 'Naturalisation' } as Record<string, string>;
const PROC_SHORT = { csp: 'Carte de séjour pluriannuelle (CSP)', cr: 'Carte de résident (CR)', nat: 'Naturalisation' } as Record<string, string>;

const state = {
  mode: 'instant' as Mode,
  exam: false,
  total: 0,
  q: null as Question | null,
  busy: false,
  deadline: 0,
  timer: 0 as number | undefined,
  results: null as Results | null,
};

class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: unknown = null;
  try { data = await res.json(); } catch { /* corps vide */ }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; message?: string };
    throw new ApiError(res.status, d.error ?? 'http', d.message ?? `Erreur ${res.status}`);
  }
  return data as T;
}

function show(screen: 'setup' | 'quiz' | 'results') {
  $('screen-setup').hidden = screen !== 'setup';
  $('screen-quiz').hidden = screen !== 'quiz';
  $('screen-results').hidden = screen !== 'results';
}

function setError(id: string, msg: string | null) {
  const el = $(id);
  el.textContent = msg ?? '';
  el.hidden = !msg;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const k of kids) e.append(k);
  return e;
}

function sourceLink(src: string | null): HTMLElement | null {
  if (!src) return null;
  let url: URL;
  try { url = new URL(src); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  const a = el('a', { href: url.href, rel: 'noopener', target: '_blank' }, 'Voir la fiche officielle');
  return el('p', { className: 'hint' }, a);
}

// ------------------------------------------------------------- Turnstile

let widgetId: string | null = null;
function initTurnstile() {
  const box = $('ts');
  const tryRender = () => {
    if (!window.turnstile) return false;
    widgetId = window.turnstile.render(box, {
      sitekey: root.dataset.sitekey,
      action: 'start_quiz',
      appearance: 'interaction-only',
      language: 'fr',
    });
    return true;
  };
  if (tryRender()) return;
  const iv = window.setInterval(() => { if (tryRender()) window.clearInterval(iv); }, 200);
  window.setTimeout(() => window.clearInterval(iv), 15000);
}

// ----------------------------------------------------------------- setup

const form = $<HTMLFormElement>('setup-form');
form.addEventListener('change', () => {
  $('size-block').hidden = (new FormData(form).get('exam') as string) === '1';
});

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (state.busy) return;
  setError('setup-error', null);
  const fd = new FormData(form);
  const token = widgetId && window.turnstile ? window.turnstile.getResponse(widgetId) : undefined;
  if (!token) {
    setError('setup-error', 'La vérification anti-robot n’est pas encore terminée. Patientez quelques secondes puis réessayez.');
    return;
  }
  state.busy = true;
  $<HTMLButtonElement>('start-btn').disabled = true;
  try {
    const exam = fd.get('exam') === '1';
    const s = await api<{ total: number; procedure: string; mode: Mode; exam: boolean; durationS: number | null }>('/api/session', {
      procedure: fd.get('procedure'),
      mode: fd.get('mode'),
      exam,
      size: Number(fd.get('size')),
      turnstile: token,
    });
    state.mode = s.mode;
    state.exam = s.exam;
    state.total = s.total;
    state.results = null;
    $('q-proc').textContent = PROC_SHORT[s.procedure] ?? PROC[s.procedure] ?? '';
    $('q-kind').textContent = s.exam ? `Examen blanc · ${s.total} questions` : `Série d'entraînement · ${s.total} questions`;
    startTimer(s.durationS);
    show('quiz');
    await load(0);
  } catch (e) {
    setError('setup-error', e instanceof Error ? e.message : 'Erreur inattendue.');
  } finally {
    state.busy = false;
    $<HTMLButtonElement>('start-btn').disabled = false;
    if (widgetId && window.turnstile) window.turnstile.reset(widgetId);
  }
});

// ----------------------------------------------------------------- timer

function startTimer(durationS: number | null) {
  window.clearInterval(state.timer);
  const t = $('q-timer');
  if (!durationS) { t.hidden = true; return; }
  state.deadline = Date.now() + durationS * 1000;
  t.hidden = false;
  let warned = false;
  const tick = () => {
    const left = Math.max(0, Math.round((state.deadline - Date.now()) / 1000));
    t.textContent = `Temps restant : ${Math.floor(left / 60)} min ${String(left % 60).padStart(2, '0')} s`;
    t.classList.toggle('low', left <= 300);
    if (left <= 300 && !warned) {
      warned = true;
      t.setAttribute('aria-live', 'assertive');
      t.textContent = `Attention, il reste 5 minutes. ${t.textContent}`;
      window.setTimeout(() => t.setAttribute('aria-live', 'off'), 2000);
    }
    if (left === 0) { window.clearInterval(state.timer); void finish(); }
  };
  tick();
  state.timer = window.setInterval(tick, 1000);
}

// -------------------------------------------------------------- question

async function load(i: number) {
  setError('q-error', null);
  try {
    state.q = await api<Question>(`/api/question?i=${i}`);
    render();
  } catch (e) {
    handleQuizError(e);
  }
}

function render() {
  const q = state.q!;
  $('q-progress').textContent = `Question ${q.i + 1} sur ${q.total}`;
  $('q-bar').style.width = `${(q.i / q.total) * 100}%`;
  $('q-theme').textContent = q.theme;
  $('q-sit').hidden = q.kind !== 'situation';
  $('q-text').textContent = q.text;

  const list = $('q-options');
  list.replaceChildren(
    ...q.options.map((text, k) => {
      const b = el('button', { type: 'button', className: 'option' }, el('span', { className: 'letter' }, LETTERS[k] ?? '?'), el('span', {}, text));
      b.dataset.k = String(k);
      b.addEventListener('click', () => void choose(k));
      return el('li', {}, b);
    }),
  );
  paintAnswer();
  $<HTMLButtonElement>('prev-btn').disabled = q.i === 0;
  $('next-btn').textContent = q.i === q.total - 1 ? 'Voir mon résultat' : 'Suivante';
  $('q-text').focus();
}

function paintAnswer() {
  const q = state.q!;
  const buttons = [...$('q-options').querySelectorAll<HTMLButtonElement>('button.option')];
  const fb = $('q-feedback');
  fb.replaceChildren();
  const locked = q.answered !== null && state.mode === 'instant';
  buttons.forEach((b, k) => {
    b.classList.remove('chosen', 'good', 'bad');
    b.querySelector('.verdict')?.remove();
    b.setAttribute('aria-disabled', String(locked));
    b.setAttribute('aria-pressed', String(q.answered === k));
    if (q.answered === null) return;
    if (state.mode === 'final') { if (k === q.answered) b.classList.add('chosen'); return; }
    const f = q.feedback!;
    if (k === f.correctIndex) { b.classList.add('good'); b.append(el('span', { className: 'verdict' }, 'Bonne réponse')); }
    else if (k === q.answered) { b.classList.add('bad'); b.append(el('span', { className: 'verdict' }, 'Votre réponse')); }
  });
  $<HTMLButtonElement>('next-btn').disabled = q.answered === null;

  if (q.answered === null) return;
  if (state.mode === 'final') {
    fb.append(el('p', { className: 'hint' }, 'Réponse enregistrée. Vous pouvez encore la modifier ; la correction sera dans le bilan.'));
    return;
  }
  const f = q.feedback!;
  const box = el('div', { className: `feedback ${f.correct ? 'good' : 'bad'}` },
    el('p', { className: 'head' }, f.correct ? 'Bonne réponse !' : 'Ce n’est pas la bonne réponse.'),
  );
  if (!f.correct) box.append(el('p', {}, el('b', {}, 'La bonne réponse : '), q.options[f.correctIndex] ?? ''));
  box.append(el('p', {}, f.explanation));
  const link = sourceLink(f.source);
  if (link) box.append(link);
  fb.append(box);
}

async function choose(k: number) {
  const q = state.q;
  if (!q || state.busy) return;
  if (q.answered !== null && state.mode === 'instant') return;
  state.busy = true;
  setError('q-error', null);
  try {
    const r = await api<{ saved: boolean; feedback?: Feedback }>('/api/answer', { i: q.i, choice: k });
    q.answered = k;
    q.feedback = r.feedback ?? null;
    paintAnswer();
  } catch (e) {
    if (e instanceof ApiError && e.code === 'too_fast') setError('q-error', 'Prenez le temps de lire la question avant de répondre.');
    else handleQuizError(e);
  } finally {
    state.busy = false;
  }
}

function handleQuizError(e: unknown) {
  if (e instanceof ApiError && (e.code === 'no_session' || e.code === 'finished')) {
    window.clearInterval(state.timer);
    show('setup');
    setError('setup-error', e.message);
    return;
  }
  setError('q-error', e instanceof Error ? e.message : 'Erreur inattendue.');
}

$('next-btn').addEventListener('click', () => {
  const q = state.q;
  if (!q || q.answered === null) return;
  if (q.i < q.total - 1) void load(q.i + 1);
  else void finish();
});
$('prev-btn').addEventListener('click', () => { if (state.q && state.q.i > 0) void load(state.q.i - 1); });

// ----------------------------------------------------------------- arrêt

const dialog = $<HTMLDialogElement>('stop-dialog');
$('stop-btn').addEventListener('click', () => {
  $('stop-text').textContent = 'Votre bilan portera uniquement sur les questions auxquelles vous avez déjà répondu.';
  dialog.showModal();
});
$('stop-resume').addEventListener('click', () => dialog.close());
$('stop-results').addEventListener('click', () => { dialog.close(); void finish(); });
$('stop-quit').addEventListener('click', () => { dialog.close(); window.clearInterval(state.timer); show('setup'); });

// ----------------------------------------------------------------- bilan

async function finish() {
  window.clearInterval(state.timer);
  try {
    const r = await api<Results>('/api/finish', {});
    state.results = r;
    renderResults(r);
    show('results');
    $('r-title').focus();
  } catch (e) {
    handleQuizError(e);
  }
}

function renderResults(r: Results) {
  $('r-score').textContent = `${r.correct} / ${r.answered}`;
  $('r-sub').textContent = `${r.pct} % de bonnes réponses · ${PROC[r.procedure] ?? ''} · Niveau : ${LEVELS[r.level]}`;
  const v = $('r-verdict');
  v.className = '';
  if (r.passed === null) v.textContent = 'À l’examen, il faut au moins 80 % de bonnes réponses (32 sur 40).';
  else if (r.passed) { v.className = 'verdict-pass'; v.textContent = 'Examen blanc réussi : vous avez au moins 32 bonnes réponses sur 40.'; }
  else { v.className = 'verdict-fail'; v.textContent = `Examen blanc non réussi : il faut au moins 32 bonnes réponses sur 40. Continuez à vous entraîner !`; }

  $('r-themes').replaceChildren(
    ...r.themes.map((t) => {
      const pct = Math.round((t.correct / t.total) * 100);
      const bar = el('div', { className: 'bar' }, el('i'));
      (bar.firstChild as HTMLElement).style.width = `${pct}%`;
      bar.setAttribute('aria-hidden', 'true');
      return el('div', { className: 'theme-row' }, el('b', {}, t.theme), bar, el('span', { className: 'hint' }, `${t.correct} sur ${t.total} (${pct} %)`));
    }),
  );

  $('r-review').replaceChildren(
    ...r.review.map((it) => {
      const li = el('li', { className: it.correct ? 'ok' : 'ko' },
        el('p', {}, el('b', {}, `${it.correct ? '✓ ' : '✗ '}${it.text}`)),
      );
      li.dataset.state = it.correct ? 'ok' : 'ko';
      if (!it.correct) li.append(el('p', {}, `Votre réponse : ${it.chosen}`));
      li.append(el('p', {}, el('b', {}, `Bonne réponse : ${it.answer}`)), el('p', {}, it.explanation));
      const link = sourceLink(it.source);
      if (link) li.append(link);
      return li;
    }),
  );
  filter('all');
}

function filter(f: string) {
  document.querySelectorAll<HTMLButtonElement>('.filters button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === f)));
  $('r-review').querySelectorAll<HTMLElement>('li').forEach((li) => { li.hidden = f !== 'all' && li.dataset.state !== f; });
}
document.querySelectorAll<HTMLButtonElement>('.filters button').forEach((b) => b.addEventListener('click', () => filter(b.dataset.filter ?? 'all')));
$('restart-btn').addEventListener('click', () => { show('setup'); $('setup-title').focus(); });

// ------------------------------------------------------------------- PDF

$('pdf-btn').addEventListener('click', async () => {
  const r = state.results;
  if (!r) return;
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const X = 18;
  let y = 22;
  doc.setFillColor(31, 78, 121);
  doc.rect(0, 0, W, 4, 'F');
  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(31, 78, 121).text('LE BON CIVIQUE · ENTRAÎNEMENT À L’EXAMEN CIVIQUE', X, y);
  y += 10;
  doc.setFontSize(20).setTextColor(29, 39, 56).text(r.exam ? 'Résultat de l’examen blanc' : 'Résultat du quiz', X, y);
  y += 8;
  const date = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(70, 80, 106).text(`${PROC[r.procedure] ?? ''} · ${date}`, X, y);
  y += 14;
  doc.setFont('helvetica', 'bold').setFontSize(30).setTextColor(31, 78, 121).text(`${r.correct} / ${r.answered}`, X, y);
  doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(70, 80, 106).text(`${r.pct} % de bonnes réponses · Niveau : ${LEVELS[r.level]}`, X, y + 8);
  if (r.passed !== null) doc.text(r.passed ? 'Seuil de 32/40 atteint.' : 'Seuil de 32/40 non atteint.', X, y + 15);
  y += 28;
  doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(29, 39, 56).text('Détail par thème', X, y);
  y += 9;
  for (const t of r.themes) {
    const pct = Math.round((t.correct / t.total) * 100);
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(29, 39, 56).text(t.theme, X, y);
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(70, 80, 106).text(`${t.correct}/${t.total} (${pct} %)`, W - X, y, { align: 'right' });
    y += 4;
    doc.setFillColor(221, 214, 196).rect(X, y, W - 2 * X, 3, 'F');
    doc.setFillColor(31, 107, 69).rect(X, y, (W - 2 * X) * (pct / 100), 3, 'F');
    y += 11;
  }
  doc.setFont('helvetica', 'italic').setFontSize(8.5).setTextColor(120, 120, 120);
  doc.text(doc.splitTextToSize('Outil de révision indépendant et non officiel (leboncivique.fr). Ce document n’a aucune valeur administrative.', W - 2 * X), X, y + 4);
  doc.save(`resultat-examen-civique-${new Date().toISOString().slice(0, 10)}.pdf`);
});

initTurnstile();

export {};
