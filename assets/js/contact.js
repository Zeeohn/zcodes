// Contact form: "POST /v1/hire-zion". Sends the request straight to the inbox via
// the contact relay (assets/contact-relay/Code.gs, a Google Apps Script web app)
// whose URL is the form's data-endpoint. Without an endpoint it falls back to a
// prefilled mailto: draft. Spam controls are mirrored on the server: a honeypot,
// a minimum fill time and a proof-of-work stamp bound to this exact message.

const FALLBACK_EMAIL = 'successzion21@gmail.com';
const DIFFICULTY = 14; // leading zero bits; must match LIMITS.powBits in Code.gs
const enc = new TextEncoder();

const STATUS = {
  delivered: ['201 Created', 'ok', { status: 'delivered', inbox: 'zion', reply_within: 'a day or two' }],
  accepted: ['201 Created', 'ok', { status: 'delivered', inbox: 'zion', reply_within: 'a day or two' }],
  invalid: ['422 Unprocessable Entity', 'err', { error: 'Check your name, email and message (10+ characters).' }],
  bad_stamp: ['400 Bad Request', 'err', { error: 'The request signature expired. Press Send again.' }],
  rate_limited: ['429 Too Many Requests', 'err', { error: 'Lots of requests right now. Please email me directly.' }],
  server_error: ['503 Service Unavailable', 'err', { error: 'The relay is down. Please email me directly.' }],
};

/* The server normalises fields before checking the stamp, so the browser sends
   exactly what the server will hash. These mirror clean()/cleanMultiline() there. */
export const clean = (v, max) => v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
export const cleanMultiline = (v, max) => v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]+/g, '').trim().slice(0, max);

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (text) => hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
const hasZeroBits = (h, bits) => {
  const full = Math.floor(bits / 4);
  if (h.slice(0, full) !== '0'.repeat(full)) return false;
  const rest = bits % 4;
  return rest === 0 || parseInt(h[full], 16) < 1 << (4 - rest);
};

/** Finds a nonce so SHA-256("v1|ts|email|sha256(message)|nonce") has DIFFICULTY zero bits (~16k hashes). */
async function proofOfWork(email, message) {
  const ts = String(Date.now());
  const prefix = `v1|${ts}|${email}|${await sha256(message)}|`;
  for (let base = 0; ; base += 256) {
    const batch = await Promise.all(Array.from({ length: 256 }, (_, i) => sha256(prefix + (base + i))));
    const hit = batch.findIndex((h) => hasZeroBits(h, DIFFICULTY));
    if (hit !== -1) return `v1:${ts}:${base + hit}`;
  }
}

/**
 * Posts one message to the relay with its spam guards and returns the relay's
 * verdict mapped to an API-style [code, class, body]. Shared by the contact form
 * and the CV request form. Throws only on network failure.
 */
export async function relaySend(endpoint, data, { website = '', startedAt = 0, onStage = () => {} } = {}) {
  const t0 = performance.now();
  onStage('Signing…');
  const payload = {
    ...data,
    website, // honeypot: humans leave it empty
    elapsed: Math.round(performance.now() - (startedAt || t0)),
    stamp: await proofOfWork(data.email, data.message),
  };
  onStage('Sending…');
  // text/plain keeps this a CORS "simple request" (no preflight), which Apps Script requires.
  const res = await fetch(endpoint, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
  const result = await res.json();
  const known = { stale_stamp: 'bad_stamp', replay: 'bad_stamp', bad_request: 'invalid' }[result.code] || result.code;
  return { ok: !!result.ok, status: STATUS[known] || STATUS.server_error, ms: performance.now() - t0 };
}

export function initContact({ say }) {
  const form = document.querySelector('#hire-form');
  const endpoint = form.dataset.endpoint?.trim();
  const submit = form.querySelector('[type="submit"]');
  const error = form.querySelector('.api-error[role="alert"]');
  const response = form.querySelector('.api-response');
  const statusLine = response.querySelector('.api-status');
  const bodyOut = response.querySelector('pre');
  let startedAt = 0;
  let sending = false;

  form.noValidate = true;
  submit.disabled = false; // disabled in HTML so the no-JS form can't submit to the page URL
  form.addEventListener('focusin', () => (startedAt ||= performance.now()));

  const show = (code, cls, payload, ms) => {
    statusLine.className = `api-status code-${cls}`;
    statusLine.textContent = code;
    response.querySelector('.api-time').textContent = ms ? `· ${(ms / 1000).toFixed(1)}s` : '';
    bodyOut.textContent = JSON.stringify(payload, null, 2);
    response.querySelector('.api-fallback')?.remove();
    response.hidden = false;
    response.classList.remove('is-on');
    void response.offsetWidth; // restart the entrance animation
    response.classList.add('is-on');
  };

  const mailtoFallback = (data) => {
    const body = `POST /v1/hire-zion\n\n${JSON.stringify(data, null, 2)}\n`;
    return `mailto:${FALLBACK_EMAIL}?subject=${encodeURIComponent(`Hire request from ${data.name}`)}&body=${encodeURIComponent(body)}`;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return;
    const fields = [...form.querySelectorAll('.json input, .json textarea')];
    const bad = fields.filter((f) => {
      f.value = f.value.trim();
      const invalid = !f.checkValidity();
      if (invalid) f.setAttribute('aria-invalid', 'true');
      else f.removeAttribute('aria-invalid');
      return invalid;
    });
    if (bad.length) {
      error.textContent = `422 Unprocessable Entity: check ${bad.map((f) => `"${f.name}"`).join(', ')}.`;
      bad[0].focus();
      return;
    }
    error.textContent = '';
    const data = {
      name: clean(form.elements.name.value, 120),
      email: clean(form.elements.email.value, 200).toLowerCase(),
      message: cleanMultiline(form.elements.message.value, 4000),
    };

    if (!endpoint) {
      location.href = mailtoFallback(data);
      show('201 Created', 'ok', { status: 'drafted', next: 'Your mail app opened with this request. Hit send there.' });
      say('Opening your mail app…');
      return;
    }

    sending = true;
    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    const t0 = performance.now();
    try {
      const result = await relaySend(endpoint, data, {
        website: form.elements.website.value,
        startedAt,
        onStage: (label) => (submit.textContent = label),
      });
      show(...result.status, result.ms);
      if (result.ok) {
        form.reset();
        startedAt = 0;
        say('Request delivered ✓');
      } else {
        appendFallback(data);
      }
    } catch {
      show(...STATUS.server_error, performance.now() - t0);
      appendFallback(data);
    } finally {
      sending = false;
      submit.disabled = false;
      submit.textContent = 'Send';
      form.removeAttribute('aria-busy');
    }
  });

  // On failure, offer the same request as a ready-made email so nothing is lost.
  function appendFallback(data) {
    const a = Object.assign(document.createElement('a'), { href: mailtoFallback(data), textContent: 'Send it as an email instead →' });
    a.className = 'api-fallback';
    response.append(a);
  }
}
