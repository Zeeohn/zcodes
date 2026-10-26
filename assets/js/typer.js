// Hero headline as a typewriter: the original line stays as the accessible name
// (and is what renders first, for LCP and no-JS), then the visual copy backspaces
// and types a rotating set of phrases with a blinking caret.
//
// Every phrase is exactly three lines of at most 15 characters, so the headline's
// height never changes (no layout shift) and each line fits a 360px screen.
// Rotation stops with reduced motion, "Pause animations", a hidden tab, or when
// the hero is off screen.
import { reducedMotion, motion } from './util.js';

const PHRASES = [
  ['I build systems', "that don't go", 'down.'],
  ['Monoliths in,', 'microservices', 'out.'],
  ['Kafka streams.', 'Redis caches.', 'Zero drama.'],
  ['Sub-second', 'real-time,', 'on purpose.'],
  ['99% uptime is', 'my love', 'language.'],
  ['I ship to prod', 'and still sleep', 'at night.'],
  ['Deploys 40%', 'faster. Coffee', 'still hot.'],
  ['Your pager', 'deserves a', 'long nap.'],
  ['Scaling to', '5,000+ daily', 'users. Next?'],
  ['80% less', 'custom code to', 'maintain.'],
  ['Node, React,', 'TypeScript.', 'Fluent in all.'],
  ['APIs with', 'impeccable', 'manners.'],
  ['Any timezone.', 'Or relocate', 'for the role.'],
  ['New stack?', 'I learn fast,', 'ship faster.'],
  ['Distributed', 'systems, calm', 'deploys.'],
  ['Hard problems?', 'Bring them', 'on.'],
];

const TYPE_MS = 52; // per character, with a little jitter so it feels human
const DELETE_MS = 24;
const HOLD_MS = 2600; // a finished phrase stays readable this long
const FIRST_HOLD_MS = 4000; // the signature line gets a little longer
const GAP_MS = 380;

export function initTyper(h1) {
  const label = h1.textContent.replace(/\s+/g, ' ').trim();
  const screen = document.createElement('span');
  screen.className = 'typer';
  screen.setAttribute('aria-hidden', 'true');
  const lines = [0, 1, 2].map((i) => Object.assign(document.createElement('span'), { className: i === 2 ? 'typer-line typer-accent' : 'typer-line' }));
  const caret = Object.assign(document.createElement('span'), { className: 'typer-caret' });
  screen.append(lines[0], document.createElement('br'), lines[1], document.createElement('br'), lines[2]);
  h1.replaceChildren(Object.assign(document.createElement('span'), { className: 'sr-only', textContent: label }), screen);

  let phrase = 0;
  let shown = 0; // characters of the current phrase on screen
  const length = (p) => PHRASES[p].join('').length;

  const render = () => {
    let left = shown;
    let active = lines[0];
    PHRASES[phrase].forEach((text, i) => {
      const n = Math.max(0, Math.min(text.length, left));
      lines[i].textContent = text.slice(0, n);
      if (left > 0) active = lines[i];
      left -= text.length;
    });
    active.after(caret); // the caret sits outside the gradient line so it is never clipped
  };
  shown = length(0);
  render();

  if (reducedMotion) return;

  let timer = 0;
  let mode = 'hold';
  let visible = true;
  let firstHold = true;
  const canRun = () => visible && !document.hidden && !motion.paused;

  const step = () => {
    timer = 0;
    if (!canRun()) {
      // Never freeze mid-word: show the whole phrase while paused.
      shown = length(phrase);
      mode = 'hold';
      render();
      screen.classList.remove('is-typing');
      return;
    }
    let wait;
    if (mode === 'hold') {
      mode = 'delete';
      wait = firstHold ? FIRST_HOLD_MS : HOLD_MS;
      firstHold = false;
    } else if (mode === 'delete') {
      screen.classList.add('is-typing');
      shown -= 1;
      if (shown <= 0) {
        shown = 0;
        phrase = (phrase + 1) % PHRASES.length;
        mode = 'type';
        wait = GAP_MS;
      } else {
        wait = DELETE_MS;
      }
    } else {
      shown += 1;
      if (shown >= length(phrase)) {
        mode = 'hold';
        screen.classList.remove('is-typing');
        wait = 0;
      } else {
        wait = TYPE_MS * (0.6 + Math.random() * 0.8);
      }
    }
    render();
    timer = setTimeout(step, wait);
  };
  const resume = () => {
    if (!timer && canRun()) timer = setTimeout(step, 0);
  };

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    resume();
  }).observe(h1);
  document.addEventListener('visibilitychange', resume);
  document.addEventListener('motion:change', () => {
    if (motion.paused) {
      clearTimeout(timer);
      timer = 0;
      step();
    } else {
      resume();
    }
  });
  // Start after the boot preloader (if any) has cleared.
  const delay = document.documentElement.classList.contains('boot') ? Math.max(0, 1200 - performance.now()) : 0;
  setTimeout(resume, delay);
}
