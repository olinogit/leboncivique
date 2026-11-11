// Prépare la banque de questions pour D1, SANS jamais la publier dans le dépôt ni dans le site.
//
//   node scripts/build-seed.mjs <chemin/vers/questions.json>
//
// Sorties :
//   seed/questions.sql        → à charger avec : wrangler d1 execute leboncivique --remote --file seed/questions.sql
//                               (dossier ignoré par git)
//   src/data/exemples.json    → ~10 questions publiques par thème pour la page « Questions d'exemple » (SEO)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const src = process.argv[2];
if (!src) {
  console.error('Usage : node scripts/build-seed.mjs <questions.json>');
  process.exit(1);
}
const bank = JSON.parse(readFileSync(src, 'utf8'));

const THEMES = [
  'Principes et valeurs de la République',
  'Système institutionnel et politique',
  'Droits et devoirs',
  'Histoire, géographie et culture',
  'Vivre dans la société française',
];
const PROCS = new Set(['cr', 'csp', 'nat']);
const errors = [];
const ids = new Set();
for (const q of bank) {
  const where = `question ${q.id}`;
  if (!Number.isInteger(q.id) || ids.has(q.id)) errors.push(`${where} : id manquant ou en double`);
  ids.add(q.id);
  if (!THEMES.includes(q.theme)) errors.push(`${where} : thème inconnu « ${q.theme} »`);
  if (!Array.isArray(q.options) || q.options.length !== 4 || new Set(q.options).size !== 4)
    errors.push(`${where} : il faut 4 options distinctes`);
  if (!q.question?.trim() || !q.explanation?.trim()) errors.push(`${where} : texte ou explication vide`);
  if (q.type !== undefined && q.type !== 'situation') errors.push(`${where} : type inconnu`);
  if (!Array.isArray(q.procedures) || !q.procedures.length || q.procedures.some((p) => !PROCS.has(p)))
    errors.push(`${where} : procédures invalides`);
  if (q.source && !/^https:\/\//.test(q.source)) errors.push(`${where} : la source doit être une URL https`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

const sql = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const lines = ['DELETE FROM questions;'];
for (const q of bank) {
  lines.push(
    `INSERT INTO questions (id, theme, kind, procedures, text, options, explanation, source) VALUES (${q.id}, ${sql(q.theme)}, ${sql(
      q.type === 'situation' ? 'situation' : 'knowledge',
    )}, ${sql(`,${q.procedures.join(',')},`)}, ${sql(q.question)}, ${sql(JSON.stringify(q.options))}, ${sql(q.explanation)}, ${sql(
      q.source ?? null,
    )});`,
  );
}
mkdirSync('seed', { recursive: true });
writeFileSync('seed/questions.sql', lines.join('\n') + '\n');

// Questions d'exemple : sélection déterministe (régulièrement espacée) de 8 connaissances + 2 mises en situation par thème.
function spaced(list, n) {
  if (list.length <= n) return list;
  const step = list.length / n;
  return Array.from({ length: n }, (_, i) => list[Math.floor(i * step)]);
}
const exemples = [];
for (const theme of THEMES) {
  const inTheme = bank.filter((q) => q.theme === theme);
  const sit = spaced(inTheme.filter((q) => q.type === 'situation'), 2);
  const know = spaced(inTheme.filter((q) => q.type !== 'situation'), 10 - sit.length);
  for (const q of [...know, ...sit]) {
    exemples.push({
      theme,
      kind: q.type === 'situation' ? 'situation' : 'knowledge',
      text: q.question,
      // Ordre d'affichage figé mais pas « bonne réponse en premier » : rotation selon l'id.
      options: q.options.map((_, i) => q.options[(i + q.id) % 4]),
      answer: q.options[0],
      explanation: q.explanation,
      source: q.source ?? null,
    });
  }
}
writeFileSync('src/data/exemples.json', JSON.stringify(exemples, null, 2) + '\n');
console.log(`OK : ${bank.length} questions → seed/questions.sql ; ${exemples.length} exemples → src/data/exemples.json`);
