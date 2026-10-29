// First-party, cookieless visit analytics. Events go to the contact relay
// (assets/contact-relay/Code.gs), which appends them to a Google Sheet in Zion's
// Drive and serves a private dashboard. No third-party analytics service.
//
// What's sent: an anonymous random visitor id (localStorage) and visit id
// (sessionStorage); referrer and campaign tags; language, timezone, screen and a
// coarse device/browser/OS; an approximate location (city, region, country and the
// network's organisation) looked up from the IP address via GeoJS — the IP itself is
// never sent or stored; and what happened on the page (sections reached, scroll
// depth, engaged time, key actions). Visits are never linked to a name or email,
// even when the visitor fills in the CV or contact form: that keeps the data anonymous
// audience measurement rather than profiling of identifiable people.
//
// Not tracked: visitors who opt out (footer), browsers sending Global Privacy
// Control or Do Not Track, automated browsers and bots, and the owner (open the
// site once with ?owner=1; ?owner=0 undoes it).

const GEO_URL = 'https://get.geojs.io/v1/ip/geo.json';
const KEYS = { visitor: 'zs-vid', visits: 'zs-visits', optOut: 'zs-no-track', owner: 'zs-owner', session: 'zs-sid', geo: 'zs-geo' };
const MAX_EVENTS = 60;

const store = (area) => ({
  get: (k) => { try { return area.getItem(k); } catch { return null; } },
  set: (k, v) => { try { area.setItem(k, v); } catch { /* storage blocked */ } },
  del: (k) => { try { area.removeItem(k); } catch { /* storage blocked */ } },
});
const local = store(window.localStorage);
const session = store(window.sessionStorage);
const randomId = () => [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);

let state = null; // null when tracking is off

/** Records a named action (e.g. "cv_download") with a few small properties. */
export function track(name, props = {}) {
  if (!state) return;
  state.events.push({ n: name, t: Math.round(performance.now() / 1000), ...props });
  if (state.events.length > MAX_EVENTS) state.events.shift();
  if (['cv_download', 'contact_sent'].includes(name)) flush('update');
}

export const analyticsOptedOut = () => local.get(KEYS.optOut) === '1';
export function setAnalyticsOptOut(out) {
  if (out) local.set(KEYS.optOut, '1');
  else local.del(KEYS.optOut);
}

function excluded() {
  const owner = new URLSearchParams(location.search).get('owner');
  if (owner === '1') local.set(KEYS.owner, '1');
  if (owner === '0') local.del(KEYS.owner);
  return local.get(KEYS.owner) === '1'
    || analyticsOptedOut()
    || navigator.globalPrivacyControl === true
    || navigator.doNotTrack === '1'
    || navigator.webdriver
    || /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview/i.test(navigator.userAgent);
}

function client() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android'
    : /CrOS/.test(ua) ? 'ChromeOS' : /Mac OS X/.test(ua) ? (navigator.maxTouchPoints > 1 ? 'iPadOS' : 'macOS') : /Linux/.test(ua) ? 'Linux' : 'Other';
  const device = /iPad|Tablet/.test(ua) || (os === 'iPadOS') ? 'tablet' : /Mobi|Android|iPhone/.test(ua) ? 'mobile' : 'desktop';
  return {
    browser, os, device,
    lang: navigator.language || '',
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    screen: `${screen.width}x${screen.height}`,
    viewport: `${innerWidth}x${innerHeight}`,
    net: navigator.connection?.effectiveType || '',
  };
}

function source() {
  const q = new URLSearchParams(location.search);
  const ref = document.referrer;
  let refHost = '';
  try {
    refHost = ref ? new URL(ref).hostname : '';
  } catch { /* malformed referrer */ }
  const internal = refHost === location.hostname;
  return {
    ref: internal ? '' : ref.slice(0, 300),
    refHost: internal ? '' : refHost,
    utm: ['source', 'medium', 'campaign', 'content', 'term'].map((k) => q.get(`utm_${k}`)).filter(Boolean).join(' / ').slice(0, 200),
    entry: (location.pathname + location.hash).slice(0, 120),
  };
}

/** Approximate location from GeoJS; cached for the visit. The IP is dropped here. */
async function geo() {
  const cached = session.get(KEYS.geo);
  if (cached) return JSON.parse(cached);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const g = await (await fetch(GEO_URL, { signal: ctrl.signal })).json();
    clearTimeout(timer);
    const out = {
      country: g.country || '', cc: g.country_code || '', region: g.region || '', city: g.city || '',
      org: g.organization_name || '',
    };
    session.set(KEYS.geo, JSON.stringify(out));
    return out;
  } catch {
    return {}; // the dashboard falls back to the browser timezone
  }
}

function payload(kind) {
  return {
    type: 'analytics', v: 1, kind,
    vid: state.vid, sid: state.sid, visit: state.visitNo,
    ...state.base,
    sections: state.sections,
    scroll: Math.round(state.maxScroll * 100),
    engaged: Math.round(state.engagedMs / 1000),
    events: state.events,
  };
}

function flush(kind) {
  if (!state || !state.endpoint || !state.base) return;
  const body = JSON.stringify(payload(kind));
  const blob = new Blob([body], { type: 'text/plain;charset=utf-8' }); // simple request, no preflight
  if (!(navigator.sendBeacon && navigator.sendBeacon(state.endpoint, blob))) {
    fetch(state.endpoint, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain;charset=utf-8' } }).catch(() => {});
  }
}

export async function initAnalytics({ endpoint }) {
  if (!endpoint || excluded()) return;
  let vid = local.get(KEYS.visitor);
  if (!vid) {
    vid = randomId();
    local.set(KEYS.visitor, vid);
  }
  let sid = session.get(KEYS.session);
  if (!sid) {
    sid = randomId();
    session.set(KEYS.session, sid);
    local.set(KEYS.visits, String(Number(local.get(KEYS.visits) || 0) + 1));
  }
  state = {
    endpoint, vid, sid, visitNo: Number(local.get(KEYS.visits) || 1),
    base: null, sections: [], maxScroll: 0, engagedMs: 0, events: [],
  };

  // Sections reached, in order: a section counts once it crosses the middle of the
  // viewport (a fraction-visible threshold would never fire for very tall sections).
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting && !state.sections.includes(e.target.id)) state.sections.push(e.target.id);
  }), { rootMargin: '-45% 0px -45% 0px' });
  document.querySelectorAll('main > section[id]').forEach((s) => io.observe(s));

  // Scroll depth and engaged time (visible tab, input within the last 30 s).
  let lastInput = performance.now();
  let lastTick = performance.now();
  ['pointermove', 'pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((ev) => addEventListener(ev, () => (lastInput = performance.now()), { passive: true }));
  addEventListener('scroll', () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    if (max > 0) state.maxScroll = Math.max(state.maxScroll, Math.min(1, scrollY / max));
  }, { passive: true });
  setInterval(() => {
    const now = performance.now();
    if (!document.hidden && now - lastInput < 30000) state.engagedMs += now - lastTick;
    lastTick = now;
  }, 1000);

  // Outbound links, email links and "Hire me" clicks.
  document.addEventListener('click', (e) => {
    const a = e.target instanceof Element && e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (href.startsWith('mailto:')) track('email_click');
    else if (/^https?:/.test(href) && new URL(href).hostname !== location.hostname) track('outbound', { to: new URL(href).hostname });
    else if (href === '#contact' && /hire/i.test(a.textContent)) track('hire_click');
    else if (/^(error-autopilot|build-beacon)\//.test(href)) track('product_docs', { to: href.split('/')[0] });
  }, { capture: true });

  // Overlays: case studies and the terminal.
  const caseDialog = document.querySelector('#case-dialog');
  const terminal = document.querySelector('#terminal');
  new MutationObserver(() => {
    if (caseDialog.open) track('case_open', { slug: (location.hash.match(/^#work\/([\w-]+)/) || [])[1] || caseDialog.querySelector('#case-title')?.textContent.slice(0, 60) });
  }).observe(caseDialog, { attributes: true, attributeFilter: ['open'] });
  new MutationObserver(() => {
    if (terminal.open) track('terminal_open');
  }).observe(terminal, { attributes: true, attributeFilter: ['open'] });

  // Send the visit once the location is known (or after the lookup times out),
  // then an update whenever the page is hidden or left.
  state.base = { ...client(), ...source(), ...(await geo()) };
  flush('pageview');
  document.addEventListener('visibilitychange', () => document.hidden && flush('update'));
  addEventListener('pagehide', () => flush('update'));
}
