// Préférence d'affichage « police dyslexie », mémorisée localement (aucune donnée envoyée).
const KEY = 'lbc-dys';
const btn = document.getElementById('dys-toggle');
function apply(on: boolean) {
  document.body.classList.toggle('dys', on);
  btn?.setAttribute('aria-pressed', String(on));
}
let on = false;
try { on = localStorage.getItem(KEY) === '1'; } catch { /* stockage indisponible */ }
apply(on);
btn?.addEventListener('click', () => {
  on = !on;
  apply(on);
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ignoré */ }
});
