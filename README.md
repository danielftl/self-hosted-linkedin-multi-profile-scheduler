# Self-Hosted LinkedIn Multi-Profile Scheduler

An **open-source LinkedIn post scheduler** for multiple **personal LinkedIn profiles**. Write a post once, choose which connected profiles receive it, and schedule publication. You can run it on your own computer or ask your AI to help deploy it on a server.

Built by Daniel. Free to use under the **MIT License**. **Not affiliated with LinkedIn or Buffer.**

![Calendar with example profiles](docs/demo-calendar.png)

## Not a coder? Give this project to your AI

You do **not** need to know how to install or configure every component. **Start in an ordinary ChatGPT chat** (or another AI assistant that can read GitHub). Paste the complete prompt below; your AI should explain the choices, handle what it can, and tell you when ChatGPT **Work** is needed for deployment.

**Copy and paste this prompt:**

```text
I want to set up this open-source LinkedIn scheduler for my own personal LinkedIn accounts:
https://github.com/danielftl/self-hosted-linkedin-multi-profile-scheduler

I am not a developer. Take responsibility for the technical work using the tools you actually have. First read the repository's current README, setup guide, hosting guide, and source code. Do not guess from the repository name or create a new app from scratch.

Start in ordinary ChatGPT Chat. Explain the two SETUP OPTIONS (OR), with any costs or limits, and ask which fits me:
A. Run on my own computer. Posting works only while the computer and the website/publishing worker are running.
B. Run online so scheduled posts can publish while my computer is off. For a ChatGPT Site, tell me when to use ChatGPT Work and hand the exact repository and requirements to Work. If we choose another hosting provider, explain its separate setup and charges.

Use Chat for planning, reading, explaining and any actions it can perform with available tools. Use Work only when its deployment/computer capabilities are actually needed. Do not assume Chat, Work and Codex have identical access.

Use only the source supplied by this public repository. Preserve its existing functionality and design unless a change is required for my chosen hosting environment. Do not connect to the original author's Site, API, plugin, LinkedIn accounts or credentials.

Guide me through creating my own LinkedIn developer app, obtaining the supported personal-profile permissions, registering the correct sign-in callback, and authorizing each profile I control. Keep credentials in my own environment, not in this chat or GitHub.

A separate API or ChatGPT plugin is NOT required for ordinary website scheduling. Only if I want to schedule through ordinary ChatGPT chats, help Work create and install a plugin connected to MY newly deployed Site, then test it from a normal chat.

Test installation, login, connected profiles, the scheduling queue and the unattended publishing mechanism. Ask my approval of the exact LinkedIn profile, post text and time before scheduling any real public post. Distinguish 'job created' from 'post published'. Do not claim success without checking.

This project supports personal LinkedIn profiles, NOT Company Pages. Company Page publishing requires different permissions and implementation. Keep the explanation practical, identify the next action I need to take, and do not add needless dependencies.
```

[Open the full AI setup guide](docs/AI_SETUP_PROMPT.md) for a checklist and troubleshooting instructions.

### What your AI should guide you through

1. **Choose ONE installation route (OR):**
   - **Your computer:** easiest to try; it must stay running for scheduled publication.
   - **Online hosting:** the scheduler can continue when your computer is off; requires a suitable hosting environment. For a ChatGPT Site, use **Work** to deploy from these public source files. Work should explain hosting limits and any costs before provisioning.
2. **Set up your own LinkedIn developer app** and grant the appropriate permissions for personal profiles.
3. **Connect your own accounts** and test the website and publishing process.
4. **Optional:** If you also want to schedule posts from ordinary ChatGPT chats, have your AI help set up **your own plugin** connected to **your own deployment**. A ChatGPT plugin is **not needed** to use the website.

**Important:** The project does not include an installed plugin, an already running API for you to use, a LinkedIn developer account, or a ready-made hosted service. The AI will configure what your chosen installation needs. **Nobody gets access to the original author's accounts or live scheduler through this code.**

## What it supports

- Connect multiple **personal LinkedIn profiles**, each authorized through LinkedIn's official sign-in flow.
- Write text once and schedule a separate post for each selected profile.
- Attach **one** image, document, or video to each scheduled post.
- Calendar and list views, status tracking, post preview, and standalone password-protected access.
- Clean up uploaded media after confirmed publication; flag uncertain outcomes rather than blindly posting twice.

**Not supported:** LinkedIn Company Pages, Facebook, analytics, carousels, multiple attachments per post, or separate user logins for multiple customers.

**Why no LinkedIn Company Pages?** They require different organization-level permissions, including `w_organization_social`, and an appropriate LinkedIn API access approval. This code does not implement Company Page scheduling; receiving approval alone does not add that feature. See [LinkedIn's permissions documentation](https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access) and [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api).

## Manual installation (if you do not want an AI to set it up)

You need **Node.js 22 or newer**, your own LinkedIn developer app, and a computer or server where you can run the project.

### 1. Download the code

On this GitHub page select **Code → Download ZIP**, then extract the ZIP. Or use Git to clone the repository.

### 2. Get your own LinkedIn credentials

Follow [Get your own LinkedIn API access](docs/GET_YOUR_LINKEDIN_API.md). You must use your **own** Client ID and Client Secret. Every personal profile you connect must independently authorize your app.

### 3. Create your private configuration

Copy `.env.example` to `.env` in the project folder. Fill in:

- `ADMIN_PASSWORD`: password to access **your self-hosted website**.
- `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`: from **your** LinkedIn developer app.
- `TOKEN_ENCRYPTION_KEY`: a randomly generated 32-byte encryption key.

Generate the encryption key using Node.js:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Keep the key and other credentials private. Register `http://localhost:3000/auth/linkedin/callback` in your developer app when running locally, matching your configuration exactly.

### 4. Run the website

```sh
node --env-file=.env src/start.mjs
```

Open http://localhost:3000, sign in, and connect your personal LinkedIn profiles.

### 5. Run the publishing worker in another terminal

```sh
node --env-file=.env src/worker-start.mjs
```

**Both processes must run** for local scheduled publishing. If your computer sleeps or shuts down, local publishing stops. For hosting that continues when your computer is off, see [Hosting options](docs/HOSTING.md).

### 6. Verify one scheduled post

Choose the target profile(s), click **New Post**, enter your content and future time, then click **Schedule Posts**. Verify the job appears in the queue. Later verify the post was actually published, rather than assuming a saved job means success.

## Hosting and ChatGPT integration

[HOSTING.md](docs/HOSTING.md) explains the available routes: computer **OR** a continuously running server **OR** a ChatGPT Site adapted from this source. Hosting, platform account registration, storage, and usage charges depend on the route you choose.

A Site can expose its functions to ordinary ChatGPT chats via **your own Site-hosted plugin**, configured in Work. **This is optional** and separate from website functionality. Publishing the GitHub source does not publish or share the author's own plugin/API credentials.

## Tests and limitations

Run the automated tests:

```sh
npm run test:twice
```

Tests use simulated LinkedIn responses. **Passing them does not prove a real LinkedIn profile is connected or that unattended publication works.**

- This is a **single-admin** application, not a multi-customer SaaS.
- Do not publish a real test post without checking the exact account, content and time.
- Do not add `.env`, access tokens, SQLite databases, uploaded files or secrets to a public repository.
- LinkedIn authorizations can expire; reconnect profiles when needed.
- A published response lost in transit can leave a job uncertain. Check LinkedIn before retrying.
- Attachment limit: one file per post; supported images JPG/PNG/GIF up to 20 MB, documents PDF/DOC/DOCX/PPT/PPTX and videos MP4/MOV up to 25 MB.
- The repository includes an adapter for Sites/Cloudflare-style hosting, but **this public standalone package is not a one-click Sites deployment**. An AI must configure the destination's database, file storage, authentication, and scheduler and verify the actual deployed behavior.

## License

MIT — see [LICENSE](LICENSE). LinkedIn and Buffer are trademarks of their respective owners.
