# CV downloads

The CV section (`#cv`) offers one PDF per role: Full-Stack, Backend, Frontend, and
Integrations & Solutions. Visitors leave their name and email once per visit, and the
download starts immediately. Nothing needs to be done by hand for any of it.

The CV text never sits in the HTML or in a plain-text file: `cv.enc.json` holds it
AES-256-GCM encrypted, so search engines and scrapers that read files can't index it.
The PDF for the chosen role is assembled in the visitor's browser from that source,
with a fixed "updated" date, so every copy of a version is identical.

Each visitor's first download sends you a heads-up through the contact relay
("CV downloaded (<role>) by <name>"). It runs in the background and never delays the
download.

## Updating the CV

Your private source is `cv-source.json` (keep it outside this repository; `.gitignore`
blocks the name here). Every bullet has `tags` that decide which roles it leads, and
each role has its own title and summary. After editing it:

```sh
node assets/cv/encrypt-cv.mjs ~/private/cv-source.json   # Node 20+, no install
```

Then commit and push the new `cv.enc.json`. Also set `"updated"` in the source to the
date of the change; it becomes the PDF's document date.

## What this protects against (and what it doesn't)

The site has no server, so the decryption key ships with the page. That keeps the CV
out of crawlers, search results and file scrapers, and asks people for their details
before they download. It does not stop someone determined to read the site's
JavaScript. Your phone number is in the PDF (as on your original resume); remove
`phone` from the source and re-run the command if you'd rather it wasn't.
