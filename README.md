# tomo-tracker

Hands-off monitor that scans new Gong calls every few hours and posts a structured Slack alert to **#tomo-mention-alerts** whenever Sales or CSMs meaningfully discuss **Tomo** — Maki's AI interview copilot.

The whole thing runs from this repo via GitHub Actions — no local cron, no local state.

## What it captures

For every Gong call where Tomo is **actively pitched** (not just mentioned in passing):

- **Pitch timestamp** — exact `MM:SS` from the Gong transcript, jump straight to that moment.
- **Objections / questions** raised by the prospect/customer about Tomo, with timestamps and verbatim quotes.
- **Unanswered questions** — flagged when the rep deflects or gives an unclear answer, with the deflection captured verbatim.

## Architecture

```
.github/workflows/tomo-tracker.yml      cron + workflow_dispatch
            │
            ▼
   npm ci → npm run typecheck → npm start (src/index.ts)
            │
            ├── Gong API   ── list_calls / transcript / extensive
            ├── Anthropic  ── Claude (claude-opus-4-7) judges meaningful pitch + extracts facts
            └── Slack      ── incoming webhook posts to #tomo-mention-alerts
            │
            ▼
   state/processed_calls.json updated, committed by GH Actions
```

The Claude API call uses **forced tool use** with a strict JSON schema — the model must call `report_findings` exactly once, and the script parses the structured output to render the Slack message. No free-form text, no hallucinated quotes.

## Repo layout

```
src/
├── index.ts        # main entry: list → analyze → alert → save state
├── config.ts       # env-var loading
├── gong.ts         # Gong API client (with timestamp-bearing transcripts)
├── claude.ts       # Anthropic SDK + system prompt + tool schema
├── render.ts       # Slack message renderer + Tomo signal regex
├── slack.ts        # incoming-webhook POST
└── state.ts        # read/write state/processed_calls.json
.github/workflows/
└── tomo-tracker.yml
state/
└── processed_calls.json
```

## Run cadence

GitHub Actions cron (UTC):

```
7 7,10,13,16 * * 1-5
```

≈ **8:07 / 11:07 / 14:07 / 17:07** Paris in winter, **9:07 / 12:07 / 15:07 / 18:07** in summer (DST shifts the wall-clock time by 1h). Cron firings can be delayed a few minutes under GitHub Actions load.

To change cadence: edit `.github/workflows/tomo-tracker.yml`.

## Required GitHub Secrets

Set these in `Settings → Secrets and variables → Actions`:

| Secret | Where to get it |
|---|---|
| `GONG_ACCESS_KEY` | Gong → Company Settings → API → Generate access key |
| `GONG_ACCESS_KEY_SECRET` | Same flow — store the secret immediately, it's shown once |
| `SLACK_WEBHOOK_URL` | Slack → Apps → Incoming Webhooks → Add to Slack → channel `#tomo-mention-alerts` → copy URL |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com → Settings → API keys |

The Gong base URL (`https://eu-93246.api.gong.io`), workspace ID, and Slack channel are baked into the workflow / source — no env override needed for normal use.

## Manual run

```
gh workflow run tomo-tracker
```

…or click *Run workflow* in the GitHub Actions UI. The same code runs whether triggered by cron or manually.

## Local debugging

```bash
npm install
cp .env.example .env  # fill in the four secrets
npm start
```

(`.env` is gitignored — never commit credentials.)

## Resetting state

To force re-analysis of recent calls (e.g. after editing the system prompt):

```bash
echo '{ "lastRunAt": "2026-04-01T00:00:00Z", "processedCallIds": [] }' > state/processed_calls.json
git add state/processed_calls.json && git commit -m "state: reset for re-analysis" && git push
```

The next run (cron or manual) will pick it up.

## Files of note

| Path | Purpose |
|---|---|
| [`src/claude.ts`](src/claude.ts) | Detection rules + tool schema (the brain) |
| [`src/render.ts`](src/render.ts) | Slack message format |
| [`src/gong.ts`](src/gong.ts) | Gong API client — transcripts include `[MM:SS]` timestamps from `/v2/calls/transcript` |
| [`state/processed_calls.json`](state/processed_calls.json) | Ledger: `lastRunAt` + processed call IDs (capped at 500) |
