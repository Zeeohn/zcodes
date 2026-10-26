// Builds the role-specific CV as a real text PDF (pdf-lib, standard Helvetica).
// Loaded when the CV section nears the viewport, never on first page load. The
// output carries the source's fixed "updated" date, so every copy of a version is
// identical: nothing in it depends on who downloads it or when.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PAGE = [595.28, 841.89]; // A4 in points
const MARGIN = 46;
const WIDTH = PAGE[0] - MARGIN * 2;
const INK = rgb(0.043, 0.071, 0.125);
const ACCENT = rgb(0.357, 0.357, 0.839);
const MUTED = rgb(0.29, 0.33, 0.41);
const RULE = rgb(0.84, 0.86, 0.9);

// Standard PDF fonts only cover WinAnsi; swap the few characters outside it.
const clean = (s) => s.replace(/−/g, '-').replace(/→/g, '->').replace(/[  ]/g, ' ');

/** 0 = primarily about this role, 1 = also relevant, 2 = not tagged for it. Sorting is stable, so source order breaks ties. */
const rank = (tags, role) => (tags[0] === role ? 0 : tags.includes(role) ? 1 : 2);
const byRank = (role) => (a, b) => rank(a.tags, role) - rank(b.tags, role);

// Density levels, tried in order until the CV fits on two pages.
const DENSITY = [
  { results: 6, projects: 3, recent: 3, older: 2, lead: 1.38 },
  { results: 5, projects: 2, recent: 3, older: 2, lead: 1.33 },
  { results: 4, projects: 2, recent: 3, older: 1, lead: 1.3 },
];
const MAX_PAGES = 2;

/** Picks and orders content for one role. Every item comes from the source; nothing is invented. */
export function tailor(cv, role, d = DENSITY[0]) {
  const relevant = (items, max, min = 0) => {
    const sorted = [...items].sort(byRank(role));
    const hits = sorted.filter((i) => i.tags.includes(role));
    return (hits.length >= min ? hits : sorted.slice(0, min)).slice(0, max);
  };
  return {
    role: cv.roles[role],
    accomplishments: relevant(cv.accomplishments, d.results, 4),
    experience: cv.experience.map((job, i) => ({ ...job, bullets: relevant(job.bullets, i < 4 ? d.recent : d.older, Math.min(2, i < 4 ? d.recent : d.older)) })),
    projects: relevant(cv.projects, d.projects),
    skills: cv.roles[role].skills.map((k) => cv.skills[k]),
  };
}

export async function buildCvPdf(cv, roleKey) {
  let doc;
  for (const d of DENSITY) {
    doc = await render(cv, roleKey, d);
    if (doc.getPageCount() <= MAX_PAGES) break;
  }
  return doc.save();
}

async function render(cv, roleKey, d) {
  const t = tailor(cv, roleKey, d);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const { person } = cv;

  let page;
  let y;
  const newPage = () => {
    page = doc.addPage(PAGE);
    y = PAGE[1] - MARGIN;
  };
  const ensure = (h) => {
    if (y - h < MARGIN + 18) newPage();
  };
  const wrap = (text, f, size, width) => {
    const lines = [];
    let line = '';
    for (const word of clean(text).split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (f.widthOfTextAtSize(next, size) > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };
  const para = (text, { f = font, size = 9.2, color = INK, x = MARGIN, width = WIDTH, lead = d.lead } = {}) => {
    for (const line of wrap(text, f, size, width)) {
      ensure(size * lead);
      page.drawText(line, { x, y: y - size, size, font: f, color });
      y -= size * lead;
    }
  };
  const bullet = (text, size = 9.2) => {
    const lines = wrap(text, font, size, WIDTH - 12);
    ensure(lines.length * size * d.lead);
    page.drawText('•', { x: MARGIN + 1, y: y - size, size, font: bold, color: ACCENT });
    lines.forEach((line) => {
      page.drawText(line, { x: MARGIN + 12, y: y - size, size, font, color: INK });
      y -= size * d.lead;
    });
    y -= 1.5;
  };
  const section = (title) => {
    ensure(40);
    y -= 12;
    page.drawText(title.toUpperCase(), { x: MARGIN, y: y - 8.5, size: 8.5, font: bold, color: ACCENT });
    y -= 13;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + WIDTH, y }, thickness: 0.6, color: RULE });
    y -= 8;
  };
  const rightText = (text, size, f, color) => {
    const s = clean(text);
    page.drawText(s, { x: MARGIN + WIDTH - f.widthOfTextAtSize(s, size), y: y - size, size, font: f, color });
  };

  // ---- Header
  newPage();
  page.drawText(clean(person.name), { x: MARGIN, y: y - 24, size: 24, font: bold, color: INK });
  y -= 32;
  para(t.role.title, { f: bold, size: 12.5, color: ACCENT });
  y -= 2;
  para([person.email, person.phone, person.location].filter(Boolean).join('  ·  '), { size: 8.8, color: MUTED });
  para(person.links.join('  ·  '), { size: 8.8, color: MUTED });
  if (person.availability) {
    y -= 1;
    para(person.availability, { f: bold, size: 9, color: ACCENT });
  }
  page.drawRectangle({ x: MARGIN, y: y - 6, width: 42, height: 2.2, color: ACCENT });
  y -= 10;

  section('Profile');
  para(t.role.summary, { size: 9.4 });
  if (cv.learning) {
    y -= 2;
    para(cv.learning, { size: 9.4 });
  }

  section('Key results');
  t.accomplishments.forEach((a) => bullet(a.text));

  section('Experience');
  t.experience.forEach((job, i) => {
    // Keep the heading block (and first bullet) together on one page.
    ensure(64);
    if (i) y -= 5;
    const head = clean(job.company);
    page.drawText(head, { x: MARGIN, y: y - 10.5, size: 10.5, font: bold, color: INK });
    const meta = clean(`  ·  ${job.type}  ·  ${job.location}`);
    const headW = bold.widthOfTextAtSize(head, 10.5);
    const dateW = font.widthOfTextAtSize(clean(job.dates), 8.8);
    if (headW + font.widthOfTextAtSize(meta, 8.8) < WIDTH - dateW - 12) {
      page.drawText(meta, { x: MARGIN + headW, y: y - 10.5, size: 8.8, font, color: MUTED });
      rightText(job.dates, 8.8, font, MUTED);
      y -= 14;
    } else {
      rightText(job.dates, 8.8, font, MUTED);
      y -= 14;
      para(meta.replace(/^\s+·\s+/, ''), { size: 8.8, color: MUTED });
    }
    para(job.title, { f: bold, size: 9.8, color: ACCENT });
    para(job.intro, { f: italic, size: 8.9, color: MUTED });
    y -= 1;
    job.bullets.forEach((b) => bullet(b.text));
    para(`Stack: ${job.stack}`, { size: 8.2, color: MUTED });
  });

  if (t.projects.length) {
    section('Selected projects');
    t.projects.forEach((p) => {
      ensure(44);
      para(p.name, { f: bold, size: 9.8 });
      para(`${p.meta}  ·  ${p.status}`, { size: 8.2, color: MUTED });
      para(p.text, { size: 9 });
      y -= 4;
    });
  }

  section('Skills');
  t.skills.forEach((s) => {
    const label = clean(`${s.label}: `);
    const lw = bold.widthOfTextAtSize(label, 9);
    ensure(13);
    page.drawText(label, { x: MARGIN, y: y - 9, size: 9, font: bold, color: INK });
    const value = s.learning ? `${s.items}  ·  currently learning ${s.learning}` : s.items;
    para(value, { size: 9, x: MARGIN + lw, width: WIDTH - lw });
  });

  section('Education & languages');
  const ed = cv.education;
  page.drawText(clean(`${ed.degree}, ${ed.school}`), { x: MARGIN, y: y - 9.6, size: 9.6, font: bold, color: INK });
  rightText(ed.dates, 8.8, font, MUTED);
  y -= 13.5;
  para(ed.note, { size: 9 });
  y -= 2;
  para(`Languages: ${person.languages}`, { size: 9 });

  // ---- Footers: name, role and page numbers
  const pages = doc.getPages();
  const left = clean(`${person.name} · ${t.role.title}`);
  pages.forEach((p, i) => {
    const right = clean(`${person.email} · ${i + 1}/${pages.length}`);
    p.drawLine({ start: { x: MARGIN, y: MARGIN }, end: { x: MARGIN + WIDTH, y: MARGIN }, thickness: 0.5, color: RULE });
    p.drawText(left, { x: MARGIN, y: MARGIN - 12, size: 7.5, font, color: MUTED });
    p.drawText(right, { x: MARGIN + WIDTH - font.widthOfTextAtSize(right, 7.5), y: MARGIN - 12, size: 7.5, font, color: MUTED });
  });

  doc.setTitle(`${person.name} — ${t.role.title} CV`);
  doc.setAuthor(person.name);
  doc.setSubject(`${t.role.label} CV`);
  doc.setKeywords([t.role.label, ...t.skills.flatMap((s) => s.items.split(', '))]);
  doc.setCreator('zeeohn.github.io/zcodes');
  doc.setProducer('ZCODES');
  const updated = new Date(cv.updated || '2026-01-01');
  doc.setCreationDate(updated);
  doc.setModificationDate(updated);
  return doc;
}
