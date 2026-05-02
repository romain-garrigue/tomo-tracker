# Slack message template

This template is rendered as plain Slack markdown (not Block Kit) and sent via `slack_send_message`. Fill the placeholders with values captured during analysis. **Do not** include lines whose values are empty.

```
:speech_balloon: *Tomo discussed — {{call_title}}*
<{{gong_url}}|Open in Gong> · {{call_date}} · {{duration}} · {{scope}}
*Host(s):* {{hosts}}    *Account:* {{account_or_company}}

*Pitch starts at* `{{pitch_timestamp}}`
> {{pitch_quote_or_paraphrase}}

*Objections / Questions*
• `{{ts}}` — "{{question_quote}}" → Rep: "{{rep_answer}}"
• `{{ts}}` — "{{question_quote}}" → ⚠️ Rep did not answer / unclear answer

⚠️ _Transcript incomplete — timestamp and objections may be partial._
```

## Field rules

| Field | Source | Notes |
|---|---|---|
| `call_title` | `get_call.title` | |
| `gong_url` | `get_call.url` | The link Slack will hyperlink "Open in Gong" against |
| `call_date` | `get_call.started` | Format `M/D/YYYY` (e.g. `4/30/2026`) |
| `duration` | `get_call.duration` | Format `Xm` (e.g. `28m`) |
| `scope` | `get_call.scope` | `External` or `Internal` |
| `hosts` | `get_call` participants flagged as host | Comma-separated full names. Omit field if unknown |
| `account_or_company` | Best-effort from call title or participants | Omit field if unknown |
| `pitch_timestamp` | Manual analysis | `MM:SS` or `HH:MM:SS`, the **deeper** pitch start, not the first mention |
| `pitch_quote_or_paraphrase` | Manual analysis | 1–3 sentences. Verbatim, or label `[paraphrase]` |
| `ts` (per Q) | Manual analysis | Timestamp of the question/objection |
| `question_quote` | Manual analysis | Verbatim, or label `[paraphrase]` |
| `rep_answer` | Manual analysis | Verbatim. If rep didn't answer or deflected, replace the entire `→ Rep: ...` segment with `→ ⚠️ Rep did not answer / unclear answer` |

## Conditional / omittable lines

- **`Account:` segment** — omit if unknown (just keep `*Host(s):* ...` on that line).
- **`Objections / Questions` block** — if there were none, replace the entire block with: `*Objections / Questions:* none`.
- **Transcript-incomplete footer** — include only if `transcript_incomplete = true`.

## Rendered example

```
:speech_balloon: *Tomo discussed — Equium Partners x Maki*
<https://us-12345.app.gong.io/call?id=7969383385873943560|Open in Gong> · 4/30/2026 · 41m · External
*Host(s):* Marc Schweitzer    *Account:* Equium Partners

*Pitch starts at* `12:34`
> "So Tomo is our AI interview copilot — it joins the interview, transcribes, takes structured notes, and produces a scored summary tailored to the role…"

*Objections / Questions*
• `15:02` — "How does it integrate with our ATS?" → Rep: "We have native integrations with Greenhouse and Workday today, others via API."
• `18:45` — "What about GDPR and where is data stored?" → ⚠️ Rep did not answer / unclear answer
```
