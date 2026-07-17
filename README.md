# product-trackers

Hands-off monitor that scans new Gong calls every few hours and posts **product signals** to Slack — everything a prospect/customer says about Maki's five AI agents (questions, feature requests, gaps, objections, competitors), routed to a channel per agent, plus a separate channel for net-new product ideas.

It surfaces the **customer's voice about the product**, not the sales pitch (a pitch with no customer reaction produces no alert). Runs entirely from this repo via GitHub Actions — no local cron, no local state.

> The repo keeps the name `tomo-tracker` for continuity; it now covers the whole agent suite.

## Channels

| Signal | Channel |
|---|---|
| Tomo (Interview Co-pilot) | `#tomo-mention-alerts` (`C0B0CHKC58X`) |
| Mochi (Voice Screening) | `#mochi-mention-alerts` (`C0BH3QDQXS8`) |
| Kumi (Scheduling) | `#kumi-mention-alerts` (`C0BH20RQH2M`) |
| Shiro (Skills Screening) & Ken (Deep Assessment) | `#shiro-ken-mention-alerts` (`C0BGJN0925D`, shared) |
| Net-new product requests | new-product channel (`C0BH20VCTFB`) |

One message per agent that has signals on a given call, to that agent's channel. The **new-product channel** is low-volume: it receives *only* requests for products Maki doesn't offer yet (e.g. sourcing) — never new features on existing products (those go to the agent's channel).

## What a "signal" is

A prospect/customer statement the **product team can act on** — the litmus test is "could a PM open a build/fix ticket from it?". Four types:

- **question** — a product question revealing a real need or evaluation criterion.
- **request_gap** — a feature request or a concrete gap/limitation in the product.
- **objection** — a doubt, concern, or risk about the product.
- **competitor** — a competing *product* the customer uses/evaluates. (ATS platforms — iCIMS, Cegid/Talentsoft, SmartRecruiters, Avature… — are never competitors; they're integration targets.)

Deliberately excluded: sales-process/deal mechanics, pricing/commercial, positioning/messaging, the customer's own operational metrics, client-reference asks, curiosity/pitch-clarification questions, and needs already met.

## Message format

```
:bulb: *Mochi — Apave*  · July 17, 2026
:link: <gong-url|Open in Gong>

*Questions, requests & gaps*
• {self-contained summary of the ask}
> "{verbatim quote}" — {speaker}
→ Rep: "{how the rep answered}"

*Objections / concerns*
• {summary}
> "{quote}" — {speaker}
→ :warning: Unaddressed — {what the rep did instead}
```

Sub-category headers group the bullets; each bullet leads with a self-contained summary, the quote (with speaker) beneath, then how the rep handled it. No timestamps.

## Architecture

```
.github/workflows/tomo-tracker.yml      cron + workflow_dispatch (+ dry-run inputs)
            │
   npm ci → npm run typecheck → npm start (src/index.ts)
            │
            ├── Gong API   ── list calls / transcript / extensive (parties, summary)
            ├── gate       ── skip if transcript < 50 chars OR internal-only
            ├── Anthropic  ── ONE combined Claude call → report_findings { signals[] }
            └── Slack      ── bot token (chat.postMessage) → per-agent + new-product channels
            │
   state/processed_calls.json updated (flushed per call), committed by GH Actions
```

Forced tool use with a strict JSON schema — the model calls `report_findings` exactly once; no free-form text, no hallucinated quotes.

## State & idempotency

`state/processed_calls.json`: `{ lastRunAt, processedCallIds (cap 1000), sentAlerts (cap 3000) }`. `sentAlerts` holds `"<callId>:<trackerKey>"` for every message sent, so re-runs never duplicate. State is flushed after every call and committed with `if: always()`, so a timeout mid-backfill resumes cleanly.

## Repo layout

```
src/
├── index.ts     # list → gate → analyze once → route per agent + new-product → save state
├── config.ts    # env, bot token, agents (label/emoji/channel), new-product channel
├── gong.ts      # Gong client (transcripts + hasExternalParty)
├── claude.ts    # system prompt + report_findings schema (the brain)
├── render.ts    # Slack message rendering (sub-categories)
├── slack.ts     # chat.postMessage via bot token
└── state.ts     # read/write state + sentAlerts ledger
```

## Run cadence

GitHub Actions cron (UTC): `7 7,10,13,16 * * 1-5` — ≈ 8:07/11:07/14:07/17:07 Paris in winter, one hour later in summer.

## GitHub configuration

Secrets (`Settings → Secrets and variables → Actions`):

| Secret | Where |
|---|---|
| `GONG_ACCESS_KEY` / `GONG_ACCESS_KEY_SECRET` | Gong → Company Settings → API |
| `SLACK_BOT_TOKEN` | Slack app → OAuth & Permissions → Bot User OAuth Token (`xoxb-…`, scope `chat:write`, bot invited to every channel) |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com |

Channel IDs default in `src/config.ts` (override per channel with `SLACK_CHANNEL_{TOMO,MOCHI,KUMI,SHIRO_KEN,NEW_PRODUCT}` if a channel ever moves).

## Manual run & dry-run

```
gh workflow run tomo-tracker                                   # real run on main
gh workflow run tomo-tracker --ref <branch> \                  # safe dry-run:
  -f dry_run_channel=<channel-or-DM-id> -f backfill_days=3      # all msgs → one channel, throwaway state
```

## Local debugging

```bash
npm install
cp .env.example .env   # fill in secrets; set SLACK_CHANNEL_* to your DM id for a local dry-run
npm start
```

## Resetting / backfilling

```bash
# forward-only (default at cutover): lastRunAt=now, fresh ledger
# to backfill N days into the channels, instead set lastRunAt = now − N days and clear processedCallIds + sentAlerts
git add state/processed_calls.json && git commit -m "state: reset" && git push
```
