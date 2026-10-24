// Custom cursor: a dot that follows the pointer exactly and a ring that lags
// behind, grows over interactive elements and shows a label ("view", "drag")
// for elements with data-cursor. Fine pointers only, never with reduced motion.
import { reducedMotion, finePointer, lerp } from './util.js';

export function initCursor() {
  if (!finePointer || reducedMotion) return;
  const root = document.querySelector('.cursor');
  const dot = root.querySelector('.cursor-dot');
  const ring = root.querySelector('.cursor-ring');
  const label = root.querySelector('.cursor-label');
  document.documentElement.classList.add('has-cursor');

  const pos = { x: -100, y: -100 };
  const lag = { x: -100, y: -100 };
  let raf = 0;

  const tick = () => {
    lag.x = lerp(lag.x, pos.x, 0.18);
    lag.y = lerp(lag.y, pos.y, 0.18);
    ring.style.transform = `translate(${lag.x}px, ${lag.y}px)`;
    raf = Math.hypot(pos.x - lag.x, pos.y - lag.y) > 0.3 ? requestAnimationFrame(tick) : 0;
  };

  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    pos.x = e.clientX;
    pos.y = e.clientY;
    dot.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
    root.classList.remove('is-hidden');
    if (!raf) raf = requestAnimationFrame(tick);
  }, { passive: true });

  document.addEventListener('pointerover', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    const labelled = t?.closest('[data-cursor]');
    const text = t?.closest('input, textarea');
    const link = t?.closest('a, button, label, summary');
    root.classList.toggle('is-label', !!labelled);
    root.classList.toggle('is-text', !labelled && !!text);
    root.classList.toggle('is-link', !labelled && !text && !!link);
    label.textContent = labelled ? labelled.dataset.cursor : '';
  });
  document.documentElement.addEventListener('pointerleave', () => root.classList.add('is-hidden'));
}
