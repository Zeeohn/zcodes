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

**CV download notices.** When someone downloads a CV for the first time in a visit,
the site sends you a heads-up through this relay (who, which role, which company). Their
message starts with `CV DOWNLOAD: <role>`; once you deploy this version of `Code.gs`
they arrive titled "CV downloaded (<role>) by <name>". An older deployment still
delivers them, under the usual "Hire request from" subject. Downloads never wait for
the relay, so they work even if it's down.

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
the hashes of used stamps. There are no cookies; visit analytics (below) are first-party and described in the site footer.

**Tuning.** All limits are in `LIMITS` at the top of `Code.gs`. The proof-of-work
difficulty (`powBits`) must match `DIFFICULTY` in `assets/js/contact.js`.

## Visit analytics

The same script records visits to the portfolio (sent by `assets/js/analytics.js`) in
a Google Sheet in this account's Drive, serves a private dashboard and emails a daily
summary. No third-party analytics service is involved; the only outside call is the
visitor's browser asking GeoJS for an approximate location (city, region, country and
the network's organisation, which for company networks is the company). The IP
address is never sent here or stored.

### Turn it on (once, about 3 minutes)

1. Paste the latest `Code.gs` over the old one and save.
2. **Deploy → Manage deployments → ✏️ → Version: New version → Deploy.** The URL stays
   the same.
3. In the editor's function menu, pick **setup** and click **Run**. Google asks for the
   new permissions (create the spreadsheet, schedule the digest); allow them.
   `setup` creates the "Portfolio analytics" spreadsheet, a secret dashboard key and
   the daily digest trigger, then emails you the private dashboard link.
4. Open `https://zeeohn.github.io/zcodes/?owner=1` once in each browser you use, so
   your own visits aren't counted (`?owner=0` undoes it).

Until step 3 runs, the site's beacons are still accepted and the sheet is created on
the first visit; you just won't have the dashboard key or the digest yet.

### What you get

- **Dashboard** (`…/exec?view=dashboard&key=…`, 7/30/90/365-day ranges): visitors,
  visits, returning visitors, engaged time, scroll depth, bounce rate; visits per day;
  countries, cities, networks/companies, sources (referrers and `utm_` campaigns);
  devices, browsers, OS, languages; how far people get through the sections; case
  studies opened, outbound clicks (GitHub, LinkedIn, product docs), CV downloads by
  role, contact messages; and the latest 80 visits in detail. Visits are anonymous:
  they are never linked to the names or emails people type into the CV or contact
  form (those still reach you by email, as before). Keep the link private: anyone with it can see the data.
- **Daily digest** at 08:00 in the script's timezone (Project settings): totals, top
  locations, networks and sources and every visit that lasted a minute or more. No email on days without visits.
- **Raw data**: the "Visits" sheet, one row per beacon, for your own filters or charts.

### Privacy

Visitors see what's collected in the site footer and can switch it off there.
Browsers sending Global Privacy Control or Do Not Track, automated browsers and bots
are never counted. No cookies are set (an anonymous ID lives in `localStorage`). Rows
older than about 13 months (`ANALYTICS.retentionDays`) are deleted by the digest.
Limits: 40 beacons per visit per hour and 5,000 per day, so a flood can't fill the
sheet or exhaust the script's quotas.
