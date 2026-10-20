# Claude Code deploy prompt

This is a fill-in-the-blanks prompt for Claude Code. If you're setting up Track with Claude's help, Claude fills in the values in `<angle brackets>` for you and gives you the finished prompt to paste into Claude Code. You can also fill it in yourself. The README's "Set up yourself" section explains where each value comes from.

**Never paste your Cloudflare API token into a chat.** The prompt asks Claude Code to have you type it straight into GitHub yourself, or to read it from an environment variable called `CLOUDFLARE_API_TOKEN` that you set before you start Claude Code.

## Before you start Claude Code

1. Install the GitHub command-line tool `gh` and sign in with `gh auth login` (Claude Code can help with this).
2. Optional: so Claude Code can save the API token as a GitHub secret for you without seeing it in the chat, set it in your terminal first. On a Mac or Linux:

   ```sh
   read -s CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN
   ```

   Paste the token and press Enter (nothing shows as you paste). Skip this if you'd rather add the secret on the GitHub website yourself.

3. Start Claude Code in an empty folder: `claude`.

## The prompt

```
Please set up my own private, deployed copy of Track, a family activity tracker, from
https://github.com/Ross-Stone/Website-Track-Public. Read its README.md and CLAUDE.md first and follow them.

My values:
- GitHub account: <GITHUB_USERNAME>
- Name for my private repository: <REPO_NAME, e.g. track>
- Production address: <PROD_HOST, e.g. track.yourfamily.com>
- Preview address: <PREVIEW_HOST, e.g. track-preview.yourfamily.com>
- Cloudflare Zero Trust team name: <TEAM_NAME> (team domain <TEAM_NAME>.cloudflareaccess.com)
- Production Access AUD tag: <PROD_AUD>
- Preview Access AUD tag: <PREVIEW_AUD>
- track-prod D1 database ID: <PROD_D1_ID>
- track-preview D1 database ID: <PREVIEW_D1_ID>
- Cloudflare account ID: <ACCOUNT_ID>
- First Admin email: <ADMIN_EMAIL>

Steps:
1. Make a private copy under my account with
   `gh repo create <GITHUB_USERNAME>/<REPO_NAME> --private --template Ross-Stone/Website-Track-Public --clone`.
   If that isn't possible, stop and ask me to open the repository on GitHub, click "Use this template" >
   "Create a new repository", choose Private, and tell you when it's done. Then clone that repository and
   carry on there. Never push to Ross-Stone/Website-Track-Public.
2. In wrangler.jsonc, replace every placeholder (track.example.com, track-preview.example.com,
   REPLACE_WITH_TEAM_NAME, REPLACE_WITH_PROD_ACCESS_AUD, REPLACE_WITH_PREVIEW_ACCESS_AUD,
   REPLACE_WITH_PROD_D1_ID, REPLACE_WITH_PREVIEW_D1_ID) with my values. Change nothing else. Show me the diff.
3. Install dependencies (Node 24) and run `npm run check`. Everything must pass. Commit with the message
   "Fill in my deployment values" and push to main.
4. Set the GitHub Actions secrets and variables on my repository:
   - secret CLOUDFLARE_ACCOUNT_ID = my account ID;
   - secret CLOUDFLARE_API_TOKEN: if the CLOUDFLARE_API_TOKEN environment variable is set, run
     `gh secret set CLOUDFLARE_API_TOKEN --body "$CLOUDFLARE_API_TOKEN"` without printing it. Otherwise ask me to
     add it on GitHub (Settings > Secrets and variables > Actions > New repository secret) and wait. Never ask
     me to paste the token into this chat, and never write it to a file;
   - variable ADMIN_EMAIL = my Admin email;
   - variable PREVIEW_URL = https://<PREVIEW_HOST>;
   - variable DEPLOY_ENABLED = true (set this last).
5. Deploy through GitHub Actions only: run the "Deploy production" workflow on main
   (`gh workflow run deploy-production.yml --ref main`) and watch it with `gh run watch`. If it fails, explain why
   in plain English and fix what's in the repository; ask me about anything in Cloudflare.
6. Rules: never run wrangler deploy, wrangler d1 execute, wrangler d1 migrations apply or wrangler d1 export
   against my Cloudflare account yourself. Only GitHub Actions touches production data. Don't connect the
   repository to Cloudflare Workers Builds (Cloudflare's Git integration): GitHub Actions does all deploying.
   Don't change my Cloudflare Access settings.
7. Check the site: `curl -sI https://<PROD_HOST>` should redirect to <TEAM_NAME>.cloudflareaccess.com (the sign-in
   page), and `curl -s https://<PROD_HOST>/manifest.webmanifest` should return the app's manifest without signing
   in. If either is wrong, help me fix the Access applications.
8. Ask me to open https://<PROD_HOST> on my Android phone in Chrome, sign in with <ADMIN_EMAIL>, add my child in
   Settings > Children, then install it with "Install app" or ⋮ > "Add to Home screen". Remind me to add other
   people both in Settings > Users and in the Cloudflare Access policy.

I'm not very technical, so explain what you're doing in plain English and check with me before each step.
```
