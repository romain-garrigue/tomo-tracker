---
name: tomo-tracker
description: Scan new Gong calls for meaningful Tomo discussions and post structured alerts to #tomo-mention-alerts. Idempotent — uses state/processed_calls.json to avoid re-analyzing calls.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - mcp__eeef5e9a-93be-4cb0-8bd0-45b181a667c0__list_calls
  - mcp__eeef5e9a-93be-4cb0-8bd0-45b181a667c0__get_call
  - mcp__eeef5e9a-93be-4cb0-8bd0-45b181a667c0__get_call_transcript
  - mcp__eeef5e9a-93be-4cb0-8bd0-45b181a667c0__get_call_summary
  - mcp__5f77e669-21d0-4171-bf15-bf3d71994d47__slack_send_message
---

# Tomo Tracker

Scan new Gong calls for meaningful Tomo discussions and post structured alerts to Slack `#tomo-mention-alerts` (channel ID `C0B0CHKC58X`). State is committed to this repo so runs are idempotent and auditable.

## Constants

- **Gong workspace ID**: `6135656620898778750` (Maki People Workspace)
- **Slack channel ID**: `C0B0CHKC58X` (`#tomo-mention-alerts`)
- **Repo path**: `~/code/tomo-tracker`
- **State file**: `state/processed_calls.json`
- **Backfill window on cold start**: 7 days

## Run procedure

Execute these steps in order. Each step is idempotent — safe to re-run after a partial failure.

### 1. Pull repo

```bash
cd ~/code/tomo-tracker && git pull --ff-only origin main
```

If the repo is not yet cloned: `mkdir -p ~/code && cd ~/code && gh repo clone romain-garrigue/tomo-tracker`.

### 2. Read state

Read `state/processed_calls.json`. Schema:

```json
{
  "lastRunAt": "2026-05-02T15:00:00Z",
  "processedCallIds": ["3148931015661136285", ...]
}
```

If the file is missing or `lastRunAt` is null, initialize `lastRunAt = now - 7 days` and `processedCallIds = []`.

### 3. List new Gong calls

Call `list_calls` with:
- `workspaceId`: `6135656620898778750`
- `fromDateTime`: `lastRunAt - 1 hour` (overlap window protects against clock skew)
- `toDateTime`: current time in ISO 8601 UTC

Drop any call whose ID is already in `processedCallIds`. The remaining list is **new calls to analyze**.

If the list is empty: skip to step 5 with `processedCount = 0`. Do not commit (no state change). Do not send Slack messages.

### 4. Analyze each new call

For each new call:

#### 4a. Fetch metadata
Call `get_call` with the call ID. Capture: `title`, `url`, `started` (date), `duration`, `scope`, host names if present.

#### 4b. Fetch transcript and summary
Call `get_call_transcript` with `maxLength: 100000`. If the response indicates truncation, paginate with `offset` until the full transcript is retrieved or you've made 5 pages of progress (cap to avoid runaway).

Also call `get_call_summary` for the same call. The summary's **Outline** is the source of truth for approximate timestamps (see §4d Timestamp computation below) — the raw transcript does **not** include time markers in the current Gong MCP.

If the transcript is unavailable (404, denied, empty): set `transcript_incomplete = true` and rely on `get_call_summary` alone. If even the summary lacks Tomo signals, mark the call processed and skip.

#### 4c. Quick filter — Tomo signals

Search the transcript (case-insensitive) for ANY of:
- `Tomo`
- `interview recording`
- `interview intelligence`
- `interview companion`
- `interview notes`
- `AI interview summary`

If **zero** matches: mark the call processed (so we don't re-analyze it next run), skip to next call. **Do not** send a Slack message.

#### 4d. Deep analysis (judgment)

Read the transcript around each Tomo signal with enough context (~30 seconds before and 90 seconds after each hit) and decide:

**Pitch detection**
- Look for the **moment the rep begins actively pitching** Tomo: explaining what it does, walking through features, making a value case. This is a sustained block of speech, not a passing reference.
- If Tomo is introduced briefly early in the call (e.g. "we also have a product called Tomo") and then pitched in depth later, **use the timestamp of the deeper pitch**, not the introduction.
- If Tomo is **only mentioned once or in passing** with no real pitch AND no question AND no objection: mark `meaningful = false`, mark the call processed, skip. **Do not** send a Slack message.

**Pitch capture (when meaningful)**
- `primary_pitcher`: the Maki rep who delivers the pitch (read it off the transcript). Use their full name as it appears in `get_call` participants.
- `pitch_timestamp`: computed from the summary outline — see **Timestamp computation** below. Always prefixed with `~`.
- `pitch_quote`: 1–4 sentence verbatim quote from the rep at that moment. If the transcript is unclear or paraphrased, label as `[paraphrase]`.

**Objections / Questions**
- For every moment where the **prospect or customer** asks a question, pushes back, expresses doubt, or signals hesitation **about Tomo specifically** (not other Maki products), capture:
  - `ts`: timestamp (computed via outline — see below).
  - `question_quote`: verbatim or `[paraphrase]`.
  - `questioner_name`: the prospect/customer who raised it.
  - `rep_answer`: verbatim answer, OR — if the rep deflected, changed subject, or gave a clearly insufficient response — replace the `→ Rep: "..."` segment with `→ :warning: Rep did not answer / unclear answer — {{short context}}`, where the context is a brief verbatim phrase showing the deflection.

**Timestamp computation (outline-based)**

The current Gong MCP's `get_call_transcript` returns speaker-attributed text **without** time markers. To produce useful approximate timestamps, walk the **`### Outline`** section of `get_call_summary`:

1. Each top-level outline section has the form `**{topic name}** ({D}m)` where `{D}` is its duration in whole minutes.
2. Compute each section's start time by **summing the durations of all preceding sections**. Section #1 starts at `0:00`; section #2 starts at `{duration of #1}:00`; and so on.
3. Identify the section whose bullet content describes the Tomo pitch (or the objection). Use that section's computed start time as the timestamp for the pitch (or for the objection that lives within it).
4. If a single section contains both the pitch and an objection that comes a minute or two later, offset the objection by ~1 minute from the section start as a rough cue.
5. Always prefix the rendered timestamp with `~` — these are approximations, never claim precision.
6. Keep the standard footer in the Slack message acknowledging that timestamps are approximate.

**Note for future improvement:** the cleanest fix is for an admin to create a Gong **keyword tracker** for `Tomo` in the Maki workspace (Gong UI → Smart Trackers). Once that exists, `get_call_summary` will surface tracker hits with exact timestamps, and §4d can be simplified to read those directly. We currently have 11 trackers (Budget, Pricing, Objections, etc.) but no Tomo tracker.

#### 4e. Build and send Slack message

Use `slack_message_template.md` as the format. Render with the captured fields and call `slack_send_message`:
- `channel_id`: `C0B0CHKC58X`
- `message`: rendered markdown

If the Slack call fails (network, permissions): **do not** mark this call processed. Log the error and continue with the next call. The next run will retry this call.

If the Slack call succeeds: mark the call as processed.

### 5. Update state

After all calls have been attempted:

- Append every successfully-processed call ID (whether it triggered a Slack message or not) to `processedCallIds`.
- Cap `processedCallIds` to the most recent 500 IDs (FIFO trim) to keep the file small.
- Set `lastRunAt = now` (ISO 8601 UTC) **only if at least one call was successfully processed**. If every call failed, leave `lastRunAt` untouched so the next run retries the same window.
- Write `state/processed_calls.json` (pretty-printed, 2-space indent).

### 6. Commit and push

If `state/processed_calls.json` actually changed:

```bash
cd ~/code/tomo-tracker
git add state/processed_calls.json
git commit -m "state: processed N calls (M with Tomo signals)"
git push origin main
```

Where `N` is total calls analyzed this run and `M` is the number that triggered a Slack message. If nothing changed, skip the commit entirely.

---

## Detection rules (canonical)

These are the rules from the user's brief. Treat them as authoritative when judgment is required.

### Tomo mention signals
Any reference to: `Tomo`, `interview recording`, `interview intelligence`, `interview companion`, `interview notes`, `AI interview summary`. Case-insensitive. Treat all of these as Tomo signals.

### Timestamp rule
Do **not** capture the first mention of Tomo. Capture the moment the rep begins actively pitching it — explaining what it does, walking through features, or making a value case. This is typically a sustained block of speech, not a passing reference.

If Tomo is introduced briefly early and then pitched in depth later, use the timestamp of the **deeper pitch**, not the introduction.

If Tomo is only mentioned once or in passing with no real pitch, no question, and no objection — **don't take the call into account** (no Slack message).

Capture the timestamp of every objection/question as well, so the user can jump to that moment in Gong.

### Objection / Question rule
Any moment where the prospect or customer asks a question, pushes back, expresses doubt, asks a skeptical question, or signals hesitation about **Tomo specifically**. Capture the verbatim quote — or a close paraphrase if the transcript is unclear, labeled `[paraphrase]`.

---

## Behavioral rules

- **Only send a Slack notification if Tomo was meaningfully discussed in the call.** Zero mentions, or only passing mentions with no pitch / question / objection → no message.
- **One Slack message per call.** Never two for the same call. Consolidate every signal from one call into one message.
- **Multiple calls in one run** → one Slack message per call. Do not batch them into a single message.
- **Skip calls already in `processedCallIds`.** Never re-analyze them.
- **Facts only.** No commentary, coaching notes, or analysis in the Slack message.
- **Never fabricate quotes.** Always label reconstructed content as `[paraphrase]`.
- **If the transcript is missing or incomplete**, send the notification with the additional warning line:
  > :warning: _Transcript incomplete — pitch and objections may be partial._
- **Always include the approximation footer** about timestamps unless/until a Tomo keyword tracker exists in Gong (see §4d).
