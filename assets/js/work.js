// Work: filter chips, 3D tilt + glare + magnetic cards, and the full-screen
// case-study overlay with deep links (#work/<slug>). Case-study text lives in
// each card's .case block, so the page is complete without JavaScript.
import { reducedMotion, finePointer } from './util.js';

const HASH = /^#work\/([\w-]+)$/;

export function initWork() {
  const section = document.querySelector('#work');
  const grid = section.querySelector('.cards');
  const cards = [...grid.querySelectorAll('.card')];
  const count = section.querySelector('#work-count');
  const dialog = document.querySelector('#case-dialog');
  const bySlug = Object.fromEntries(cards.map((c) => [c.dataset.slug, c]));

  // ---- Surface each project's stack on its card (the full case study opens in the overlay)
  cards.forEach((card) => {
    const chips = card.querySelector('.case .chips');
    if (!chips) return;
    const stack = chips.cloneNode(true);
    stack.className = 'chips card-stack';
    stack.setAttribute('aria-label', 'Stack');
    card.querySelector('.card-actions').before(stack);
  });

  // ---- Filters
  const chips = section.querySelectorAll('[data-filter]');
  chips.forEach((chip) => chip.addEventListener('click', () => {
    const f = chip.dataset.filter;
    chips.forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    let shown = 0;
    cards.forEach((card) => {
      const match = f === 'all' || card.dataset.category === f;
      shown += match;
      if (match) {
        card.hidden = false;
        requestAnimationFrame(() => card.classList.remove('is-out'));
      } else if (reducedMotion) {
        card.hidden = true;
      } else {
        card.classList.add('is-out');
        setTimeout(() => card.classList.contains('is-out') && (card.hidden = true), 300);
      }
    });
    count.textContent = `${shown} project${shown === 1 ? '' : 's'} shown`;
    document.dispatchEvent(new Event('layout:change'));
  }));

  // ---- Tilt, glare and magnetic pull (fine pointers, full motion only)
  if (finePointer && !reducedMotion) {
    cards.forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        card.classList.add('is-tilting');
        card.style.setProperty('--ry', `${(x - 0.5) * 8}deg`);
        card.style.setProperty('--rx', `${(0.5 - y) * 8}deg`);
        card.style.setProperty('--mx', `${(x - 0.5) * 8}px`);
        card.style.setProperty('--my', `${(y - 0.5) * 8}px`);
        card.style.setProperty('--gx', `${x * 100}%`);
        card.style.setProperty('--gy', `${y * 100}%`);
      });
      card.addEventListener('pointerleave', () => {
        card.classList.remove('is-tilting');
        ['--rx', '--ry', '--mx', '--my'].forEach((p) => card.style.removeProperty(p));
      });
    });
  }

  // ---- Case-study overlay
  let opener = null;
  let pushed = false;

  const fill = (card) => {
    const img = card.querySelector('.card-media img');
    dialog.querySelector('.case-hero').style.backgroundImage = `url("${img.currentSrc || img.src}")`;
    dialog.querySelector('.case-kicker').textContent = card.querySelector('.card-kicker').textContent.trim();
    dialog.querySelector('#case-title').textContent = card.querySelector('h3').textContent;
    const content = dialog.querySelector('.case-content');
    content.replaceChildren(...[...card.querySelector('.case').children].map((el) => el.cloneNode(true)));
    // Card sections are h4 (under the card's h3); in the dialog they sit under an h2.
    content.querySelectorAll('h4').forEach((h) => {
      const h3 = document.createElement('h3');
      h3.textContent = h.textContent;
      h.replaceWith(h3);
    });
  };

  const open = (slug, { push = true } = {}) => {
    const card = bySlug[slug];
    if (!card) return;
    fill(card);
    if (!dialog.open) {
      opener = document.activeElement;
      dialog.showModal();
      document.dispatchEvent(new Event('overlay:open'));
    }
    dialog.scrollTop = 0;
    dialog.querySelector('.case-close').focus();
    if (push) {
      history.pushState({ case: slug }, '', `#work/${slug}`);
      pushed = true;
    }
  };

  const close = ({ fromHistory = false } = {}) => {
    if (!dialog.open) return;
    dialog.close();
    document.dispatchEvent(new Event('overlay:close'));
    if (!fromHistory) {
      if (pushed) history.back();
      else history.replaceState(null, '', '#work');
    }
    pushed = false;
    (opener?.isConnected ? opener : bySlug[location.hash.match(HASH)?.[1]]?.querySelector('.card-open'))?.focus({ preventScroll: true });
  };

  // Any link to #work/<slug> (cards, terminal, skills readout) opens the overlay.
  document.addEventListener('click', (e) => {
    const a = e.target instanceof Element && e.target.closest('a[href^="#work/"]');
    if (!a) return;
    const m = a.getAttribute('href').match(HASH);
    if (m && bySlug[m[1]]) {
      e.preventDefault();
      open(m[1]);
    }
  });
  dialog.querySelector('.case-close').addEventListener('click', () => close());
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close(); // backdrop
  });
  addEventListener('popstate', () => {
    const m = location.hash.match(HASH);
    if (m && bySlug[m[1]]) open(m[1], { push: false });
    else close({ fromHistory: true });
  });

  // Deep link on load.
  const m = location.hash.match(HASH);
  if (m && bySlug[m[1]]) open(m[1], { push: false });

  return { open, cards: bySlug };
}
