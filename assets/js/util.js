// Shared helpers: motion/quality preferences and a render-loop manager that only
// runs a scene while it is on screen and the tab is visible.

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
export const lowPower = innerWidth < 768 || (navigator.hardwareConcurrency || 8) <= 4;
export const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 1.75);

/** Yields to the event loop so long setup work is split into short tasks. */
export const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Runs `fn` when the browser is idle (or after `timeout` ms at the latest). */
export const whenIdle = (fn, timeout = 1500) =>
  'requestIdleCallback' in window ? requestIdleCallback(fn, { timeout }) : setTimeout(fn, 200);

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Cheap capability check (no throwaway context: creating one can cost hundreds of
 * ms on software GL). If a context still can't be created, the scene's init
 * throws and main.js falls back to static content.
 */
export const hasWebGL = () => 'WebGLRenderingContext' in window;

/**
 * Creates the WebGL2 context three.js renders into, on the scene's own canvas.
 * Throws (quietly, for main.js to catch) when WebGL is blocked or unavailable.
 */
export function webgl2(canvas) {
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: !lowPower, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL2 unavailable');
  return gl;
}

/**
 * Drives `frame(time, dt)` with requestAnimationFrame only while `el` intersects
 * the viewport and the document is visible. Returns { invalidate } so static
 * (reduced-motion) scenes can request a single redraw.
 */
export function renderLoop(el, frame, { continuous = true } = {}) {
  let visible = false;
  let raf = 0;
  let last = performance.now();

  const tick = (now) => {
    raf = 0;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    frame(now / 1000, dt);
    if (continuous && visible && !document.hidden) raf = requestAnimationFrame(tick);
  };
  const start = () => {
    if (!raf && visible && !document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  };
  const stop = () => {
    cancelAnimationFrame(raf);
    raf = 0;
  };

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    visible ? start() : stop();
  }).observe(el);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

  return { invalidate: start };
}

/** Calls `fn(width, height)` now and whenever the element is resized. */
export function onResize(el, fn) {
  const ro = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    if (width && height) fn(width, height);
  });
  ro.observe(el);
}

/** Pointer position normalised to -1..1 within `el`, eased each frame by the caller. */
export function trackPointer(el) {
  const p = { x: 0, y: 0, inside: false };
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    p.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    p.y = ((e.clientY - r.top) / r.height) * 2 - 1;
    p.inside = true;
  });
  el.addEventListener('pointerleave', () => {
    p.x = 0;
    p.y = 0;
    p.inside = false;
  });
  return p;
}
