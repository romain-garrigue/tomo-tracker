# tomo-tracker

Hands-off monitor that scans new Gong calls every few hours and posts structured Slack alerts whenever Sales or CSMs meaningfully discuss one of **Maki's five AI hiring agents** — or whenever a prospect/customer drops a **product signal** (feature request, gap, sentiment, competitor mention).

One repo, one workflow, **one Gong pass per call** fanning out to six logical trackers across five channels. The whole thing runs from this repo via GitHub Actions — no local cron, no local state.

> The repo keeps the name `tomo-tracker` for continuity; it now tracks the whole agent suite.

## Trackers → channels

| Tracker | Product (capability) | Channel |
|---|---|---|
| `tomo` | Tomo — Interview Co-pilot | `#tomo-mention-alerts` |
| `mochi` | Mochi — Voice Screening | `#mochi-mention-alerts` |
| `kumi` | Kumi — Scheduling / Orchestration | `#kumi-mention-alerts` |
| `shiro` | Shiro — Skills Screening | `#shiro-ken-mention-alerts` (shared) |
| `ken` | Ken — Deep Assessment | `#shiro-ken-mention-alerts` (shared) |
| `product-signals` | customer feature requests / gaps / sentiment / competitors | `#product-signals` |

Shiro and Ken share one channel; the message header says which product was pitched.

## What it captures

**Per-product alerts** — for every call where a product is **actively pitched** (not just mentioned in passing):

- **Pitch timestamp** — exact `MM:SS` from the Gong transcript, jump straight to that moment.
- **Objections / questions** raised by the prospect/customer about that product, with timestamps and verbatim quotes.
- **Unanswered questions** — flagged when the rep deflects or gives an unclear answer, captured verbatim.

**Product signals** — one grouped message per call collecting what prospects/customers say:

- `feature_request`, `gap`, `sentiment`, `competitor` — each with a timestamp, verbatim quote, and speaker.

Detection keys on the **capability name + codename + jargon** (Maki now leads externally with capability names), and the model disambiguates hard cases — notably "Ken" the product vs. a person named Ken. Grounded in the Notion source of truth *"Discover the Maki AI Agents"*.

## Architecture

```
.github/workflows/tomo-tracker.yml      cron + workflow_dispatch
            │
            ▼
   npm ci → npm run typecheck → npm start (src/index.ts)
            │
            ├── Gong API   ── list calls / transcript / extensive (parties, summary)
            │
            ├── gate       ── skip if transcript < 50 chars OR call is internal-only
            │
            ├── Anthropic  ── ONE combined Claude call per call → report_findings
            │                  { product_findings[], customer_signals[] }
            │
            └── Slack      ── bot token (chat.postMessage) fans out per tracker
            │
            ▼
   state/processed_calls.json updated, committed by GH Actions
```

**One combined Claude call per substantive call.** `#product-signals` isn't keyword-bound, so an LLM pass is needed on essentially every substantive call anyway — folding the 5-product detection into that same call is cheaper (1 call vs. N), sees the full transcript once, and lets the model disambiguate. Forced tool use with a strict JSON schema — the model calls `report_findings` exactly once, no free-form text, no hallucinated quotes.

## Idempotency & state

`state/processed_calls.json`:

```json
{
  "lastRunAt": "ISO",
  "processedCallIds": ["…"],
  "sentAlerts": ["<callId>:<trackerKey>", "…"]
}
```

- **`processedCallIds`** — calls the combined pass already analyzed (cost control, capped at 1000).
- **`sentAlerts`** — every alert sent, keyed `"<callId>:<trackerKey>"` (capped at 3000). Prevents duplicate posts and makes backfill / adding a product later safe. A call is only marked fully processed once **all** its sends succeed, so a not-yet-invited channel retries next run without re-posting the ones that already landed.

## Repo layout

```
src/
├── index.ts        # main: list → gate → analyze once → fan out → save state
├── config.ts       # env loading, bot token, channels map, trackers array
├── gong.ts         # Gong API client (timestamped transcripts + hasExternalParty)
├── claude.ts       # combined system prompt + report_findings schema (the brain)
├── render.ts       # renderProductMessage + renderSignalsMessage
├── slack.ts        # chat.postMessage via bot token
└── state.ts        # read/write state + sentAlerts ledger
.github/workflows/
└── tomo-tracker.yml
state/
└── processed_calls.json
```

## Run cadence

GitHub Actions cron (UTC): `7 7,10,13,16 * * 1-5` — ≈ **8:07 / 11:07 / 14:07 / 17:07** Paris in winter, one hour later in summer (DST). Firings can be delayed a few minutes under load. To change cadence, edit the workflow.

## Slack bot setup (one-time)

1. **Create the channels**: `#mochi-mention-alerts`, `#kumi-mention-alerts`, `#shiro-ken-mention-alerts`, `#product-signals` (`#tomo-mention-alerts` already exists).
2. **Create a Slack app** → **OAuth & Permissions** → add bot scope **`chat:write`** → **Install to Workspace** → copy the **Bot User OAuth Token** (`xoxb-…`).
3. **Invite the bot** into all **5** channels — including `#tomo-mention-alerts` (it switched from webhook to bot token, so the bot must be a member or posts fail with `not_in_channel`).
4. Add the token + channel IDs to GitHub (below).

## GitHub configuration

**Secrets** (`Settings → Secrets and variables → Actions → Secrets`):

| Secret | Where to get it |
|---|---|
| `GONG_ACCESS_KEY` | Gong → Company Settings → API → Generate access key |
| `GONG_ACCESS_KEY_SECRET` | Same flow — shown once |
| `SLACK_BOT_TOKEN` | Slack app → OAuth & Permissions → Bot User OAuth Token (`xoxb-…`) |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com → API keys |

**Variables** (`… → Variables`) — channel IDs, not secret (right-click a channel → *View channel details* → ID at the bottom):

| Variable | Channel |
|---|---|
| `SLACK_CHANNEL_TOMO` | `#tomo-mention-alerts` (defaults to `C0B0CHKC58X` if unset) |
| `SLACK_CHANNEL_MOCHI` | `#mochi-mention-alerts` |
| `SLACK_CHANNEL_KUMI` | `#kumi-mention-alerts` |
| `SLACK_CHANNEL_SHIRO_KEN` | `#shiro-ken-mention-alerts` |
| `SLACK_CHANNEL_PRODUCT_SIGNALS` | `#product-signals` |

An unset channel variable simply skips that tracker until its channel exists — the others keep working.

## Manual run

```
gh workflow run tomo-tracker
```

…or click *Run workflow* in the Actions UI. Same code whether cron or manual.

## Local debugging

```bash
npm install
cp .env.example .env   # fill in the secrets + channel IDs
npm start
```

For a safe **dry-run**, set every `SLACK_CHANNEL_*` in `.env` to your own DM/user ID (e.g. `U096JJ1GSAJ`) so all trackers post to you instead of the real channels. (`.env` is gitignored — never commit credentials.)

## Resetting / backfilling state

To force re-analysis of recent calls (e.g. after editing the prompt or adding a product):

```bash
echo '{ "lastRunAt": "2026-07-01T00:00:00Z", "processedCallIds": [], "sentAlerts": [] }' > state/processed_calls.json
git add state/processed_calls.json && git commit -m "state: reset for re-analysis" && git push
```

To backfill new trackers **without** re-spamming `#tomo-mention-alerts` for historical calls, keep the existing `"<id>:tomo"` entries in `sentAlerts` while clearing `processedCallIds`. The next run re-analyzes the window but only posts alerts whose `sentAlerts` key is new.

## Files of note

| Path | Purpose |
|---|---|
| [`src/claude.ts`](src/claude.ts) | Grounded product roster + signal types + tool schema (the brain) |
| [`src/render.ts`](src/render.ts) | Slack message formats (product alert + signals) |
| [`src/gong.ts`](src/gong.ts) | Gong API client — transcripts include `[MM:SS]` timestamps |
| [`state/processed_calls.json`](state/processed_calls.json) | Ledger: `lastRunAt` + processed IDs + `sentAlerts` |
```
