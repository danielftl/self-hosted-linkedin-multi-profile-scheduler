# Hosting and scheduled publishing

**Choose ONE hosting route (OR).** The app's website is for creating jobs; a worker must execute them later. The public repository is self-hostable, not a ready-to-use hosted service.

## A. Your computer — simplest trial

Run the website and scheduled publishing worker from the README. Keep **both programs running** and your computer awake.

The uploaded files and database stay in the directories configured by `MEDIA_DIR` and `DATABASE_PATH`. If the computer sleeps or shuts down, scheduled publication stops until the required programs run again.

## B. Your own always-on server

Use a server with Node.js 22+, persistent storage, HTTPS and the ability to run both long-lived processes.

1. Install this repository's source and Node.js on the server.
2. Store private configuration **on your server**, not in public GitHub files.
3. Choose permanent database and upload directories.
4. Use your own LinkedIn developer credentials, password and encryption key.
5. Set the actual public HTTPS origin and OAuth callback URL; register that exact callback in your LinkedIn developer app.
6. Run the website and publishing worker as services that restart after failure/reboot.
7. Test a queued job, a run while the user's computer is off, and real publication only after approval.

Your server/host may charge for uptime, storage and traffic. Have the AI inspect its current prices **before** setting up paid services.

## C. ChatGPT Sites — hosted alternative

Use ChatGPT **Work** to adapt and deploy the **current source from this public repository** into **your own Site**.

1. Start in ordinary Chat to review requirements and confirm that Sites is available for your plan and workspace.
2. When ready to build/deploy, switch to **Work** on ChatGPT web (or Work/Codex in the supported desktop app). Give it the repository URL and ask it to **reuse the current code** rather than redesign the scheduler.
3. Work must configure **your own** Site data storage, private media storage, LinkedIn redirect URL, environment settings and publishing trigger as required by this source. It should verify the deployed integration before claiming success.
4. Connect your own LinkedIn profiles and test both scheduling and subsequent cloud publishing with your computer off.

**Important:** The included Sites/Cloudflare-compatible modules are a starting point, not proof that uploading the public repository automatically gives you a working Site. The software must be configured and tested for the new deployment.

ChatGPT Sites building/editing counts toward Codex usage; hosting and storage have separate terms/limits. See [Sites documentation](https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites) for current availability and usage.

### Optional: Schedule from ordinary ChatGPT chats

A plugin is **not required** to use the website. If you want ordinary ChatGPT chats to schedule posts, ask Work to add **your own Site-hosted plugin** with the read/schedule actions your deployment needs. Then install/connect that plugin to your ChatGPT account and test it in an ordinary Chat.

This does not give you access to somebody else's deployed Site or installed plugin. See [Site-hosted plugin documentation](https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites).

## Developer option: Cloudflare-compatible worker

The repository also contains `src/sites-worker.mjs`, `src/d1-store.mjs`, `infra/d1-schema.sql`, and a sample minute trigger `infra/cron-worker.mjs`. A developer or AI must provision and connect the correct bindings, upload storage, secrets and scheduling system for their chosen hosting account.

The included sample is **not** a preconfigured production deployment for other users. It does not grant access to anyone else's accounts, database or credentials.

## Privacy and permissions

- Each person needs **their own** LinkedIn developer app and must authorize each personal profile they control.
- This software is for **personal LinkedIn profiles only**, not LinkedIn Company Pages.
- Keep personal credentials, access tokens, database and uploaded files private to the user's installation.
- The standalone version uses a single admin login; the hosted Site's human access may be different. Do not add another password solely because another deployment used one.
- Confirm background publication separately from job creation before declaring the deployment complete.
