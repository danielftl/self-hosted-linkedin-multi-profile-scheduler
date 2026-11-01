# How to get your own LinkedIn API keys

This guide is for **personal LinkedIn profiles**, not Company Pages. You need to do this once for your own developer app. Each profile you connect later will authorize your app separately.

## Step 1 — Create your developer app

1. Sign in at [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps).
2. Select **Create app** (or **Create application**).
3. Choose a name, such as "My LinkedIn Scheduler".
4. Complete the required application information, including its associated LinkedIn Page. LinkedIn may require Page association or verification. You must use a Page you are authorized to associate with your app.
5. Submit the form and open your new app.

**If LinkedIn will not let you create or verify an app**, you cannot skip that requirement. Resolve it in the developer portal before continuing.

## Step 2 — Enable the two products

On your app's **Products** tab, enable:

- **Share on LinkedIn** — gives the `w_member_social` permission to publish posts on a member's behalf.
- **Sign In with LinkedIn using OpenID Connect** — gives the `openid`, `profile`, and `email` scopes to identify the connected profile.

These are listed as self-service/open consumer permissions by LinkedIn. Other APIs and advanced features can require separate approval. Check that the scopes appear in your app's **Auth** tab before proceeding.

## Step 3 — Get your Client ID and Client Secret

1. Open your app's **Auth** tab.
2. Find the **Application credentials** or **Client credentials** section.
3. Copy the **Client ID** into your private `.env` file as `LINKEDIN_CLIENT_ID`.
4. Select **Show** for the **Client Secret** and copy it into `.env` as `LINKEDIN_CLIENT_SECRET`.
5. **Never paste your Client Secret into GitHub, an AI chat, a screenshot, or a public post.** Never commit `.env`.

The Client ID identifies your application; the Client Secret is a password-like credential that must stay on your own server.

## Step 4 — Register your callback URL

In the app's **Auth** tab, find **Authorized redirect URLs** and add:

`http://localhost:3000/auth/linkedin/callback`

This must match `LINKEDIN_REDIRECT_URI` in your `.env` file **exactly**, including protocol, port, path, and trailing slash (none in this example).

If you deploy the app online later, add the hosted **HTTPS** callback as well, for example:

`https://your-domain.example/auth/linkedin/callback`

Set `APP_ORIGIN` to `https://your-domain.example` and `LINKEDIN_REDIRECT_URI` to the full HTTPS callback on your host.

## Step 5 — Connect your profile

1. Start the local web app and sign in with your scheduler password.
2. Click **Connect profile**.
3. LinkedIn shows the app's permissions. Review and authorize them.
4. The browser returns to your scheduler, where the profile should appear as connected.
5. To connect a different personal profile, repeat with that profile's LinkedIn session.

You **do not** need a separate developer app for every personal profile. Every profile must independently consent. You cannot silently connect someone else's profile without their authorization.

## Troubleshooting

- **Invalid redirect URI:** Check that the callback in your app and `.env` are identical.
- **Scope/permission error:** Check that both products are enabled in the Products tab and their scopes appear in Auth.
- **Client secret error:** Check the secret carefully; don't publish it to get troubleshooting help.
- **Profile shows Reconnect required:** The token may have expired or been revoked. Connect that profile again.
- **No Company Page available:** LinkedIn's developer app setup may require a Page association. Follow its instructions; this scheduler itself does not post to Company Pages.

Official LinkedIn documentation:

- [Getting access to LinkedIn APIs](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access)
- [Share on LinkedIn](https://learn.microsoft.com/linkedin/consumer/integrations/self-serve/share-on-linkedin)
- [OpenID Connect sign-in](https://learn.microsoft.com/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2)
- [OAuth authorization code flow](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow)
