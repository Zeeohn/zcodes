// "Request a CV": the CV is never published in readable form. Visitors pick a
// role and request access (sent to Zion's inbox through the contact relay, or a
// prefilled email if the relay is unavailable); Zion replies with an
// access code or a magic link (#cv=CODE). The code decrypts assets/cv/cv.enc.json
// in the browser and a PDF tailored to the chosen role is generated on the spot.
// Format and parameters must match assets/cv/encrypt-cv.mjs.

import { relaySend, clean } from './contact.js';

const EMAIL = 'successzion21@gmail.com';
const BLOB_URL = 'assets/cv/cv.enc.json';
const ROLE_TITLES = {
  fullstack: 'Full-Stack Engineer',
  backend: 'Backend Engineer',
  frontend: 'Frontend Engineer',
  solutions: 'Integrations & Solutions Engineer',
};

const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const normaliseCode = (code) => code.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');

class AccessError extends Error {}

/** Derives the code's key, unwraps the data key and decrypts the CV source. */
async function decryptCv(code) {
  const { subtle } = globalThis.crypto ?? {};
  if (!subtle) throw new Error('This browser cannot decrypt the CV (WebCrypto needs HTTPS).');
  const blob = await (await fetch(BLOB_URL)).json();
  const normalised = normaliseCode(code);
  const entry = normalised.length === 16 && blob.keys.find((k) => k.id === normalised.slice(0, 4));
  if (!entry) throw new AccessError();
  try {
    const material = await subtle.importKey('raw', new TextEncoder().encode(normalised), 'PBKDF2', false, ['deriveKey']);
    const kek = await subtle.deriveKey(
      { name: 'PBKDF2', hash: blob.kdf.hash, salt: fromB64(entry.salt), iterations: blob.kdf.iterations },
      material, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
    );
    const rawKey = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(entry.iv) }, kek, fromB64(entry.key));
    const dataKey = await subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(blob.iv) }, dataKey, fromB64(blob.data));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new AccessError(); // a wrong code fails GCM authentication
  }
}

export function initCv({ say }) {
  const section = document.querySelector('#cv');
  const roleInput = () => section.querySelector('input[name="role"]:checked');
  const requestForm = section.querySelector('#cv-request');
  const requestError = requestForm.querySelector('.api-error');
  const requestOk = requestForm.querySelector('.api-response');
  const requestSubmit = requestForm.querySelector('[type="submit"]');
  const endpoint = document.querySelector('#hire-form')?.dataset.endpoint?.trim();
  let startedAt = 0;
  let sending = false;
  const unlockForm = section.querySelector('#cv-unlock');
  const codeInput = unlockForm.querySelector('#cv-code');
  const forInput = unlockForm.querySelector('#cv-for');
  const status = unlockForm.querySelector('.cv-status');
  const submit = unlockForm.querySelector('button[type="submit"]');
  let cv = null; // decrypted source, kept in memory so other roles need no new code
  let lastUrl = '';

  const show = (el) => {
    el.hidden = false;
    el.classList.remove('is-on');
    void el.offsetWidth; // restart the entrance animation
    el.classList.add('is-on');
  };

  // ---- Step 1: request access (relay → Zion's inbox; a prefilled email if the relay is unavailable)
  requestForm.noValidate = true;
  requestSubmit.disabled = false; // disabled in HTML so the no-JS form can't submit to the page URL
  requestForm.addEventListener('focusin', () => (startedAt ||= performance.now()));
  const answer = (code, cls, text, mailHref) => {
    const head = requestOk.querySelector('.api-status');
    head.textContent = code;
    head.className = `api-status code-${cls}`;
    requestOk.querySelector('.cv-next').textContent = text;
    const fallback = requestOk.querySelector('.cv-mail-fallback');
    fallback.hidden = !mailHref;
    if (mailHref) fallback.href = mailHref;
    show(requestOk);
  };
  requestForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return;
    const fields = [...requestForm.querySelectorAll('.json input')];
    const bad = fields.filter((f) => {
      f.value = f.value.trim();
      const invalid = !f.checkValidity();
      if (invalid) f.setAttribute('aria-invalid', 'true');
      else f.removeAttribute('aria-invalid');
      return invalid;
    });
    if (bad.length) {
      requestError.textContent = `422 Unprocessable Entity: check ${bad.map((f) => `"${f.name}"`).join(', ')}.`;
      bad[0].focus();
      return;
    }
    requestError.textContent = '';
    const role = ROLE_TITLES[roleInput().value];
    const name = clean(requestForm.elements.name.value, 120);
    const email = clean(requestForm.elements.email.value, 200).toLowerCase();
    const company = clean(requestForm.elements.company.value, 120);
    const message = [
      `CV REQUEST: ${role}`,
      `Company: ${company || '(not given)'}`,
      '',
      `Please send ${name} an access code (or a #cv= link) for the ${role} CV.`,
    ].join('\n');
    const subject = `CV request: ${role} — ${name}${company ? ` (${company})` : ''}`;
    const mailHref = `mailto:${EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${message}\n\nReply to: ${email}\n`)}`;

    if (!endpoint) {
      location.href = mailHref;
      answer('202 Accepted', 'ok', 'Your mail app opened with the request; hit send there. I reply with an access code, usually within a day or two.', mailHref);
      say('Opening your mail app…');
      return;
    }
    sending = true;
    requestSubmit.disabled = true;
    requestForm.setAttribute('aria-busy', 'true');
    try {
      const result = await relaySend(endpoint, { name, email, message }, {
        website: requestForm.elements.website.value,
        startedAt,
        onStage: (label) => (requestSubmit.textContent = label),
      });
      if (result.ok) {
        answer('202 Accepted', 'ok', `Request received. I'll email ${email} an access code for the ${role} CV, usually within a day or two.`);
        requestForm.querySelectorAll('.json input').forEach((f) => (f.value = ''));
        startedAt = 0;
        say('CV request sent ✓');
      } else {
        const [code, cls, body] = result.status;
        answer(code, cls, `${body.error || 'The request could not be sent.'} You can send it as an email instead:`, mailHref);
      }
    } catch {
      answer('503 Service Unavailable', 'err', 'The relay is unreachable right now. You can send the request as an email instead:', mailHref);
    } finally {
      sending = false;
      requestSubmit.disabled = false;
      requestSubmit.textContent = 'Request access';
      requestForm.removeAttribute('aria-busy');
    }
  });

  // ---- Step 2: unlock with the access code and generate the tailored PDF
  unlockForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const role = roleInput().value;
    status.hidden = false;
    status.className = 'cv-status mono';
    submit.disabled = true;
    try {
      if (!cv) {
        if (!codeInput.value.trim()) {
          codeInput.setAttribute('aria-invalid', 'true');
          codeInput.focus();
          throw new AccessError('Enter the access code from your email.');
        }
        status.textContent = '… verifying access code';
        cv = await decryptCv(codeInput.value);
        codeInput.removeAttribute('aria-invalid');
      }
      status.textContent = `… generating the ${ROLE_TITLES[role]} CV`;
      const { buildCvPdf } = await import('./cv-pdf.js');
      const bytes = await buildCvPdf(cv, role, { preparedFor: forInput.value.trim() });
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const filename = `Zion-Success-CV-${ROLE_TITLES[role].replace(/[^A-Za-z]+/g, '-').replace(/-$/, '')}.pdf`;
      const link = Object.assign(document.createElement('a'), { href: lastUrl, download: filename, textContent: `Download ${filename}` });
      status.classList.add('is-ok');
      status.replaceChildren(Object.assign(document.createElement('span'), { className: 'code-ok', textContent: '200 OK' }), ' CV generated. ', link);
      link.click();
      say('CV downloaded ✓');
    } catch (err) {
      status.classList.add('is-err');
      if (err instanceof AccessError) {
        status.textContent = `401 Unauthorized: ${err.message || 'that access code is not valid. Check it, or request one above.'}`;
        codeInput.setAttribute('aria-invalid', 'true');
      } else {
        status.textContent = `503: ${err.message || 'could not generate the CV. Please try again.'}`;
      }
    } finally {
      submit.disabled = false;
    }
  });

  // Once unlocked, the code field is no longer needed for other roles.
  section.addEventListener('change', (e) => {
    if (e.target.name === 'role' && cv) submit.textContent = `Download ${ROLE_TITLES[e.target.value]} CV`;
  });

  // ---- Magic link: #cv=CODE (optionally &role=backend). The code is read, then
  // removed from the address bar so it doesn't linger in screenshots or shares.
  const m = location.hash.match(/^#cv=([0-9A-Za-z-]+)(?:&role=(\w+))?$/);
  if (m) {
    codeInput.value = m[1];
    if (ROLE_TITLES[m[2]]) section.querySelector(`input[name="role"][value="${m[2]}"]`).checked = true;
    history.replaceState(null, '', `${location.pathname}${location.search}#cv`);
    document.dispatchEvent(new CustomEvent('nav:goto', { detail: { selector: '#cv', focus: '#cv-unlock button[type="submit"]' } }));
  }
}
