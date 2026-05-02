import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.ts";
import type { CallSummary, GongCall } from "./gong.ts";

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

export interface ObjectionEntry {
  ts: string;
  question_quote: string;
  questioner_name: string;
  rep_answered: boolean;
  rep_answer_or_deflection: string;
}

export interface AnalysisResult {
  meaningful: boolean;
  reason_if_skipped?: string;
  primary_pitcher?: string;
  account?: string;
  pitch_timestamp?: string;
  pitch_quote?: string;
  objections?: ObjectionEntry[];
  transcript_incomplete?: boolean;
}

const SYSTEM_PROMPT = `You analyze Gong sales/CSM call transcripts for meaningful discussions of "Tomo" — Maki People's AI interview copilot product. You apply strict detection rules and return structured findings via the report_findings tool.

# Tomo signals (case-insensitive)
A "Tomo signal" is any reference to: Tomo, interview recording, interview intelligence, interview companion, interview notes, AI interview summary.

# Pitch detection
A meaningful Tomo discussion requires the rep to ACTIVELY PITCH Tomo — explaining what it does, walking through features, or making a value case in a sustained block of speech. NOT a passing mention like "we also have an agent called Tomo" with no follow-up.

If Tomo is introduced briefly early and then pitched in depth later, capture the DEEPER pitch's timestamp and quote, not the introduction.

A call is meaningful if Tomo is actively pitched OR a customer asks a Tomo-specific question/objection. If Tomo is only mentioned in passing with no pitch, no question, and no objection — set meaningful=false.

# Objections / Questions
Capture every moment where the prospect or customer (NOT a Maki rep) asks a question, pushes back, expresses doubt, or signals hesitation about Tomo specifically (not other Maki products like Moki, Shiro, etc.).

For each: capture the timestamp, the verbatim quote (or label [paraphrase] if unclear), the questioner's name, whether the rep answered, and either the rep's verbatim answer OR a short verbatim phrase showing the deflection.

# Rules
- Facts only. No commentary, scoring, or recommendations.
- Never fabricate quotes. If unclear, label [paraphrase].
- The transcript provided already includes timestamps in the form [MM:SS] or [H:MM:SS] at the start of each speaker turn — use those directly.
- For pitch_timestamp and ts on objections: use the timestamp at the start of the relevant speaker turn (the [MM:SS] marker). Format as MM:SS or H:MM:SS — no leading "~", no minute-only values.
- The "account" is the external company (e.g. "Booking.com", "Accenture") — derive from call title, summary, or external participants. If genuinely unknown, set account to the call title verbatim.
- The "primary_pitcher" is the Maki rep who delivers the pitch. Use their full name as it appears in the transcript.
`;

const ANALYSIS_TOOL: Anthropic.Tool = {
  name: "report_findings",
  description:
    "Report structured findings from the call transcript. Always call this exactly once.",
  input_schema: {
    type: "object",
    properties: {
      meaningful: {
        type: "boolean",
        description:
          "True if Tomo was actively pitched OR a customer raised a Tomo-specific question/objection. False if Tomo was only mentioned in passing with no pitch/question/objection.",
      },
      reason_if_skipped: {
        type: "string",
        description:
          "If meaningful=false, a one-sentence reason. Empty string if meaningful=true.",
      },
      primary_pitcher: {
        type: "string",
        description:
          "Full name of the Maki rep who pitches Tomo. Empty string if meaningful=false.",
      },
      account: {
        type: "string",
        description:
          'External company name, e.g. "Booking.com", "Accenture". Empty string if meaningful=false.',
      },
      pitch_timestamp: {
        type: "string",
        description:
          "MM:SS or H:MM:SS of the deeper pitch start. Empty string if meaningful=false.",
      },
      pitch_quote: {
        type: "string",
        description:
          "1–4 sentence verbatim quote where the rep delivers the pitch. Empty string if meaningful=false.",
      },
      objections: {
        type: "array",
        description:
          "Every Tomo-specific question/objection raised by the customer. Empty array if there are none.",
        items: {
          type: "object",
          properties: {
            ts: { type: "string" },
            question_quote: { type: "string" },
            questioner_name: { type: "string" },
            rep_answered: {
              type: "boolean",
              description: "True if the rep answered substantively. False if they deflected or gave an unclear answer.",
            },
            rep_answer_or_deflection: {
              type: "string",
              description:
                "If rep_answered=true: their verbatim answer. If rep_answered=false: a short verbatim phrase showing the deflection (e.g. \"I've not actually thought of it like that.\").",
            },
          },
          required: [
            "ts",
            "question_quote",
            "questioner_name",
            "rep_answered",
            "rep_answer_or_deflection",
          ],
        },
      },
      transcript_incomplete: {
        type: "boolean",
        description:
          "True if the transcript appears truncated or the analysis may be partial.",
      },
    },
    required: [
      "meaningful",
      "reason_if_skipped",
      "primary_pitcher",
      "account",
      "pitch_timestamp",
      "pitch_quote",
      "objections",
      "transcript_incomplete",
    ],
  },
};

export async function analyze(
  call: GongCall,
  transcript: string,
  summary: CallSummary | null,
): Promise<AnalysisResult> {
  const summaryBlock = summary
    ? `## Gong AI summary\n\nBrief: ${summary.brief ?? "(none)"}\n\nKey points:\n${(summary.keyPoints ?? []).map((p) => `- ${p}`).join("\n")}\n`
    : "";

  const userMessage = `# Call metadata
Title: ${call.title}
Date: ${call.started}
Duration: ${call.duration}s
Scope: ${call.scope ?? "Unknown"}

${summaryBlock}

## Transcript

${transcript}

---

Apply the detection rules and call report_findings exactly once.`;

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [ANALYSIS_TOOL],
    tool_choice: { type: "tool", name: "report_findings" },
    messages: [{ role: "user", content: userMessage }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error(
      `Claude did not call report_findings. Stop reason: ${response.stop_reason}`,
    );
  }
  return toolUse.input as AnalysisResult;
}
