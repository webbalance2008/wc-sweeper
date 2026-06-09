# World Cup 2026 Sweepstake ⚽

A self-contained live sweepstake tracker for the 2026 FIFA World Cup. Five players,
nine teams each, live results pulled from [API-Football](https://www.api-football.com/)
directly in the browser. No backend.

## Players & teams (seeded draw)

| Player | Teams |
|--------|-------|
| Paul   | Brazil, Germany, Morocco, Sweden, Turkey, Bosnia & Herzegovina, South Korea, Iraq, Qatar |
| Kevin  | England, Portugal, Colombia, Croatia, Switzerland, Czech Republic, Ghana, Tunisia, New Zealand |
| Craig  | France, Norway, Uruguay, Mexico, Canada, Ivory Coast, Scotland, DR Congo, Uzbekistan |
| Stuart | Argentina, Netherlands, Japan, Ecuador, Austria, Algeria, Iran, Jordan, Saudi Arabia |
| Peter  | Spain, Belgium, USA, Senegal, Paraguay, Egypt, Australia, Cape Verde, Panama |

## Scoring

- **3 points** per win, **1 point** per draw (both editable in the page), summed across each player's 9 teams over every tournament match.
- A penalty-shootout win counts as a full win (3 points); the loser takes a loss.
- Tiebreakers: predicted tournament totals for goals, own goals, yellow cards, red cards. Closest prediction wins the tiebreak.

## Running it

Just open `index.html` in a browser. On first load, paste an
[API-Football](https://dashboard.api-football.com/) key into the Setup box — it's
stored in that browser's `localStorage` only and is sent straight to api-sports.io.
Each player enters their own key.

## Deploying (Cloudflare Pages — push to auto-deploy)

This is a static site (single HTML file), so no build step is required.

1. Push this folder to a GitHub repo (see below).
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**.
3. Pick the repo. Build settings:
   - **Framework preset:** None
   - **Build command:** *(leave blank)*
   - **Build output directory:** `/`
4. **Save and Deploy.** You get a `https://<project>.pages.dev` URL.

After that, **every `git push` to the production branch auto-deploys.** Pull requests
get their own preview URLs automatically.

### First push

```bash
cd wc26-sweepstake
git init
git add .
git commit -m "Initial commit: World Cup 2026 sweepstake"
git branch -M main
git remote add origin https://github.com/webbalance2008/wc-sweeper
git push -u origin main
```

## Expanding later

Because it's Git-connected, you can grow this without changing the deploy flow:

- **Shared state across players** (so everyone sees the same predictions/key-free data): add a Cloudflare **Worker + KV or D1**, or a small **Functions** directory (`/functions/api/*.js`) — Pages will build and deploy it on push.
- **Build step / framework** (Vite, etc.): set the build command and output dir in the Pages settings; the Git integration handles the rest.
- **Hide the API key**: proxy API-Football through a Pages Function so the key lives in a Cloudflare secret instead of each browser.
