// Animation « Comment marche le quiz ? » (composant QuizExplainer.astro).
// Une seule horloge : chaque élément reçoit une piste Web Animations couvrant toute la durée D,
// toutes en pause ; on règle currentTime à chaque image. Pas d'innerHTML, pas de style en ligne
// dans le HTML : compatible avec la CSP du site (Trusted Types, style-src 'self').
// Accessibilité : bouton pause (WCAG 2.2.2), lecture figée si « animations réduites »,
// pause automatique hors de l'écran ou onglet masqué.

const D = 35.6;
const SCENES: [string, number, number][] = [
  ['intro', 0, 3.2], ['choose', 3.2, 10.8], ['answer', 10.8, 17.2], ['situation', 17.2, 22.4],
  ['results', 22.4, 29], ['pdf', 29, 32.2], ['cta', 32.2, 35.6],
];
const FORMATS = { portrait: [1080, 1220], wide: [1920, 940] } as const;
type Format = keyof typeof FORMATS;
type KF = Record<string, string | number>;
type Frame = [number, KF, string?];
const STILL = 26.2; // image affichée à l'arrêt : l'écran « Résultat »

function timeline(st: HTMLElement): (t: number) => void {
  const $ = (k: string) => st.querySelector<HTMLElement>(`[data-k="${k}"]`);
  const anims: Animation[] = [];
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  function track(el: Element | null, frames: Frame[]) {
    if (!el) return;
    const kf: Keyframe[] = [];
    if (frames[0][0] > 0) kf.push({ ...frames[0][1], offset: 0 });
    for (const [t, p, e] of frames) kf.push({ ...p, offset: clamp(t / D), easing: e || 'cubic-bezier(.4,0,.2,1)' });
    if (frames[frames.length - 1][0] < D) kf.push({ ...frames[frames.length - 1][1], offset: 1 });
    const a = el.animate(kf, { duration: D * 1000, fill: 'both' });
    a.pause();
    anims.push(a);
  }
  const H = (o: number, y: number, s = 1): KF => ({ opacity: o, transform: `translateY(${y}px) scale(${s})` });
  function show(el: Element | null, a: number, b: number, dy = 30, dur = 0.45) {
    const f: Frame[] = [];
    if (a > 0) f.push([a, H(0, dy)], [a + dur, H(1, 0)]); else f.push([0, H(1, 0)]);
    if (b < D) f.push([b - 0.35, H(1, 0)], [b, H(0, -dy)]); else f.push([D - 0.3, H(1, 0)], [D, H(0, 0)]);
    track(el, f);
  }
  const pop = (el: Element | null, t: number, dy = 24) => track(el, [[t, H(0, dy, 0.96)], [t + 0.4, H(1, 0, 1), 'linear']]);

  for (const [id, a, b] of SCENES) {
    show($('s-' + id), a, b, 40);
    show($('h-' + id), a, b, 24);
    show($('u-' + id), a + 0.1, b, 16);
  }
  track($('prog'), [[0, { transform: 'scaleX(0)' }, 'linear'], [D, { transform: 'scaleX(1)' }]]);

  // Accroche
  track($('ilogo'), [[0, { transform: 'scale(.6) rotate(-8deg)', opacity: 0 }, 'cubic-bezier(.3,1.5,.5,1)'], [0.7, { transform: 'scale(1) rotate(0)', opacity: 1 }]]);
  pop($('it'), 0.5); pop($('ch1'), 1.0); pop($('ch2'), 1.25); pop($('ch3'), 1.5);

  const sel = (el: Element | null, t: number) => track(el, [[t, { borderColor: '#e4e6ea', boxShadow: 'inset 0 0 0 0 #1e1e1e' }], [t + 0.15, { borderColor: '#1e1e1e', boxShadow: 'inset 0 0 0 1px #1e1e1e' }]]);
  const press = (el: Element | null, t: number) => track(el, [[t - 0.05, { transform: 'scale(1)' }], [t + 0.05, { transform: 'scale(.95)' }], [t + 0.25, { transform: 'scale(1)' }]]);
  function mark(id: string, t: number, ok: boolean) {
    const bg = ok ? '#eef6e5' : '#fdeeed', line = ok ? '#5d8f22' : '#d4544c', dot = ok ? '#3f6f12' : '#b3261e';
    track($(id), [[t, { background: '#fff', borderColor: '#e4e6ea' }], [t + 0.2, { background: bg, borderColor: line }]]);
    track($(id + '-dot'), [[t, { opacity: 0, background: dot }], [t + 0.2, { opacity: 1, background: dot }]]);
    track($(id + '-st'), [[t + 0.1, { opacity: 0, color: dot }], [t + 0.35, { opacity: 1, color: dot }]]);
  }

  // Curseur : déplacements et clics (positions mesurées dans la mise en page courante)
  const inner = st.querySelector<HTMLElement>('.lbc-inner')!;
  function pos(el: HTMLElement): [number, number] {
    let x = el.offsetWidth * 0.5, y = el.offsetHeight * 0.5;
    let n: HTMLElement | null = el;
    while (n && n !== inner) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent as HTMLElement | null; }
    return [x, y];
  }
  const clicks: [number, string][] = [[4.6, 'c2'], [5.8, 't1'], [7.1, 'k1'], [8.6, 'go'], [12.3, 'a3'], [18.7, 's2'], [26.6, 'p1'], [29.9, 'dl']];
  let prev: [number, number] = [840, 660];
  const tr = (p: [number, number], s: number): KF => ({ transform: `translate(${p[0] - 8}px,${p[1] - 6}px) scale(${s})` });
  const cf: Frame[] = [[3.3, tr(prev, 1)]];
  const rf: Frame[] = [[0, { opacity: 0, transform: 'scale(.3)' }]];
  for (const [t, k] of clicks) {
    const el = $(k);
    if (!el) continue;
    const p = pos(el);
    if (['c2', 't1', 'k1', 'p1'].includes(k)) p[0] -= el.offsetWidth * 0.2;
    if (/^[as]\d/.test(k)) p[0] -= el.offsetWidth * 0.22;
    const last = cf[cf.length - 1][0];
    cf.push([Math.max(last + 0.01, t - 0.85), tr(prev, 1)], [t - 0.1, tr(p, 1)], [t, tr(p, 0.82)], [t + 0.16, tr(p, 1)]);
    const at = (s: number) => `translate(${p[0]}px,${p[1]}px) scale(${s})`;
    rf.push([t - 0.01, { opacity: 0, transform: at(0.3) }], [t, { opacity: 0.9, transform: at(0.3) }], [t + 0.45, { opacity: 0, transform: at(1.3) }]);
    prev = p;
  }
  track($('cur'), cf);
  track($('ring'), rf);
  track($('cur'), [[0, { opacity: 0 }], [3.4, { opacity: 0 }], [3.8, { opacity: 1 }], [30.8, { opacity: 1 }], [31.2, { opacity: 0 }]]);

  sel($('c2'), 4.6); sel($('t1'), 5.8); sel($('k1'), 7.1); press($('go'), 8.6);
  mark('a3', 12.3, false); mark('a1', 12.6, true); pop($('fb1'), 12.9);
  mark('s2', 18.7, true); pop($('fb2'), 19.1);
  for (let i = 0; i < 5; i++) track($('tb' + i), [[23.8 + i * 0.15, { transform: 'scaleX(0)' }], [24.8 + i * 0.15, { transform: 'scaleX(1)' }]]);
  pop($('pass'), 24.5, 0);
  track($('p1'), [[26.6, { background: '#fff', color: '#1e1e1e', borderColor: '#e4e6ea' }], [26.75, { background: '#0d111b', color: '#fff', borderColor: '#0d111b' }]]);
  track($('themes'), [[26.7, H(1, 0)], [27.0, H(0, -14)]]);
  track($('review'), [[26.9, H(0, 18)], [27.3, H(1, 0)]]);
  press($('dl'), 29.9);
  track($('doc'), [[30.0, { opacity: 0, transform: 'translateY(140px) scale(.7) rotate(0deg)' }, 'cubic-bezier(.2,1.3,.4,1)'], [30.7, { opacity: 1, transform: 'translateY(0) scale(1) rotate(-4deg)' }]]);
  track($('clogo'), [[32.4, { opacity: 0, transform: 'scale(.6)' }, 'cubic-bezier(.3,1.5,.5,1)'], [33.0, { opacity: 1, transform: 'scale(1)' }]]);
  pop($('curl'), 32.7); pop($('cbtn'), 33.1);

  const num = $('num');
  return (t: number) => {
    for (const a of anims) a.currentTime = t * 1000;
    const k = clamp((t - 23.0) / 1.5);
    if (num) num.textContent = String(Math.round(34 * (1 - Math.pow(1 - k, 3))));
  };
}

function init(root: HTMLElement) {
  const fit = root.querySelector<HTMLElement>('.lbc-fit')!;
  const stage = root.querySelector<HTMLElement>('.lbc-stage')!;
  const area = stage.querySelector<HTMLElement>('.lbc-area')!;
  const inner = stage.querySelector<HTMLElement>('.lbc-inner')!;
  const btn = root.querySelector<HTMLButtonElement>('[data-lbc-toggle]')!;
  const label = btn.querySelector<HTMLElement>('[data-lbc-label]')!;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  let format: Format | null = null;
  let seek: (t: number) => void = () => {};
  let t = reduce.matches ? STILL : 0;
  let userPaused = reduce.matches;
  let visible = false;
  let last: number | null = null;

  function layout() {
    const want: Format = root.clientWidth >= 720 ? 'wide' : 'portrait';
    const [W, H] = FORMATS[want];
    if (want !== format) {
      format = want;
      fit.classList.toggle('wide', want === 'wide');
      fit.classList.toggle('portrait', want === 'portrait');
      stage.dataset.format = want;
      stage.style.width = W + 'px';
      stage.style.height = H + 'px';
      for (const a of stage.getAnimations({ subtree: true })) a.cancel();
    }
    stage.style.transform = `scale(${fit.clientWidth / W})`;
    const k = Math.min(area.clientWidth / 936, area.clientHeight / 700, want === 'wide' ? 1.15 : 1);
    inner.style.transform = `translate(-50%,-50%) scale(${k})`;
    if (!stage.getAnimations({ subtree: true }).length) seek = timeline(stage);
    seek(t);
  }

  function setPaused(p: boolean) {
    userPaused = p;
    btn.setAttribute('aria-pressed', String(p));
    label.textContent = p ? 'Lire l’animation' : 'Mettre en pause l’animation';
  }

  function frame(now: number) {
    if (!userPaused && visible && !document.hidden) {
      if (last !== null) t = (t + (now - last) / 1000) % D;
      last = now;
      seek(t);
    } else last = null;
    requestAnimationFrame(frame);
  }

  root.classList.add('lbc-ready');
  btn.hidden = false;
  setPaused(userPaused);
  btn.addEventListener('click', () => setPaused(!userPaused));
  reduce.addEventListener('change', (e) => { if (e.matches) { setPaused(true); t = STILL; seek(t); } });
  new ResizeObserver(layout).observe(root);
  new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); }, { threshold: 0.25 }).observe(fit);
  layout();
  requestAnimationFrame(frame);
}

document.querySelectorAll<HTMLElement>('[data-lbc]').forEach((el) => {
  if (typeof el.animate === 'function') init(el);
});
