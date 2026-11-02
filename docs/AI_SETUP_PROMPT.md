# One prompt: Ask ChatGPT to set up this scheduler

This is for people who don't code. It tells ChatGPT to read the public GitHub source, explain when to use **Chat** versus **Work**, and guide the setup without requiring access to somebody else's accounts.

**Start here:** Open an **ordinary ChatGPT Chat**, copy everything in the block below, and send it.

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

## What Chat versus Work means

| Where | Use it for | What to expect |
| --- | --- | --- |
| **ChatGPT Chat** | Reading the public project, choosing a setup route, explaining requirements, planning, and working with connected tools it already has. | It can guide setup and sometimes perform connected tasks, but does not automatically have access to your computer or a hosting environment. |
| **ChatGPT Work** | Building or deploying a **ChatGPT Site**, configuring Site services and publishing the application. | Tell Work to use the **exact source from this repository**, not to invent a replacement. |
| **Ordinary Chat again** | Using **your own installed Site-hosted plugin** to read or schedule posts, if you have opted to create that plugin. | Installing a plugin only works after its Site has been created, published and connected. |
| **Codex (optional)** | Debugging or changing source code in a repository when that is genuinely required. | It is not a mandatory installation step and should not be introduced just because the user is a non-coder. |

**These are stages when needed (AND).** The **installation routes** are alternatives (OR): your computer, your own server, or a ChatGPT Site. The website and the plugin are **not competing products**: the plugin is optional if you want to schedule from ordinary ChatGPT chats.

## What the AI should verify before declaring success

- Read the current public source and setup instructions, not just a repository summary.
- Ask whether the user needs **always-on scheduled publication** or can keep their computer running.
- Check whether their own LinkedIn developer app has the required **personal-profile** permissions and registered callback URL.
- Confirm the correct account is connected and the website works.
- Verify the scheduled job is saved **AND** later published as intended.
- If the user wants ChatGPT-chat control, test the **user's own** plugin from an ordinary chat without depending on the developer's installation.
- Keep any credentials in the user's own chosen environment. Don't use another user's API, plugin, Site, or accounts.

## Company Pages and other limitations

This software supports personal LinkedIn profiles only. LinkedIn Company Pages require **different permissions, separate LinkedIn API approval and additional software support**. Approval is not a hidden feature switch. See [Get your own LinkedIn API access](GET_YOUR_LINKEDIN_API.md).

## Troubleshooting

**Chat cannot read the repo:** It should try its connected GitHub tool or public repository URL. If inaccessible, it should explain the specific error and request the project ZIP instead of guessing.

**Work cannot deploy a Site:** Check whether Sites is available for the user's account and whether Work can access the source. It should state the exact blocker and not silently replace the software with a mock-up.

**Website works but posts are not published:** Check whether the background publishing worker is running, where it runs, and the stored job's status. The website alone is not the worker.

**Plugin is not visible in ordinary Chat:** Check whether the Site was published with the relevant tools, and whether the user installed and connected **their own** plugin. Do not ask them to use the project author's plugin.

## Official references

- [ChatGPT Work and Codex](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex)
- [Creating and using ChatGPT Sites](https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites)
- [Hosting a plugin with ChatGPT Sites](https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites)

These services and LinkedIn's permission rules can change; verify the current documentation during setup.
