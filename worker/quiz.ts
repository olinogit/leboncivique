// Logique pure du quiz, sans dépendance à Cloudflare : testable avec `node --test`.

export type Procedure = 'cr' | 'csp' | 'nat';
export type Mode = 'instant' | 'final';
export type Kind = 'knowledge' | 'situation';

export const PROCEDURES: readonly Procedure[] = ['cr', 'csp', 'nat'];
export const MODES: readonly Mode[] = ['instant', 'final'];
/** Tailles autorisées en mode libre. Pas de « toutes les questions » : cela faciliterait l'extraction. */
export const FREE_SIZES: readonly number[] = [10, 20, 30, 40];
/** Composition officielle de l'examen (arrêté du 10 octobre 2025) : 28 connaissances + 12 mises en situation. */
export const EXAM_KNOWLEDGE = 28;
export const EXAM_SITUATIONS = 12;
export const PASS_RATIO = 0.8; // 32/40

export interface PoolEntry {
  id: number;
  kind: Kind;
}

/** Une question de la partie : `p[k]` = index dans la banque de l'option affichée en position k. */
export interface Item {
  q: number;
  p: number[];
}

export type RandomInt = (maxExclusive: number) => number;

/** Entier aléatoire uniforme dans [0, max) avec rejet, à partir de crypto.getRandomValues. */
export const cryptoRandomInt: RandomInt = (max) => {
  if (!Number.isInteger(max) || max <= 0 || max > 2 ** 32) throw new RangeError('max invalide');
  const limit = Math.floor(2 ** 32 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const v = buf[0]!;
    if (v < limit) return v % max;
  }
};

export function shuffle<T>(input: readonly T[], rnd: RandomInt = cryptoRandomInt): T[] {
  const a = input.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function pickQuestionIds(
  pool: readonly PoolEntry[],
  opts: { exam: boolean; size: number },
  rnd: RandomInt = cryptoRandomInt,
): number[] {
  if (opts.exam) {
    const sit = shuffle(pool.filter((e) => e.kind === 'situation'), rnd).slice(0, EXAM_SITUATIONS);
    const know = shuffle(pool.filter((e) => e.kind === 'knowledge'), rnd).slice(0, EXAM_KNOWLEDGE);
    return shuffle([...know, ...sit], rnd).map((e) => e.id);
  }
  return shuffle(pool, rnd)
    .slice(0, opts.size)
    .map((e) => e.id);
}

export function makeItems(ids: readonly number[], optionCount = 4, rnd: RandomInt = cryptoRandomInt): Item[] {
  const base = Array.from({ length: optionCount }, (_, i) => i);
  return ids.map((q) => ({ q, p: shuffle(base, rnd) }));
}

/** Index affiché de la bonne réponse (la bonne réponse est l'option 0 en base). */
export function correctDisplayed(item: Item): number {
  return item.p.indexOf(0);
}

export function isCorrect(item: Item, displayedChoice: number): boolean {
  return item.p[displayedChoice] === 0;
}

export function displayedOptions(item: Item, options: readonly string[]): string[] {
  return item.p.map((i) => {
    const o = options[i];
    if (o === undefined) throw new Error(`option ${i} absente pour la question ${item.q}`);
    return o;
  });
}

/** Index de la première question sans réponse (= longueur si tout est répondu). */
export function firstUnanswered(answers: readonly (number | null)[]): number {
  const i = answers.indexOf(null);
  return i === -1 ? answers.length : i;
}

/** On ne peut voir la question i que si toutes les précédentes ont une réponse. */
export function canAccess(answers: readonly (number | null)[], i: number): boolean {
  return Number.isInteger(i) && i >= 0 && i < answers.length && i <= firstUnanswered(answers);
}

export function levelFor(pct: number): 'maitrise' | 'bon' | 'fragile' | 'lacune' {
  if (pct >= 85) return 'maitrise';
  if (pct >= 70) return 'bon';
  if (pct >= 50) return 'fragile';
  return 'lacune';
}
