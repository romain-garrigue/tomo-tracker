# tomo-tracker

Hands-off monitor that scans new Gong calls every few hours and posts a structured Slack alert to **#tomo-mention-alerts** whenever Sales or CSMs meaningfully discuss **Tomo** — Maki's AI interview copilot.

## What it captures

For every Gong call where Tomo is **actively pitched** (not just mentioned in passing):

- **Pitch timestamp** — the moment the rep starts walking through Tomo (not the first throwaway mention), so you can jump straight to it in Gong.
- **Objections / questions** raised by the prospect or customer about Tomo, with timestamps and verbatim quotes.
- **Unanswered questions** — flagged when the rep deflects or gives an unclear answer.

## How it works

1. A Claude scheduled task fires on a cron — by default **9:07, 12:07, 15:07, 18:07** local time, weekdays.
2. The task runs the [`SKILL.md`](./SKILL.md) procedure:
   - Pulls this repo.
   - Reads `state/processed_calls.json` to find which calls have already been analyzed.
   - Lists new Gong calls in the Maki workspace since `lastRunAt`.
   - For each new call: fetches the transcript, applies the detection rules in `SKILL.md`, and — only if Tomo was meaningfully discussed — posts one structured Slack message per call to `#tomo-mention-alerts`.
   - Updates `state/processed_calls.json` and commits/pushes back here.

The repo is the single source of truth: detection rules live in [`SKILL.md`](./SKILL.md), the alert format lives in [`slack_message_template.md`](./slack_message_template.md), and the processed-call ledger lives in [`state/processed_calls.json`](./state/processed_calls.json).

## Required MCP servers

The Claude that runs this task must have these MCP servers connected:

- **Gong** — provides `list_calls`, `get_call`, `get_call_transcript`, `get_call_summary`.
- **Slack** — provides `slack_send_message`.

Workspace ID and channel ID are hard-coded in `SKILL.md` for the Maki workspace.

## Manual run

From any Claude session with both MCP servers connected:

> "Run the tomo-tracker SKILL at `~/code/tomo-tracker/SKILL.md` following its run procedure exactly."

Claude will pull, analyze, post any alerts, and commit the updated state.

## Inspecting / changing the schedule

In Claude:

- `mcp__scheduled-tasks__list_scheduled_tasks` — see when the next run is.
- `mcp__scheduled-tasks__update_scheduled_task` — change cadence or disable.

## Resetting state

To force a re-analysis of recent calls (e.g. after editing detection rules):

```bash
echo '{ "lastRunAt": "2026-04-01T00:00:00Z", "processedCallIds": [] }' > state/processed_calls.json
git add state/processed_calls.json && git commit -m "state: reset for re-analysis" && git push
```

## Files

| Path | Purpose |
|---|---|
| [`SKILL.md`](./SKILL.md) | Canonical detection rules + run procedure (the brain) |
| [`slack_message_template.md`](./slack_message_template.md) | Format of each Slack alert |
| [`state/processed_calls.json`](./state/processed_calls.json) | Ledger: `lastRunAt` + processed call IDs |
