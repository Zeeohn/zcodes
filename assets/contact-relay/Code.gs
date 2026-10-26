/**
 * Contact relay and visit analytics for the portfolio.
 *
 * Part 1 (below): the "POST /v1/hire-zion" contact form and CV download notices.
 * Part 2 (further down, "Analytics"): first-party visit analytics stored in a
 * Google Sheet in this account's Drive, a private dashboard and a daily digest.
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

/**
 * GET is a health check, so a deployed URL can be verified in a browser, and the
 * analytics dashboard when called with ?view=dashboard&key=<DASHBOARD_KEY>.
 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.view === 'dashboard' && p.key && p.key === PropertiesService.getScriptProperties().getProperty('DASHBOARD_KEY')) {
    return HtmlService.createHtmlOutput(renderDashboard(Number(p.days) || 30))
      .setTitle('Portfolio analytics')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
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
  if (data.type === 'analytics') return recordVisit(data);

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

  // CV download notices (assets/js/cv.js) start with "CV DOWNLOAD: <role>"; give them their own subject.
  const cvRole = (message.match(/^CV DOWNLOAD: (.{1,60})$/m) || [])[1];
  const subject = (score >= 2 ? '[possible spam] ' : '') + (cvRole ? 'CV downloaded (' + cvRole + ') by ' : 'Hire request from ') + name;
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

/* =================================================================================
 * Part 2 · Analytics
 *
 * assets/js/analytics.js posts one "pageview" per visit and "update"s as the visit
 * goes on. Each is appended as a row to the "Visits" sheet of a spreadsheet this
 * script creates in Drive ("Portfolio analytics"). Rows hold no IP addresses: the
 * browser sends only an approximate location. One-time setup: run setup() from the
 * editor (see README.md); it creates the sheet, the dashboard key and the digest.
 * ================================================================================= */

const ANALYTICS = {
  sheetName: 'Visits',
  maxRowsPerVisitHour: 40, // a visit sends a handful; more is noise or abuse
  maxRowsPerDay: 5000,
  retentionDays: 400,
  readRows: 20000, // the dashboard reads at most this many recent rows
  digestHour: 8, // in the script's timezone (Project settings)
};
const COLUMNS = ['Received', 'Kind', 'Visit', 'Visitor', 'Country', 'City', 'Organisation', 'Source',
  'Device', 'Browser', 'Engaged (s)', 'Sections', 'Name', 'Email', 'Company', 'Data'];

/** Validates and stores one analytics event. Silent about problems (fire-and-forget beacons). */
function recordVisit(d) {
  const ok = { ok: true, code: 'recorded' };
  const sid = clean(d.sid, 20);
  const vid = clean(d.vid, 20);
  if (!/^[a-z0-9]{6,20}$/.test(sid) || !/^[a-z0-9]{6,20}$/.test(vid)) return ok;
  if (d.kind !== 'pageview' && d.kind !== 'update') return ok;
  if (/bot|crawl|spider|headless|lighthouse/i.test(clean(d.browser, 40) + clean(d.os, 40))) return ok;

  const cache = CacheService.getScriptCache();
  if (bump(cache, 'visit:' + sid, 3600, ANALYTICS.maxRowsPerVisitHour) === false) return ok;
  if (bumpCounter('aday:', ANALYTICS.maxRowsPerDay) === false) return ok;

  const v = {
    kind: d.kind, sid: sid, vid: vid, visit: Math.max(1, Math.min(9999, Number(d.visit) || 1)),
    country: clean(d.country, 60), cc: clean(d.cc, 2).toUpperCase(), region: clean(d.region, 60), city: clean(d.city, 60),
    org: clean(d.org, 100), ref: clean(d.ref, 300), refHost: clean(d.refHost, 100), utm: clean(d.utm, 200),
    entry: clean(d.entry, 120), device: clean(d.device, 10), browser: clean(d.browser, 20), os: clean(d.os, 20),
    lang: clean(d.lang, 20), tz: clean(d.tz, 50), screen: clean(d.screen, 12), viewport: clean(d.viewport, 12), net: clean(d.net, 8),
    scroll: Math.max(0, Math.min(100, Number(d.scroll) || 0)),
    engaged: Math.max(0, Math.min(86400, Number(d.engaged) || 0)),
    sections: (Array.isArray(d.sections) ? d.sections : []).slice(0, 20).map(function (x) { return clean(x, 20); }).filter(Boolean),
    events: (Array.isArray(d.events) ? d.events : []).slice(-60).map(cleanEvent).filter(Boolean),
  };
  const who = d.who && typeof d.who === 'object' ? d.who : null;
  if (who) v.who = { name: clean(who.name, 120), email: clean(who.email, 200).toLowerCase(), company: clean(who.company, 120) };

  const source = v.refHost || (v.utm ? 'utm: ' + v.utm : 'Direct');
  analyticsSheet().appendRow([new Date(), v.kind, v.sid, v.vid, v.country || v.tz, v.city, v.org, source,
    v.device, v.browser + ' / ' + v.os, v.engaged, v.sections.join(' > '),
    v.who ? v.who.name : '', v.who ? v.who.email : '', v.who ? v.who.company : '', JSON.stringify(v)]);
  return ok;
}

function cleanEvent(e) {
  if (!e || typeof e !== 'object') return null;
  const n = clean(e.n, 40);
  if (!/^[a-z_]{2,40}$/.test(n)) return null;
  const out = { n: n, t: Math.max(0, Math.min(86400, Number(e.t) || 0)) };
  ['slug', 'to', 'role'].forEach(function (k) {
    if (typeof e[k] === 'string') out[k] = clean(e[k], 80);
  });
  return out;
}

/** The "Visits" sheet, creating the spreadsheet on first use. */
function analyticsSheet() {
  const props = PropertiesService.getScriptProperties();
  let book = null;
  const id = props.getProperty('ANALYTICS_SHEET_ID');
  if (id) {
    try {
      book = SpreadsheetApp.openById(id);
    } catch (err) {
      book = null; // deleted or inaccessible: start a new one
    }
  }
  if (!book) {
    book = SpreadsheetApp.create('Portfolio analytics');
    props.setProperty('ANALYTICS_SHEET_ID', book.getId());
  }
  let sheet = book.getSheetByName(ANALYTICS.sheetName);
  if (!sheet) {
    sheet = book.getSheets()[0].setName(ANALYTICS.sheetName);
    sheet.appendRow(COLUMNS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
  }
  return sheet;
}

/** Daily counter in script properties under prefix+date; returns false at max. */
function bumpCounter(prefix, max) {
  const props = PropertiesService.getScriptProperties();
  const key = prefix + new Date().toISOString().slice(0, 10);
  const count = Number(props.getProperty(key) || 0);
  if (count >= max) return false;
  if (count === 0) {
    props.getKeys().forEach(function (k) {
      if (k.indexOf(prefix) === 0 && k !== key) props.deleteProperty(k);
    });
  }
  props.setProperty(key, String(count + 1));
  return true;
}

/* ---------- One-time setup, digest and retention ---------- */

/**
 * Run once from the editor (Run ▸ setup) after deploying a new version: creates the
 * sheet and the dashboard key, schedules the daily digest, and emails you both links.
 */
function setup() {
  const props = PropertiesService.getScriptProperties();
  const sheet = analyticsSheet();
  if (!props.getProperty('DASHBOARD_KEY')) props.setProperty('DASHBOARD_KEY', Utilities.getUuid().replace(/-/g, ''));
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDailyDigest') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDailyDigest').timeBased().everyDays(1).atHour(ANALYTICS.digestHour).create();
  const links = 'Dashboard (keep this link private): ' + dashboardUrl() + '\n\nRaw data: ' + sheet.getParent().getUrl() +
    '\n\nTo stop counting your own visits, open ' + SITE_ORIGIN + '?owner=1 once in each browser you use.';
  MailApp.sendEmail(RECIPIENT, 'Portfolio analytics is set up', links);
  console.log(links);
}

function dashboardUrl() {
  return ScriptApp.getService().getUrl() + '?view=dashboard&key=' + PropertiesService.getScriptProperties().getProperty('DASHBOARD_KEY');
}

/** Time-driven (set up by setup()): emails yesterday's summary and prunes old rows. */
function sendDailyDigest() {
  pruneOldRows();
  const s = summarize(readVisits(), Date.now() - 24 * 3600 * 1000);
  if (!s.sessions.length) return;
  const top = function (list, n) {
    return list.slice(0, n || 5).map(function (r) { return '  ' + r[1] + ' × ' + r[0]; }).join('\n') || '  —';
  };
  const lines = [
    'Last 24 hours on ' + SITE_ORIGIN,
    '',
    s.visitors + ' visitors · ' + s.sessions.length + ' visits · ' + s.returning + ' returning · avg engaged ' + fmtDuration(s.avgEngaged),
    s.cvDownloads.length + ' CV downloads · ' + s.contacts + ' contact messages',
    '',
    'Where from:', top(s.countries),
    '', 'Networks / companies:', top(s.orgs),
    '', 'Sources:', top(s.sources),
  ];
  if (s.people.length) {
    lines.push('', 'People who identified themselves:');
    s.people.forEach(function (p) { lines.push('  ' + p.name + ' <' + p.email + '>' + (p.company ? ' · ' + p.company : '') + ' · ' + p.where); });
  }
  const notable = s.sessions.filter(function (x) { return x.engaged >= 60; }).slice(0, 15);
  if (notable.length) {
    lines.push('', 'Engaged visits (1 min+):');
    notable.forEach(function (x) { lines.push('  ' + describeSession(x)); });
  }
  lines.push('', 'Dashboard: ' + dashboardUrl());
  MailApp.sendEmail(RECIPIENT, 'Portfolio: ' + s.visitors + ' visitors yesterday', lines.join('\n'));
}

function pruneOldRows() {
  const sheet = analyticsSheet();
  const last = sheet.getLastRow();
  if (last < 2) return;
  const cutoff = Date.now() - ANALYTICS.retentionDays * 86400000;
  const dates = sheet.getRange(2, 1, last - 1, 1).getValues();
  let n = 0;
  while (n < dates.length && new Date(dates[n][0]).getTime() < cutoff) n++;
  if (n) sheet.deleteRows(2, n);
}

/* ---------- Aggregation (shared by the dashboard and the digest) ---------- */

/** Recent rows as { at, v } with the parsed event payload. */
function readVisits() {
  const sheet = analyticsSheet();
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const first = Math.max(2, last - ANALYTICS.readRows + 1);
  return sheet.getRange(first, 1, last - first + 1, COLUMNS.length).getValues().map(function (r) {
    try {
      return { at: new Date(r[0]).getTime(), v: JSON.parse(r[COLUMNS.length - 1]) };
    } catch (err) {
      return null;
    }
  }).filter(Boolean);
}

/**
 * Folds rows into visits and counts everything the views need. A visit's rows are
 * merged (union of sections and events, maximum engaged time and scroll), so the
 * result doesn't depend on the order beacons arrived in.
 */
function summarize(rows, since) {
  const identities = {}; // visitor id → who, from any time
  const byVisit = {};
  rows.forEach(function (r) {
    if (r.v.who && r.v.who.email) identities[r.v.vid] = r.v.who;
    if (r.at < since) return;
    const cur = byVisit[r.v.sid];
    if (!cur) {
      byVisit[r.v.sid] = Object.assign({}, r.v, { start: r.at, last: r.at });
      return;
    }
    const keyOf = function (e) { return e.n + '|' + e.t + '|' + (e.slug || e.to || e.role || ''); };
    const seen = {};
    cur.events.forEach(function (e) { seen[keyOf(e)] = 1; });
    r.v.events.forEach(function (e) { if (!seen[keyOf(e)]) cur.events.push(e); });
    r.v.sections.forEach(function (x) { if (cur.sections.indexOf(x) < 0) cur.sections.push(x); });
    cur.engaged = Math.max(cur.engaged, r.v.engaged);
    cur.scroll = Math.max(cur.scroll, r.v.scroll);
    cur.who = r.v.who || cur.who;
    ['country', 'cc', 'region', 'city', 'org'].forEach(function (k) { cur[k] = cur[k] || r.v[k]; });
    cur.last = Math.max(cur.last, r.at);
  });
  const sessions = Object.keys(byVisit).map(function (k) { return byVisit[k]; })
    .sort(function (a, b) { return b.last - a.last; });
  sessions.forEach(function (x) { x.who = identities[x.vid] || x.who || null; });

  const count = function (fn) {
    const m = {};
    sessions.forEach(function (x) {
      [].concat(fn(x)).forEach(function (k) { if (k) m[k] = (m[k] || 0) + 1; });
    });
    return Object.keys(m).map(function (k) { return [k, m[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
  };
  const events = function (name, key) {
    return count(function (x) {
      return x.events.filter(function (e) { return e.n === name; }).map(function (e) { return key ? e[key] : name; });
    });
  };
  const visitorIds = {};
  sessions.forEach(function (x) { visitorIds[x.vid] = (visitorIds[x.vid] || 0) + 1; });
  const engagedSum = sessions.reduce(function (a, x) { return a + x.engaged; }, 0);

  const days = {};
  sessions.forEach(function (x) {
    const day = Utilities.formatDate(new Date(x.start), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    days[day] = days[day] || { visits: 0, visitors: {} };
    days[day].visits++;
    days[day].visitors[x.vid] = 1;
  });

  const peopleMap = {};
  sessions.forEach(function (x) {
    if (!x.who || !x.who.email) return;
    const p = peopleMap[x.who.email] || (peopleMap[x.who.email] = { name: x.who.name, email: x.who.email, company: x.who.company, visits: 0, last: 0, where: '', cv: [] });
    p.visits++;
    if (x.last > p.last) {
      p.last = x.last;
      p.where = place(x);
    }
    x.events.forEach(function (e) { if (e.n === 'cv_download' && e.role && p.cv.indexOf(e.role) < 0) p.cv.push(e.role); });
  });

  return {
    sessions: sessions,
    visitors: Object.keys(visitorIds).length,
    returning: sessions.filter(function (x) { return x.visit > 1; }).length,
    bounces: sessions.filter(function (x) { return x.engaged < 10 && x.sections.length <= 1; }).length,
    avgEngaged: sessions.length ? Math.round(engagedSum / sessions.length) : 0,
    avgScroll: sessions.length ? Math.round(sessions.reduce(function (a, x) { return a + x.scroll; }, 0) / sessions.length) : 0,
    days: days,
    countries: count(function (x) { return x.country ? flag(x.cc) + ' ' + x.country : 'Unknown (' + (x.tz || '?') + ')'; }),
    cities: count(function (x) { return x.city ? x.city + ', ' + (x.cc || x.country) : null; }),
    orgs: count(function (x) { return x.org; }),
    sources: count(function (x) { return x.refHost || (x.utm ? 'utm: ' + x.utm : 'Direct'); }),
    devices: count(function (x) { return x.device; }),
    browsers: count(function (x) { return x.browser; }),
    oses: count(function (x) { return x.os; }),
    langs: count(function (x) { return x.lang; }),
    sections: count(function (x) { return x.sections; }),
    actions: count(function (x) { return x.events.map(function (e) { return e.n; }).filter(function (n, i, a) { return n !== 'identify' && a.indexOf(n) === i; }); }),
    cases: events('case_open', 'slug'),
    outbound: events('outbound', 'to'),
    cvRoles: events('cv_download', 'role'),
    cvDownloads: sessions.filter(function (x) { return x.events.some(function (e) { return e.n === 'cv_download'; }); }),
    contacts: sessions.filter(function (x) { return x.events.some(function (e) { return e.n === 'contact_sent'; }); }).length,
    people: Object.keys(peopleMap).map(function (k) { return peopleMap[k]; }).sort(function (a, b) { return b.last - a.last; }),
  };
}

function place(x) {
  return [x.city, x.country].filter(Boolean).join(', ') || (x.tz ? 'timezone ' + x.tz : 'unknown');
}

function describeSession(x) {
  return [
    Utilities.formatDate(new Date(x.start), Session.getScriptTimeZone(), 'MMM d HH:mm'),
    place(x) + (x.org ? ' (' + x.org + ')' : ''),
    'via ' + (x.refHost || (x.utm ? 'utm ' + x.utm : 'direct')),
    x.device + '/' + x.browser,
    fmtDuration(x.engaged) + ' engaged',
    x.who ? 'ID: ' + x.who.name + ' <' + x.who.email + '>' : '',
  ].filter(Boolean).join(' · ');
}

function fmtDuration(s) {
  s = Math.round(s || 0);
  return s >= 60 ? Math.floor(s / 60) + 'm ' + (s % 60) + 's' : s + 's';
}

function flag(cc) {
  if (!/^[A-Z]{2}$/.test(cc || '')) return '';
  return String.fromCodePoint(0x1f1e6 + cc.charCodeAt(0) - 65, 0x1f1e6 + cc.charCodeAt(1) - 65);
}

/* ---------- Dashboard (HtmlService; every visitor-supplied value is escaped) ---------- */

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function renderDashboard(days) {
  days = [7, 30, 90, 365].indexOf(days) >= 0 ? days : 30;
  const since = Date.now() - days * 86400000;
  const s = summarize(readVisits(), since);
  const key = PropertiesService.getScriptProperties().getProperty('DASHBOARD_KEY');
  const n = s.sessions.length;
  const pct = function (a) { return n ? Math.round((a / n) * 100) + '%' : '—'; };

  const table = function (title, rows, opts) {
    opts = opts || {};
    const body = rows.slice(0, opts.limit || 10).map(function (r) {
      const w = n ? Math.max(2, Math.round((r[1] / (rows[0][1] || 1)) * 100)) : 0;
      return '<tr><td><span class="bar" style="width:' + w + '%"></span><span class="lbl">' + esc(r[0]) + '</span></td><td class="num">' + r[1] + '</td></tr>';
    }).join('') || '<tr><td colspan="2" class="dim">No data yet</td></tr>';
    return '<section class="card"><h2>' + esc(title) + '</h2><table>' + body + '</table></section>';
  };

  // Visits per day (inline SVG)
  const dayKeys = [];
  for (let t = since; t <= Date.now(); t += 86400000) dayKeys.push(Utilities.formatDate(new Date(t), Session.getScriptTimeZone(), 'yyyy-MM-dd'));
  const maxDay = Math.max.apply(null, dayKeys.map(function (k) { return s.days[k] ? s.days[k].visits : 0; }).concat([1]));
  const bw = 100 / dayKeys.length;
  const bars = dayKeys.map(function (k, i) {
    const v = s.days[k] ? s.days[k].visits : 0;
    const u = s.days[k] ? Object.keys(s.days[k].visitors).length : 0;
    const h = (v / maxDay) * 100;
    return '<rect x="' + (i * bw + bw * 0.15).toFixed(2) + '%" y="' + (100 - h).toFixed(2) + '%" width="' + (bw * 0.7).toFixed(2) + '%" height="' + h.toFixed(2) + '%" rx="2"><title>' + k + ': ' + v + ' visits, ' + u + ' visitors</title></rect>';
  }).join('');

  const sectionOrder = ['top', 'system', 'impact', 'career', 'remote', 'work', 'skills', 'cv', 'contact'];
  const reach = sectionOrder.map(function (id) {
    const c = (s.sections.filter(function (r) { return r[0] === id; })[0] || [id, 0])[1];
    return [id === 'top' ? 'hero' : id, c];
  });

  const people = s.people.map(function (p) {
    return '<tr><td><b>' + esc(p.name) + '</b><br><a href="mailto:' + esc(p.email) + '">' + esc(p.email) + '</a></td><td>' + esc(p.company || '—') + '</td><td>' + esc(p.where) +
      '</td><td>' + esc(p.cv.join(', ') || '—') + '</td><td class="num">' + p.visits + '</td><td class="dim">' + esc(Utilities.formatDate(new Date(p.last), Session.getScriptTimeZone(), 'MMM d, HH:mm')) + '</td></tr>';
  }).join('') || '<tr><td colspan="6" class="dim">Nobody has identified themselves yet (CV downloads and contact messages do).</td></tr>';

  const recent = s.sessions.slice(0, 80).map(function (x) {
    const acts = x.events.filter(function (e) { return e.n !== 'identify'; }).map(function (e) { return e.n.replace(/_/g, ' ') + (e.slug || e.to || e.role ? ': ' + (e.slug || e.to || e.role) : ''); });
    return '<tr><td class="dim">' + esc(Utilities.formatDate(new Date(x.start), Session.getScriptTimeZone(), 'MMM d, HH:mm')) + '</td>' +
      '<td>' + esc(flag(x.cc) + ' ' + place(x)) + (x.org ? '<br><span class="dim">' + esc(x.org) + '</span>' : '') + '</td>' +
      '<td>' + esc(x.refHost || (x.utm ? 'utm: ' + x.utm : 'Direct')) + (x.visit > 1 ? '<br><span class="tag">visit #' + x.visit + '</span>' : '') + '</td>' +
      '<td>' + esc(x.device + ' · ' + x.browser + ' · ' + x.os) + '<br><span class="dim">' + esc(x.lang + ' · ' + x.screen) + '</span></td>' +
      '<td class="num">' + fmtDuration(x.engaged) + '<br><span class="dim">' + x.scroll + '% scrolled</span></td>' +
      '<td>' + esc(x.sections.join(' → ')) + (acts.length ? '<br><span class="acts">' + esc(acts.join(' · ')) + '</span>' : '') + '</td>' +
      '<td>' + (x.who ? '<b>' + esc(x.who.name) + '</b><br><span class="dim">' + esc(x.who.email) + '</span>' : '<span class="dim">anonymous</span>') + '</td></tr>';
  }).join('') || '<tr><td colspan="7" class="dim">No visits in this period.</td></tr>';

  const range = [7, 30, 90, 365].map(function (d) {
    return '<a class="' + (d === days ? 'on' : '') + '" href="' + esc(ScriptApp.getService().getUrl() + '?view=dashboard&key=' + key + '&days=' + d) + '" target="_top">' + d + 'd</a>';
  }).join('');

  const kpi = function (label, value, sub) {
    return '<div class="kpi"><span class="k">' + esc(label) + '</span><b>' + esc(value) + '</b>' + (sub ? '<span class="dim">' + esc(sub) + '</span>' : '') + '</div>';
  };

  return '<!doctype html><html><head><meta charset="utf-8"><style>' + DASHBOARD_CSS + '</style></head><body><main>' +
    '<header><div><p class="eyebrow">zeeohn.github.io/zcodes</p><h1>Portfolio analytics</h1></div><nav>' + range + '</nav></header>' +
    '<div class="kpis">' +
    kpi('Visitors', s.visitors, 'unique browsers') +
    kpi('Visits', n, s.returning + ' returning') +
    kpi('Avg engaged time', fmtDuration(s.avgEngaged), 'avg ' + s.avgScroll + '% scrolled') +
    kpi('Bounce rate', pct(s.bounces), '<10s and one section') +
    kpi('CV downloads', s.cvDownloads.length, s.cvRoles.map(function (r) { return r[0] + ' ' + r[1]; }).join(' · ')) +
    kpi('Contact messages', s.contacts, '') +
    '</div>' +
    '<section class="card wide"><h2>Visits per day</h2><svg class="chart" viewBox="0 0 100 100" preserveAspectRatio="none">' + bars + '</svg><p class="dim axis"><span>' + dayKeys[0] + '</span><span>today</span></p></section>' +
    '<section class="card wide"><h2>People who identified themselves</h2><div class="scroll"><table class="list"><tr><th>Who</th><th>Company</th><th>Where</th><th>CV</th><th>Visits</th><th>Last seen</th></tr>' + people + '</table></div></section>' +
    '<div class="grid">' +
    table('Countries', s.countries) + table('Cities', s.cities) + table('Networks / companies', s.orgs) +
    table('Sources', s.sources) + table('Sections reached', reach, { limit: 12 }) + table('Actions', s.actions) +
    table('Case studies opened', s.cases) + table('Outbound clicks', s.outbound) + table('Devices', s.devices) +
    table('Browsers', s.browsers) + table('Operating systems', s.oses) + table('Languages', s.langs) +
    '</div>' +
    '<section class="card wide"><h2>Recent visits</h2><div class="scroll"><table class="list"><tr><th>When</th><th>Where</th><th>Source</th><th>Device</th><th>Time</th><th>Path & actions</th><th>Who</th></tr>' + recent + '</table></div></section>' +
    '<p class="dim foot">Locations are approximate (from the network, never stored as IP addresses). Visitors who opt out, send Global Privacy Control or Do Not Track, bots and your own browsers (?owner=1) are not counted. Raw data: the "Portfolio analytics" spreadsheet in your Drive.</p>' +
    '</main></body></html>';
}

const DASHBOARD_CSS = [
  ':root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0B1220;color:#E6EAF2;font:14px/1.5 Inter,system-ui,-apple-system,Segoe UI,sans-serif}',
  'main{max-width:1240px;margin:0 auto;padding:28px 18px 60px}header{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:end;gap:12px;margin-bottom:22px}',
  'h1{margin:0;font-size:28px;letter-spacing:-.02em}.eyebrow{margin:0 0 4px;color:#94A3B8;font:12px ui-monospace,Menlo,monospace}',
  'nav{display:flex;gap:6px}nav a{padding:6px 12px;border:1px solid rgba(255,255,255,.16);border-radius:999px;color:#94A3B8;text-decoration:none;font-weight:600}nav a.on{background:#E6EAF2;color:#0B1220}',
  '.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:12px}',
  '.kpi,.card{background:#0F172A;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:16px}.kpi{display:grid;gap:2px}.kpi b{font-size:26px;letter-spacing:-.02em}.k{color:#C4A7FF;font:12px ui-monospace,Menlo,monospace}',
  '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin:12px 0}.wide{margin:12px 0}',
  'h2{margin:0 0 10px;font-size:13px;color:#94A3B8;font-weight:600;text-transform:uppercase;letter-spacing:.06em}',
  'table{width:100%;border-collapse:collapse}td,th{padding:6px 4px;border-bottom:1px solid rgba(255,255,255,.06);vertical-align:top;text-align:left}th{color:#94A3B8;font-weight:500;font-size:12px}',
  'td:first-child{position:relative}.bar{position:absolute;left:0;top:4px;bottom:4px;background:linear-gradient(90deg,rgba(91,91,214,.45),rgba(124,58,237,.25));border-radius:4px}.lbl{position:relative;padding-left:6px}',
  '.list td:first-child{position:static}.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.dim{color:#94A3B8}.acts{color:#5EEAD4;font-size:12px;word-break:break-word}',
  '.tag{display:inline-block;margin-top:2px;padding:0 6px;border-radius:999px;background:rgba(124,58,237,.25);color:#C4A7FF;font-size:11px}',
  '.chart{width:100%;height:160px;fill:#7C3AED}.axis{display:flex;justify-content:space-between;margin:6px 0 0;font-size:12px}',
  '.scroll{overflow-x:auto}.list{min-width:860px}a{color:#A5A6F6}.foot{margin-top:18px;font-size:12px}',
].join('');
