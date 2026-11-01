# Hosting and scheduled publishing

## Option A — Your own computer (easiest to try)

Run both the web server and worker as described in the README. Your computer **must stay awake** and both programs must stay running for scheduled posts to publish.

Uploaded files and the database are stored in the locations configured by `MEDIA_DIR` and `DATABASE_PATH`. Do not put these in a publicly shared folder.

## Option B — A server that runs 24/7

Use a VPS or other hosting provider that supports **Node.js 22+**, persistent file storage, HTTPS, and two long-running processes.

1. Install the code and Node.js on the server.
2. Store `.env` **only on that server**, never in GitHub or your website's public directory.
3. Choose a **persistent** `DATABASE_PATH` and `MEDIA_DIR`. Do not use temporary/ephemeral storage.
4. Configure a strong `ADMIN_PASSWORD`, a randomly generated `TOKEN_ENCRYPTION_KEY`, and your own LinkedIn app credentials.
5. Use a domain with HTTPS and set `APP_ORIGIN` and `LINKEDIN_REDIRECT_URI` to its exact HTTPS addresses.
6. Add that redirect URI to your LinkedIn app's Auth tab.
7. Run the web server and worker as managed services so they restart automatically after crashes/reboots.
8. Restrict public access, protect backups, and verify that scheduling works with your laptop switched off.

**A URL alone does not make publishing automatic.** The publishing worker or a cloud scheduler must actually run at the scheduled time.

## Option C — Cloudflare-style worker (advanced)

This repository includes a **Sites/Cloudflare-compatible adapter**:

- `src/sites-worker.mjs` — HTTP and scheduled handler.
- `src/d1-store.mjs` and `infra/d1-schema.sql` — managed D1 database.
- `MEDIA` R2 binding — private uploaded attachments.
- `ASSETS` binding — static files from `public/`.
- `infra/cron-worker.mjs` — optional minute-level scheduler trigger.

A developer must provision D1, R2, bindings, environment secrets, static assets, and scheduled execution. This integration has automated tests but **has not been verified on a live cloud deployment**. Do not assume you can upload the repository and have an instantly working cloud app.

Required private secrets: `ADMIN_PASSWORD`, `LINKEDIN_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`, and (if using the external trigger) `SCHEDULER_TRIGGER_SECRET`. Set `LINKEDIN_CLIENT_ID`, `APP_ORIGIN`, `LINKEDIN_REDIRECT_URI`, and `LINKEDIN_VERSION` appropriately.

## Safety before sharing your hosted URL

- This is **one shared admin login**, not a multi-tenant SaaS.
- Anyone who knows the URL **and admin password** can schedule posts on every connected profile.
- Use HTTPS, a unique strong password, private database/media storage, and backups.
- Protect your encryption key: losing it makes stored LinkedIn tokens unreadable.
- Never expose Client Secrets or access tokens in browser JavaScript, logs, screenshots, or public GitHub commits.
- Verify the scheduler and any cloud trigger using test data before publishing to real profiles.
- Keep up with LinkedIn API version changes and reauthorize expired accounts.
