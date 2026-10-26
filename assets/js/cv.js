// CV downloads: one PDF per role. The first download asks for a name and email
// (remembered for the visit); after that every version downloads in one click.
//
// The CV text is not in the HTML or in any plain-text file: assets/cv/cv.enc.json
// holds it AES-GCM encrypted, so crawlers and scrapers that read files never see
// it. The PDF is assembled in the browser from that source, warmed up while the
// section scrolls into view so the click feels instant. Each first download also
// notifies Zion through the contact relay (in the background; it never blocks).
import { relaySend, clean } from './contact.js';
import { track, identify } from './analytics.js';

const BLOB_URL = 'assets/cv/cv.enc.json';
// Not a secret: keeps the text out of crawlable files. Must match encrypt-cv.mjs.
const SITE_KEY = 'zcodes-cv-v2';
const READER_KEY = 'zs-cv-reader';
const ROLES = {
  fullstack: 'Full-Stack Engineer',
  backend: 'Backend Engineer',
  frontend: 'Frontend Engineer',
  solutions: 'Integrations & Solutions Engineer',
};
const fileName = (role) => `Zion-Success-CV-${ROLES[role].replace(/[^A-Za-z]+/g, '-').replace(/-$/, '')}.pdf`;
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

let source = null;
/** Fetches and decrypts the CV source once; later calls reuse it. */
const loadSource = () => (source ||= (async () => {
  const blob = await (await fetch(BLOB_URL)).json();
  const { subtle } = crypto;
  const material = await subtle.importKey('raw', new TextEncoder().encode(SITE_KEY), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(blob.salt), iterations: blob.iterations },
    material, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(blob.iv) }, key, fromB64(blob.data));
  return JSON.parse(new TextDecoder().decode(plain));
})().catch((err) => {
  source = null; // allow a retry
  throw err;
}));
const loadBuilder = () => import('./cv-pdf.js');

const readReader = () => {
  try {
    return JSON.parse(sessionStorage.getItem(READER_KEY));
  } catch {
    return null;
  }
};
const saveReader = (reader) => {
  try {
    sessionStorage.setItem(READER_KEY, JSON.stringify(reader));
  } catch {
    /* storage blocked: they'll be asked again next time */
  }
};

export function initCv({ say }) {
  const section = document.querySelector('#cv');
  const tiles = [...section.querySelectorAll('.cv-file')];
  const gate = section.querySelector('#cv-gate');
  const gateError = gate.querySelector('.api-error');
  const status = section.querySelector('.cv-status');
  const endpoint = document.querySelector('#hire-form')?.dataset.endpoint?.trim();
  let reader = readReader();
  let pendingRole = null;
  let startedAt = 0;
  let busy = false;

  // Warm up before the click: source, decryption and the PDF builder.
  new IntersectionObserver(([entry], io) => {
    if (!entry.isIntersecting) return;
    io.disconnect();
    loadSource().catch(() => {});
    loadBuilder().catch(() => {});
  }, { rootMargin: '600px 0px' }).observe(section);

  const setStatus = (nodes, cls = '') => {
    status.className = `cv-status mono ${cls}`.trim();
    status.replaceChildren(...nodes);
  };

  async function download(role, opener) {
    if (busy) return;
    busy = true;
    tiles.forEach((t) => t.setAttribute('aria-busy', String(t.dataset.role === role)));
    // Only show progress if it takes noticeably long (first click on a slow connection).
    const slow = setTimeout(() => setStatus([`Preparing ${fileName(role)}…`]), 250);
    try {
      const [cv, { buildCvPdf }] = await Promise.all([loadSource(), loadBuilder()]);
      const bytes = await buildCvPdf(cv, role);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const link = Object.assign(document.createElement('a'), { href: url, download: fileName(role), textContent: 'Download again' });
      link.click();
      clearTimeout(slow);
      setStatus([Object.assign(document.createElement('span'), { className: 'code-ok', textContent: '200 OK' }), ` ${fileName(role)} · `, link], 'is-ok');
      say('Download started ✓');
      track('cv_download', { role });
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      clearTimeout(slow);
      const mail = Object.assign(document.createElement('a'), {
        href: `mailto:successzion21@gmail.com?subject=${encodeURIComponent(`CV: ${ROLES[role]}`)}`,
        textContent: 'email me',
      });
      setStatus(['The download didn\'t start. Please try again, or ', mail, ' and I\'ll send it.'], 'is-err');
    } finally {
      busy = false;
      tiles.forEach((t) => t.removeAttribute('aria-busy'));
      opener?.focus({ preventScroll: true });
    }
  }

  /** Lets Zion know who downloaded what. Once per visit; failures are ignored. */
  function notify(role) {
    if (!endpoint || reader.notified) return;
    reader.notified = true;
    saveReader(reader);
    const message = [
      `CV DOWNLOAD: ${ROLES[role]}`,
      `Company: ${reader.company || '(not given)'}`,
      '',
      'Downloaded from the portfolio. No action needed; reply to follow up.',
    ].join('\n');
    relaySend(endpoint, { name: reader.name, email: reader.email, message }, { website: gate.elements.website.value, startedAt }).catch(() => {});
  }

  const openGate = (role, tile) => {
    pendingRole = role;
    gate.dataset.opener = tiles.indexOf(tile);
    gate.querySelector('.cv-gate-file').textContent = fileName(role);
    gate.hidden = false;
    tiles.forEach((t) => t.setAttribute('aria-expanded', String(t === tile)));
    gate.elements.name.focus();
  };
  const closeGate = () => {
    gate.hidden = true;
    tiles.forEach((t) => t.setAttribute('aria-expanded', 'false'));
    tiles[gate.dataset.opener]?.focus();
  };

  tiles.forEach((tile) => {
    tile.setAttribute('aria-controls', 'cv-gate');
    tile.setAttribute('aria-expanded', 'false');
    tile.addEventListener('click', () => {
      const role = tile.dataset.role;
      if (reader) {
        download(role, tile);
        notify(role);
      } else {
        openGate(role, tile);
      }
    });
  });

  gate.noValidate = true;
  gate.addEventListener('focusin', () => (startedAt ||= performance.now()));
  gate.querySelector('.cv-cancel').addEventListener('click', closeGate);
  gate.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeGate();
  });
  gate.addEventListener('submit', (e) => {
    e.preventDefault();
    const fields = [...gate.querySelectorAll('.json input')];
    const bad = fields.filter((f) => {
      f.value = f.value.trim();
      const invalid = !f.checkValidity();
      if (invalid) f.setAttribute('aria-invalid', 'true');
      else f.removeAttribute('aria-invalid');
      return invalid;
    });
    if (bad.length) {
      gateError.textContent = `Please check your ${bad.map((f) => f.name).join(' and ')}.`;
      bad[0].focus();
      return;
    }
    gateError.textContent = '';
    reader = {
      name: clean(gate.elements.name.value, 120),
      email: clean(gate.elements.email.value, 200).toLowerCase(),
      company: clean(gate.elements.company.value, 120),
    };
    saveReader(reader);
    identify(reader);
    const role = pendingRole;
    const opener = tiles[gate.dataset.opener];
    gate.hidden = true;
    tiles.forEach((t) => t.setAttribute('aria-expanded', 'false'));
    download(role, opener);
    notify(role);
  });
}
