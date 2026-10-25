#!/usr/bin/env node
// Maintainer tool (Node 20+, no dependencies). Encrypts the private CV source into
// assets/cv/cv.enc.json, the only CV data that is ever published.
//
//   node assets/cv/encrypt-cv.mjs <cv-source.json> <codes.txt> [--new "note"]
//
// codes.txt (keep it private, never commit it) holds one access code per line,
// optionally followed by "# note" (e.g. who it was issued to). --new appends a
// freshly generated code. To revoke a code, delete its line and re-run.
//
// Format: the CV is encrypted once with a random AES-256-GCM data key; that key
// is wrapped separately for every access code with a key derived from the code
// (PBKDF2-SHA-256). Each wrapped key is filed under the code's first group, so
// the browser derives exactly one key. Codes are 16 Crockford base32 characters
// (XXXX-XXXX-XXXX-XXXX); 60 secret bits plus PBKDF2 makes offline guessing
// impractical. Keep the parameters in sync with assets/js/cv.js.
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ITERATIONS = 600_000;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32
const { subtle } = globalThis.crypto;
const getRandomValues = (array) => globalThis.crypto.getRandomValues(array);
const b64 = (buf) => Buffer.from(buf).toString('base64');

/** Uppercase, strip separators, map look-alikes (O→0, I/L→1) as Crockford does. */
export const normaliseCode = (code) =>
  code.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');

function newCode() {
  const bytes = getRandomValues(new Uint8Array(16));
  const chars = [...bytes].map((b) => ALPHABET[b & 31]).join('');
  return chars.match(/.{4}/g).join('-');
}

async function wrapKey(rawKey, code) {
  const salt = getRandomValues(new Uint8Array(16));
  const iv = getRandomValues(new Uint8Array(12));
  const material = await subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
  const kek = await subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt'],
  );
  const wrapped = await subtle.encrypt({ name: 'AES-GCM', iv }, kek, rawKey);
  return { id: code.slice(0, 4), salt: b64(salt), iv: b64(iv), key: b64(wrapped) };
}

async function main() {
  const args = process.argv.slice(2);
  const newIdx = args.indexOf('--new');
  const note = newIdx >= 0 ? args.splice(newIdx, 2)[1] ?? '' : null;
  const [sourcePath, codesPath] = args;
  if (!sourcePath || !codesPath) {
    console.error('usage: node assets/cv/encrypt-cv.mjs <cv-source.json> <codes.txt> [--new "note"]');
    process.exit(1);
  }
  if (note !== null) {
    const code = newCode();
    await appendFile(codesPath, `${code}${note ? `  # ${note}` : ''}\n`);
    console.log(`New access code: ${code}`);
    console.log(`Magic link:      https://zeeohn.github.io/zcodes/#cv=${code}`);
  }

  const source = JSON.parse(await readFile(sourcePath, 'utf8'));
  const codes = (await readFile(codesPath, 'utf8'))
    .split('\n').map((l) => normaliseCode(l.split('#')[0])).filter(Boolean);
  if (!codes.length) throw new Error(`no codes in ${codesPath}; add one with --new`);
  if (codes.some((c) => c.length !== 16)) throw new Error('every code must have 16 characters');
  if (new Set(codes.map((c) => c.slice(0, 4))).size !== codes.length) throw new Error('two codes share a first group; generate another');

  const rawKey = getRandomValues(new Uint8Array(32));
  const dataKey = await subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
  const iv = getRandomValues(new Uint8Array(12));
  const data = await subtle.encrypt({ name: 'AES-GCM', iv }, dataKey, new TextEncoder().encode(JSON.stringify(source)));

  const out = {
    v: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS },
    keys: await Promise.all(codes.map((c) => wrapKey(rawKey, c))),
    iv: b64(iv),
    data: b64(data),
  };
  const target = fileURLToPath(new URL('./cv.enc.json', import.meta.url));
  await writeFile(target, `${JSON.stringify(out)}\n`);
  console.log(`Wrote ${target} (${codes.length} access code${codes.length === 1 ? '' : 's'}).`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
