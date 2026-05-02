# Slack message template

This template is rendered as plain Slack markdown (not Block Kit) and sent via `slack_send_message`. Fill the placeholders with values captured during analysis. **Do not** include lines whose values are empty.

```
:studio_microphone: *Tomo mentioned — {{primary_pitcher}} with <{{gong_url}}|{{account}}>*
:date: {{call_date_long}}
:link: <{{gong_url}}|Open in Gong>

*Tomo pitched:* `{{pitch_timestamp}}` _(approx — transcript has no timestamps)_
> "{{pitch_quote}}"
> — {{primary_pitcher}}

*Objections / Questions:*
• `{{ts}}` — "{{question_quote}}" ({{questioner_name}}) → Rep: "{{rep_answer}}"
• `{{ts}}` — "{{question_quote}}" ({{questioner_name}}) → :warning: Rep did not answer / unclear answer — {{rep_response_context}}

_Transcript timestamps unavailable in raw export — pitch/objection markers above are approximations based on position within the transcript._
```

## Field rules

| Field | Source | Notes |
|---|---|---|
| `primary_pitcher` | The Maki rep who actively pitches Tomo on the call (not necessarily the host). Identify them by reading the transcript. | E.g. `Benjamin Chino`, `Richard Millington`. |
| `gong_url` | `get_call.url` | Used twice — as the link target for the account name in the header AND for the explicit "Open in Gong" line. |
| `account` | Best-effort from call title, summary, or external participant's company. | E.g. `Booking.com`, `Accenture`. If genuinely unknown, fall back to the call title. |
| `call_date_long` | `get_call.started` formatted as long date | E.g. `April 30, 2026` (not `4/30/2026`). |
| `pitch_timestamp` | Computed from `get_call_summary` outline (see SKILL.md §4d). | `MM:SS` or `HH:MM:SS`. Always prefix with `~` since this is approximate (e.g. `~3:30`). |
| `pitch_quote` | Verbatim transcript quote where the rep delivers the pitch. 1–4 sentences. | Never fabricate. If unclear, label `[paraphrase]`. |
| `ts` (per Q) | Computed from `get_call_summary` outline (see SKILL.md §4d). | Always prefix with `~`. |
| `question_quote` | Verbatim or `[paraphrase]`. | |
| `questioner_name` | The prospect/customer who raised the question. | E.g. `Allan Racey`, `Jolie Den Boer`. |
| `rep_answer` | Verbatim rep response. | |
| `rep_response_context` | When the rep did NOT answer or deflected, replace `→ Rep: "..."` with `→ :warning: Rep did not answer / unclear answer — {{rep_response_context}}` where the context is a short verbatim phrase showing how they deflected. | E.g. `Richard: "I've not actually thought of it like that."` |

## Conditional / omittable lines

- **`Objections / Questions` block** — if there were none, replace the entire block with: `*Objections / Questions:* none`.
- **Transcript-incomplete footer** — if the transcript itself was truncated/missing (separate from the timestamp caveat), append an extra line: `:warning: _Transcript incomplete — pitch and objections may be partial._`
- **Approximation footer** — keep the italic footer about approximations whenever timestamps were derived from outline durations rather than exact markers (i.e. always, with the current Gong MCP).

## Rendered example

```
:studio_microphone: *Tomo mentioned — Benjamin Chino with <https://eu-93246.app.gong.io/call?id=1516437862980615235|Booking.com>*
:date: April 30, 2026
:link: <https://eu-93246.app.gong.io/call?id=1516437862980615235|Open in Gong>

*Tomo pitched:* `~3:30` _(approx — transcript has no timestamps)_
> "We actually launched a product a couple of weeks ago called Tomo which is an interview assistant. And what that product does is one, it preps the interview for hiring managers and recruiters. So it literally generates an interview plan, and then two, it assists during the interview, meaning that it records, it transcribes, and then it leverages our entire scoring system in order to score the performance of the candidate."
> — Benjamin Chino

*Objections / Questions:*
• `~5:00` — "I don't know if we will be able to use it or that our legal team will allow it because our legal is quite a pain." (Jolie Den Boer) → :warning: Rep did not answer / unclear answer — Natasha pivoted to top-of-funnel assessment opportunities instead.

_Transcript timestamps unavailable in raw export — pitch/objection markers above are approximations based on position within the transcript._
```
