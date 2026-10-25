/**
 * Contact relay for the portfolio's "POST /v1/hire-zion" form.
 *
 * A Google Apps Script web app that receives the form as JSON and delivers it to
 * RECIPIENT with Gmail (MailApp). Deploy it from the Google account that should
 * send the mail; see README.md next to this file.
 *
 * Abuse controls, cheapest first (spam is dropped silently so bots learn nothing):
 *   1. size and shape checks on the payload and every field;
 *   2. a honeypot field that humans never see;
 *   3. a minimum fill time (bots submit instantly);
 *   4. a proof-of-work stamp bound to this exact message, valid for 15 minutes
 *      and accepted once (blocks replay and makes bulk sending expensive);
 *   5. content scoring (links, spam phrases, shouting) that drops obvious spam
 *      and tags borderline mail "[possible spam]" instead of losing it;
 *   6. rate limits per sender address and globally, kept under Gmail's quota.
 *
 * The mail is plain text only (no HTML injection), the subject and reply-to are
 * stripped of line breaks (no header injection), and the sender never gets an
 * automatic reply, so the endpoint can't be used to mail third parties.
 */

const RECIPIENT = 'zcodes.dev@gmail.com';
const SITE_ORIGIN = 'https://zeeohn.github.io/zcodes/';

const LIMITS = {
  bodyBytes: 12000,
  name: 120,
  email: 200,
  message: 4000,
  minMessage: 10,
  minFillMs: 3000, // faster than this is a bot
  stampTtlMs: 15 * 60 * 1000,
  powBits: 14, // must match DIFFICULTY in assets/js/contact.js
  perSenderPerHour: 3,
  globalPerHour: 20,
  globalPerDay: 80, // consumer Gmail allows ~100 MailApp recipients/day
};

const SPAM_PHRASES = [
  'seo', 'backlink', 'casino', 'crypto investment', 'forex', 'viagra', 'cialis', 'loan offer',
  'guest post', 'rank your website', 'web traffic', 'buy followers', 'click here', 'bitcoin doubling',
];

/** Entry point for POST requests. Always answers 200 with { ok, code }. */
function doPost(e) {
  try {
    return json(handle(e));
  } catch (err) {
    console.error(err);
    return json({ ok: false, code: 'server_error' });
  }
}

/** GET is only a health check, so a deployed URL can be verified in a browser. */
function doGet() {
  return json({ ok: true, service: 'hire-zion contact relay' });
}

function handle(e) {
  const raw = e && e.postData && e.postData.contents;
  if (!raw || raw.length > LIMITS.bodyBytes) return { ok: false, code: 'bad_request' };

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return { ok: false, code: 'bad_request' };
  }
  if (!data || typeof data !== 'object') return { ok: false, code: 'bad_request' };

  const name = clean(data.name, LIMITS.name);
  const email = clean(data.email, LIMITS.email).toLowerCase();
  const message = cleanMultiline(data.message, LIMITS.message);
  if (!name || !isEmail(email) || message.length < LIMITS.minMessage) return { ok: false, code: 'invalid' };

  // Silent drops: answer like a success so automated senders can't tune themselves.
  const accepted = { ok: true, code: 'accepted' };
  if (typeof data.website === 'string' && data.website.trim() !== '') return accepted; // honeypot
  if (!(Number(data.elapsed) >= LIMITS.minFillMs)) return accepted;

  const pow = verifyStamp(data.stamp, email, message);
  if (!pow.ok) return { ok: false, code: pow.code };

  const score = spamScore(name, email, message);
  if (score >= 5) return accepted;

  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    if (cache.get('stamp:' + pow.key)) return { ok: false, code: 'replay' };
    const sender = 'sender:' + digestHex(email);
    if (bump(cache, sender, 3600, LIMITS.perSenderPerHour) === false) return { ok: false, code: 'rate_limited' };
    if (bump(cache, 'global:hour', 3600, LIMITS.globalPerHour) === false) return { ok: false, code: 'rate_limited' };
    if (bumpDaily(LIMITS.globalPerDay) === false) return { ok: false, code: 'rate_limited' };
    cache.put('stamp:' + pow.key, '1', Math.ceil(LIMITS.stampTtlMs / 1000));
  } finally {
    lock.releaseLock();
  }

  // CV requests (assets/js/cv.js) start with "CV REQUEST: <role>"; give them their own subject.
  const cvRole = (message.match(/^CV REQUEST: (.{1,60})$/m) || [])[1];
  const subject = (score >= 2 ? '[possible spam] ' : '') + (cvRole ? 'CV request (' + cvRole + ') from ' : 'Hire request from ') + name;
  const body = [
    'New request from the portfolio contact form (' + SITE_ORIGIN + ')',
    '',
    'Name:    ' + name,
    'Email:   ' + email,
    'Sent:    ' + new Date().toISOString(),
    'Spam score: ' + score + ' (0 is clean; 5+ is dropped)',
    '',
    '--- Message ---',
    message,
    '',
    '--- Reply directly to this email to answer ' + name + '. ---',
  ].join('\n');

  MailApp.sendEmail({
    to: RECIPIENT,
    subject: subject.replace(/[\r\n]+/g, ' ').slice(0, 180),
    body: body,
    name: 'Portfolio contact form',
    replyTo: email,
  });
  return { ok: true, code: 'delivered' };
}

/* ---------------- helpers ---------------- */

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Single-line field: strip control characters (including CR/LF) and collapse spaces. */
function clean(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Multi-line field: keep newlines and tabs, strip other control characters. */
function cleanMultiline(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]+/g, '').trim().slice(0, max);
}

function isEmail(value) {
  return /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$/i.test(value);
}

function digestHex(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); })
    .join('');
}

/**
 * Stamp format: "v1:<timestamp ms>:<nonce>". Valid when
 * SHA-256("v1|<ts>|<email>|<sha256(message)>|<nonce>") starts with powBits zero bits
 * and ts is within the last 15 minutes. The browser finds the nonce by brute force.
 */
function verifyStamp(stamp, email, message) {
  if (typeof stamp !== 'string') return { ok: false, code: 'bad_stamp' };
  const parts = stamp.split(':');
  if (parts.length !== 3 || parts[0] !== 'v1' || !/^\d{13}$/.test(parts[1]) || !/^\d{1,10}$/.test(parts[2])) {
    return { ok: false, code: 'bad_stamp' };
  }
  const age = Date.now() - Number(parts[1]);
  if (age < -60000 || age > LIMITS.stampTtlMs) return { ok: false, code: 'stale_stamp' };
  const hash = digestHex('v1|' + parts[1] + '|' + email + '|' + digestHex(message) + '|' + parts[2]);
  if (!leadingZeroBits(hash, LIMITS.powBits)) return { ok: false, code: 'bad_stamp' };
  return { ok: true, key: hash };
}

function leadingZeroBits(hex, bits) {
  const full = Math.floor(bits / 4);
  if (hex.slice(0, full) !== '0'.repeat(full)) return false;
  const rest = bits % 4;
  return rest === 0 || parseInt(hex[full], 16) < 1 << (4 - rest);
}

/** Rough spam score from the content: links, known spam phrases, shouting, junk addresses. */
function spamScore(name, email, message) {
  const text = (name + ' ' + message).toLowerCase();
  let score = 0;
  const links = (message.match(/https?:\/\/|www\./gi) || []).length;
  if (links >= 2) score += 2;
  if (links >= 4) score += 3;
  SPAM_PHRASES.forEach(function (phrase) {
    if (text.indexOf(phrase) !== -1) score += 2;
  });
  if (/https?:\/\/|www\./i.test(name)) score += 3;
  const letters = message.replace(/[^a-z]/gi, '');
  if (letters.length > 30 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.6) score += 2;
  if (/<a\s|\[url=|\[link=/i.test(message)) score += 3;
  if (/@(mailinator|guerrillamail|10minutemail|yopmail|trashmail)\./.test(email)) score += 2;
  return score;
}

/**
 * Daily counter in script properties (CacheService entries live 6 hours at most).
 * One key per UTC day; older days' keys are removed as the day rolls over.
 */
function bumpDaily(max) {
  const props = PropertiesService.getScriptProperties();
  const key = 'day:' + new Date().toISOString().slice(0, 10);
  const count = Number(props.getProperty(key) || 0);
  if (count >= max) return false;
  if (count === 0) {
    props.getKeys().forEach(function (k) {
      if (k.indexOf('day:') === 0 && k !== key) props.deleteProperty(k);
    });
  }
  props.setProperty(key, String(count + 1));
  return true;
}

/** Increments a windowed counter (TTL ≤ 6 hours); returns false once it would exceed max. */
function bump(cache, key, seconds, max) {
  const count = Number(cache.get(key) || 0);
  if (count >= max) return false;
  cache.put(key, String(count + 1), seconds);
  return true;
}
