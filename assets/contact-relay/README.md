# Contact relay

The portfolio's contact form (`POST /v1/hire-zion`) sends requests straight to
**zcodes.dev@gmail.com**. GitHub Pages can't send mail, so the form posts to this
small Google Apps Script web app (`Code.gs`), which delivers the message with Gmail.

There are no third-party form services, no API keys and no secrets: the script runs
under your own Google account, and its URL is public by design (every request is
checked; see "Security" below).

## Deploy (about 5 minutes, once)

1. Sign in to Google with the account that should send the mail. Using
   zcodes.dev@gmail.com itself is simplest: messages then arrive "from yourself".
2. Open <https://script.google.com>, click **New project**, delete the sample code
   and paste in the contents of `Code.gs`. Name the project, e.g. `hire-zion relay`,
   and save.
3. Click **Deploy → New deployment**, choose the type **Web app**, then set:
   - **Execute as:** Me
   - **Who has access:** Anyone

   Click **Deploy**, then **Authorize access**. Google warns that the app isn't
   verified (it's your own script): choose **Advanced → Go to hire-zion relay**, then
   **Allow**. The only permission it asks for is sending email as you.
4. Copy the **Web app URL** (`https://script.google.com/macros/s/…/exec`). Opening
   it in a browser should show `{"ok":true,"service":"hire-zion contact relay"}`.
5. In `index.html`, paste the URL into the form's `data-endpoint` attribute:

   ```html
   <form class="api" id="hire-form" data-endpoint="https://script.google.com/macros/s/…/exec" data-reveal>
   ```

   Commit and push. Until this is set, the form falls back to opening a prefilled
   email in the visitor's mail app.
6. Send yourself a test request from the live site. If the first one lands in Spam,
   mark it **Not spam** so later ones go to the inbox.

**CV requests** from the "Request a CV" section use this same relay. Their message
starts with `CV REQUEST: <role>`; from the version of `Code.gs` that recognises it, they
arrive with the subject "CV request (<role>) from <name>". An older deployment still
delivers them, under the usual "Hire request from" subject.

**Changing the script later:** edit it, then go to **Deploy → Manage deployments →
✏️ → Version: New version → Deploy**. The URL stays the same.

## Security and spam filtering

| Layer | Where | What it stops |
|---|---|---|
| Size and shape checks | server | Oversized bodies (12 KB max), non-JSON, non-string fields, bad emails, messages under 10 characters |
| Honeypot field | browser + server | Bots that fill in every field. They get a fake "success" and nothing is sent |
| Minimum fill time (3 s) | browser + server | Scripted instant submissions, also silently dropped |
| Proof-of-work stamp | browser + server | The browser spends about 0.3 s finding a SHA-256 stamp tied to this exact sender, message and time. Bulk spam gets expensive, a stamp expires after 15 minutes and works only once (no replay) |
| Content scoring | server | Link-stuffed or SEO/casino/crypto-style spam is dropped; borderline mail arrives tagged `[possible spam]` so nothing real is lost |
| Rate limits | server | 3 per sender address per hour, 20 per hour overall, 80 per day overall (under Gmail's ~100/day quota) |
| Header-injection guard | server | Line breaks are stripped from the name and reply-to, so nothing can add `Bcc:` or other headers |
| Plain text only | server | No HTML in the email, so nothing can inject markup or links into your mail client |
| No auto-reply | server | The relay never emails the sender, so it can't be used to send mail to other people |

**Privacy.** Messages go only to your inbox. The script stores no message content: it
keeps short-lived counters, a hash of the sender's address for the hourly limit, and
the hashes of used stamps. There are no cookies and no trackers.

**Tuning.** All limits are in `LIMITS` at the top of `Code.gs`. The proof-of-work
difficulty (`powBits`) must match `DIFFICULTY` in `assets/js/contact.js`.
