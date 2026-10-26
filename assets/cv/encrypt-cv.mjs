#!/usr/bin/env node
// Maintainer tool (Node 20+, no dependencies). Publishes the CV source as
// assets/cv/cv.enc.json, AES-256-GCM encrypted so the text never sits in a
// crawlable, plain-text file. Run it after every edit to the source:
//
//   node assets/cv/encrypt-cv.mjs <cv-source.json>
//
// The key is derived from SITE_KEY, which the site also ships (assets/js/cv.js):
// this keeps the CV out of scrapers' and search engines' reach, not out of the
// hands of someone determined to read the site's JavaScript.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SITE_KEY = 'zcodes-cv-v2'; // must match assets/js/cv.js
const ITERATIONS = 100_000;
const { subtle } = globalThis.crypto;
const random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const b64 = (buf) => Buffer.from(buf).toString('base64');

async function main() {
  const [sourcePath] = process.argv.slice(2);
  if (!sourcePath) {
    console.error('usage: node assets/cv/encrypt-cv.mjs <cv-source.json>');
    process.exit(1);
  }
  const source = JSON.parse(await readFile(sourcePath, 'utf8'));
  for (const field of ['person', 'roles', 'experience', 'skills']) {
    if (!source[field]) throw new Error(`cv source is missing "${field}"`);
  }

  const salt = random(16);
  const iv = random(12);
  const material = await subtle.importKey('raw', new TextEncoder().encode(SITE_KEY), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt'],
  );
  const data = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(source)));

  const target = fileURLToPath(new URL('./cv.enc.json', import.meta.url));
  await writeFile(target, `${JSON.stringify({ v: 2, iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64(data) })}\n`);
  console.log(`Wrote ${target}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
