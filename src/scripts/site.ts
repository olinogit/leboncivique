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

// Menu burger (mobile)
const header = document.querySelector<HTMLElement>('.site-header');
const toggle = document.getElementById('menu-toggle');
function setMenu(open: boolean) {
  header?.classList.toggle('open', open);
  toggle?.setAttribute('aria-expanded', String(open));
  const label = open ? toggle?.dataset.labelClose : toggle?.dataset.labelOpen;
  if (label) toggle?.setAttribute('aria-label', label);
}
toggle?.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && toggle?.getAttribute('aria-expanded') === 'true') { setMenu(false); toggle.focus(); }
});
window.matchMedia('(min-width: 900px)').addEventListener('change', (e) => { if (e.matches) setMenu(false); });
