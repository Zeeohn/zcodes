// Entry point. Everything here is progressive enhancement: the page is fully
// readable before (and without) this script. Heavy WebGL scenes are imported
// lazily, only when their section approaches the viewport.
import { reducedMotion, finePointer, hasWebGL, whenIdle, motion, setMotionPaused, webgl2 } from './util.js';
import { initCursor } from './cursor.js';
import { initCounters } from './counters.js';
import { initWork } from './work.js';
import { initTerminal } from './terminal.js';
import { initSkills } from './skills.js';
import { initContact } from './contact.js';
import { initCv } from './cv.js';
import { initTyper } from './typer.js';
import { initAnalytics, analyticsOptedOut, setAnalyticsOptOut } from './analytics.js';

const html = document.documentElement;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const NAV_OFFSET = 72;

let lenis = null;
// We restore scroll ourselves (Lenis + case-study history entries).
history.scrollRestoration = 'manual';

boot();
initTyper($('.hero-title'));
const work = initWork();
initTerminal({ openCase: work.open });
initCounters();
initCursor();
initNav();
initMotionToggle();
initCareerCarousel();
initMagnetic();
initToastAndContact();
initAnalytics({ endpoint: $('#hire-form')?.dataset.endpoint?.trim() });
initAnalyticsToggle();
initScenes(work);
initMotion();

/* ---------- Boot preloader: CSS plays it; JS lets visitors skip it ---------- */
function boot() {
  if (!html.classList.contains('boot')) return;
  const pre = $('.preloader');
  const skip = () => html.classList.add('boot-skip');
  addEventListener('keydown', skip, { once: true });
  addEventListener('pointerdown', skip, { once: true });
  pre.addEventListener('animationend', (e) => {
    if (e.animationName !== 'boot-wipe') return;
    html.classList.remove('boot', 'boot-skip');
    removeEventListener('keydown', skip);
    removeEventListener('pointerdown', skip);
  });
}

/* ---------- Nav: scrolled state, progress bar, active section, tones, menu ---------- */
function initNav() {
  const nav = $('#nav');
  const bar = $('.progress span');
  const links = $$('.nav-links a');
  const indicator = $('.nav-indicator');
  const menu = $('#menu');
  const menuBtn = $('.menu-open');

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const max = document.documentElement.scrollHeight - innerHeight;
      bar.style.setProperty('--p', max > 0 ? (scrollY / max).toFixed(4) : 0);
      nav.classList.toggle('is-scrolled', scrollY > 24);
      ticking = false;
    });
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const moveIndicator = (link) => {
    if (!link || !link.offsetWidth) return indicator.style.setProperty('--o', 0);
    indicator.style.setProperty('--x', `${link.offsetLeft}px`);
    indicator.style.setProperty('--w', `${link.offsetWidth}px`);
    indicator.style.setProperty('--o', 1);
  };
  const sections = $$('main > section');
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const id = entry.target.id;
      document.body.dataset.tone = entry.target.dataset.tone || 'brand';
      let current = null;
      links.forEach((a) => {
        if (a.getAttribute('href') === `#${id}`) {
          a.setAttribute('aria-current', 'true');
          current = a;
        } else {
          a.removeAttribute('aria-current');
        }
      });
      moveIndicator(current);
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach((s) => io.observe(s));

  // In-page anchors: smooth (Lenis) scroll, then move focus for keyboard users.
  const goto = (selector, focusSelector) => {
    const target = $(selector);
    if (!target) return;
    const focusEl = focusSelector ? $(focusSelector) : target;
    const done = () => {
      if (!focusSelector && !focusEl.hasAttribute('tabindex')) focusEl.setAttribute('tabindex', '-1');
      focusEl.focus({ preventScroll: true });
    };
    if (lenis) lenis.scrollTo(target, { offset: selector === '#top' ? 0 : -NAV_OFFSET, onComplete: done });
    else {
      target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
      done();
    }
  };
  document.addEventListener('click', (e) => {
    const a = e.target instanceof Element && e.target.closest('a[href^="#"]');
    const href = a?.getAttribute('href');
    if (!href || href === '#' || href.startsWith('#work/')) return;
    e.preventDefault();
    // Links inside overlays (e.g. "Hire me" in a case study) close them first.
    if (menu.open) menu.close();
    $$('dialog[open]').forEach((d) => d.dispatchEvent(new Event('cancel', { cancelable: true })));
    goto(href, a.dataset.focus);
  });
  document.addEventListener('nav:goto', (e) => goto(e.detail.selector, e.detail.focus));

  // Mobile full-screen menu
  menuBtn.addEventListener('click', () => {
    menu.showModal();
    menuBtn.setAttribute('aria-expanded', 'true');
    document.dispatchEvent(new Event('overlay:open'));
  });
  $('.menu-close').addEventListener('click', () => menu.close());
  menu.addEventListener('close', () => {
    menuBtn.setAttribute('aria-expanded', 'false');
    document.dispatchEvent(new Event('overlay:close'));
  });
}

/* ---------- "Pause animations" (nav + footer buttons) ---------- */
function initMotionToggle() {
  const buttons = $$('.motion-toggle');
  const sync = () => buttons.forEach((b) => b.setAttribute('aria-pressed', String(motion.paused)));
  buttons.forEach((b) => b.addEventListener('click', () => setMotionPaused(!motion.paused)));
  document.addEventListener('motion:change', sync);
  sync();
}

/* ---------- Footer: visit analytics on/off (the choice is stored in this browser) ---------- */
function initAnalyticsToggle() {
  const button = $('.analytics-toggle');
  const signal = navigator.globalPrivacyControl === true || navigator.doNotTrack === '1';
  const sync = () => button.setAttribute('aria-pressed', String(!signal && !analyticsOptedOut()));
  if (signal) {
    button.disabled = true;
    button.title = 'Off: your browser asks sites not to track (Global Privacy Control / Do Not Track)';
  }
  button.addEventListener('click', () => {
    setAnalyticsOptOut(!analyticsOptedOut());
    sync();
  });
  sync();
}

/* ---------- Career on small screens: a swipeable, keyboard-scrollable row ---------- */
function initCareerCarousel() {
  const viewport = $('#career .log-viewport');
  // Only a region that actually scrolls needs to be a tab stop.
  const sync = () => {
    const scrolls = viewport.scrollWidth > viewport.clientWidth + 4;
    if (scrolls) viewport.setAttribute('tabindex', '0');
    else viewport.removeAttribute('tabindex');
  };
  new ResizeObserver(sync).observe(viewport);
}

/* ---------- Magnetic buttons ---------- */
function initMagnetic() {
  if (!finePointer || reducedMotion) return;
  $$('[data-magnetic]').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${(e.clientX - r.left - r.width / 2) * 0.3}px`);
      el.style.setProperty('--my', `${(e.clientY - r.top - r.height / 2) * 0.4}px`);
    });
    el.addEventListener('pointerleave', () => {
      el.style.removeProperty('--mx');
      el.style.removeProperty('--my');
    });
  });
}

/* ---------- Contact: toast + copy-email (the form itself lives in contact.js) ---------- */
function initToastAndContact() {
  const toast = $('.toast');
  let toastTimer = 0;
  const say = (msg) => {
    toast.textContent = msg;
    toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-on'), 2600);
  };
  initContact({ say });
  initCv({ say });
  $('.copy-email').addEventListener('click', async (e) => {
    const email = e.currentTarget.dataset.email;
    try {
      await navigator.clipboard.writeText(email);
      say('Email copied ✓');
    } catch {
      say(`Copy failed. It's ${email}`);
    }
  });
}

/* ---------- Scenes: lazy import + init when near the viewport, during idle time ---------- */
function initScenes(work) {
  const webgl = hasWebGL();
  if (!webgl) html.classList.add('no-webgl');
  const loaders = {
    skills: () => Promise.resolve((el) => initSkills(el.closest('section'), work)),
    ...(webgl && {
      hero: () => import('./hero.js').then((m) => m.initHero),
      network: () => import('./network.js').then((m) => m.initNetwork),
      globe: () => import('./globe.js').then((m) => m.initGlobe),
    }),
  };
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      io.unobserve(entry.target);
      const el = entry.target;
      whenIdle(async () => {
        try {
          // Probe WebGL on the scene's own canvas (three.js reuses this context) before
          // downloading three.js, so blocked-WebGL browsers get the fallback at once.
          if (el.dataset.scene !== 'skills') webgl2(el.querySelector('canvas'));
          const init = await loaders[el.dataset.scene]();
          await init(el);
        } catch (err) {
          console.warn(`[${el.dataset.scene}] falling back to static content:`, err);
          el.classList.add('is-fallback');
          if (el.dataset.scene === 'hero') html.classList.add('no-webgl'); // collapse the scroll-shatter track
        }
      });
    });
  }, { rootMargin: '400px 0px' });
  $$('[data-scene]').filter((el) => loaders[el.dataset.scene]).forEach((el) => io.observe(el));
}

/* ---------- Smooth scroll, reveals and the pinned career timeline ---------- */
async function initMotion() {
  if (reducedMotion) return;
  let gsap, ScrollTrigger, Lenis;
  try {
    [{ gsap }, { ScrollTrigger }, { default: Lenis }] = await Promise.all([import('gsap'), import('gsap/ScrollTrigger'), import('lenis')]);
  } catch (err) {
    console.warn('Motion libraries unavailable; continuing without smooth scroll.', err);
    return;
  }
  gsap.registerPlugin(ScrollTrigger);

  lenis = new Lenis({ lerp: 0.11 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  document.addEventListener('overlay:open', () => lenis.stop());
  document.addEventListener('overlay:close', () => {
    if (!document.querySelector('dialog[open]')) lenis.start();
  });
  document.addEventListener('layout:change', () => setTimeout(() => ScrollTrigger.refresh(), 350));

  // Reveal on scroll
  $$('[data-reveal]').forEach((el) => {
    const siblings = el.parentElement ? [...el.parentElement.children].filter((c) => c.hasAttribute('data-reveal')) : [];
    gsap.from(el, {
      y: 36,
      opacity: 0,
      duration: 1,
      ease: 'power3.out',
      delay: (siblings.indexOf(el) % 4) * 0.07,
      scrollTrigger: { trigger: el, start: 'top 96%', once: true },
    });
  });

  // Career: pinned horizontal scroll on large screens, vertical list elsewhere.
  const mm = gsap.matchMedia();
  mm.add('(min-width: 1024px) and (min-height: 700px)', () => {
    const section = $('#career');
    const log = $('.log', section);
    section.classList.add('is-horizontal');
    const events = $$('.event', section);
    const bar = $('.log-bar span', section);
    const count = $('.log-count', section);
    const distance = () => Math.max(0, log.scrollWidth - innerWidth + parseFloat(getComputedStyle($('.log-viewport', section)).paddingLeft));
    const tween = gsap.to(log, {
      x: () => -distance(),
      ease: 'none',
      scrollTrigger: {
        trigger: section,
        pin: true,
        start: 'top top',
        end: () => `+=${distance()}`,
        scrub: 0.6,
        invalidateOnRefresh: true,
        onUpdate: ({ progress }) => {
          // Progress bar plus the offset of the event nearest the reading line.
          bar.style.transform = `scaleX(${progress.toFixed(3)})`;
          const i = Math.round(progress * (events.length - 1));
          count.textContent = `offset ${events[i].querySelector('.offset').textContent}`;
          events.forEach((ev, k) => ev.classList.toggle('is-current', k === i));
        },
      },
    });
    return () => {
      tween.scrollTrigger.kill();
      tween.kill();
      gsap.set(log, { clearProps: 'transform' });
      events.forEach((ev) => ev.classList.remove('is-current'));
      section.classList.remove('is-horizontal');
    };
  });
  // Fonts and lazy images change layout; re-measure once they settle.
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
  addEventListener('load', () => ScrollTrigger.refresh());
}
