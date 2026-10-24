// Impact counters: each digit becomes a vertical strip (two 0–9 cycles) that
// rolls into place when the stat scrolls into view. The real value stays in
// the DOM for screen readers; with reduced motion (or animations paused) nothing is touched.
import { reducedMotion, motion } from './util.js';

export function initCounters(root = document) {
  if (reducedMotion || motion.paused) return;
  const counters = root.querySelectorAll('.counter');

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      io.unobserve(entry.target);
      requestAnimationFrame(() => entry.target.classList.add('is-rolling'));
    });
  }, { threshold: 0.5 });

  counters.forEach((el) => {
    const value = el.textContent;
    const roll = document.createElement('span');
    roll.setAttribute('aria-hidden', 'true');
    roll.style.display = 'inherit';
    [...value].forEach((ch, i) => {
      if (/\d/.test(ch)) {
        const digit = document.createElement('span');
        digit.className = 'digit';
        // An invisible copy of the final digit sizes the slot, so "1" stays narrow.
        digit.append(Object.assign(document.createElement('span'), { className: 'sizer', textContent: ch }));
        const strip = document.createElement('span');
        strip.className = 'strip';
        strip.style.setProperty('--n', 10 + Number(ch));
        strip.style.setProperty('--d', `${i * 0.09}s`);
        for (let n = 0; n < 20; n++) strip.append(Object.assign(document.createElement('span'), { textContent: n % 10 }));
        digit.append(strip);
        roll.append(digit);
      } else {
        roll.append(Object.assign(document.createElement('span'), { className: 'ch', textContent: ch }));
      }
    });
    el.replaceChildren(Object.assign(document.createElement('span'), { className: 'sr-only', textContent: value }), roll);
    io.observe(el);
  });
}
