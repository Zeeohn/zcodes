# CV on request

The "Request a CV" section (`#cv`) never publishes the CV in readable form. Only
`cv.enc.json` is public: the CV source, AES-256-GCM encrypted. A visitor needs an
access code from you to decrypt it; their browser then builds a PDF tailored to the
role they pick (Full-Stack, Backend, Frontend, Integrations & Solutions).

## How a request flows

1. A visitor picks a role and sends `POST /v1/cv-requests`. It goes through the
   contact relay to your inbox with the subject "CV request (<role>) from <name>".
2. You reply with an access code, or better, a magic link that carries the code and
   role, so they only have to press one button:
   `https://zeeohn.github.io/zcodes/#cv=XXXX-XXXX-XXXX-XXXX&role=backend`
   (`role` is `fullstack`, `backend`, `frontend` or `solutions`; it's optional).
3. Their browser derives a key from the code, decrypts the CV and generates the PDF
   on the spot. The code is removed from the address bar as soon as it's read.

## Your private files (never commit these)

- `cv-source.json`: the CV content (profile per role, key results, experience,
  projects, skills). Every bullet carries `tags` that decide which roles it leads.
- `cv-codes.txt`: one access code per line, with an optional `# note`.

`.gitignore` blocks both names in this repository; keep them somewhere safe, such as
a password manager or a private folder.

## Common tasks (Node 20+, no install)

```sh
# Issue a new code (e.g. one per company) and re-encrypt:
node assets/cv/encrypt-cv.mjs ~/private/cv-source.json ~/private/cv-codes.txt --new "Acme, Oct 2026"

# Revoke a code: delete its line in cv-codes.txt, then re-encrypt:
node assets/cv/encrypt-cv.mjs ~/private/cv-source.json ~/private/cv-codes.txt

# Update the CV: edit cv-source.json, then re-encrypt (same command).
```

Commit and push the new `cv.enc.json` after each run. Re-encrypting also invalidates
any copy of the old file someone may have saved together with a revoked code.

## Security notes

- Each code has 60 secret bits, stretched with PBKDF2-SHA-256 (600,000 iterations),
  so guessing a code offline is impractical.
- Anyone you give a code to can share it or the PDF; issue one code per company if
  you want to be able to revoke them individually.
- The PDF includes your phone number (as your base resume does). Remove `phone` from
  `cv-source.json` and re-encrypt if you'd rather it didn't.
