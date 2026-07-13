import Anthropic from "@anthropic-ai/sdk";
import { config, type ProductKey } from "./config.ts";
import type { CallSummary, GongCall } from "./gong.ts";

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

export interface ObjectionEntry {
  ts: string;
  question_quote: string;
  questioner_name: string;
  rep_answered: boolean;
  rep_answer_or_deflection: string;
}

export interface ProductFinding {
  product: ProductKey;
  meaningful: boolean;
  reason_if_skipped: string;
  primary_pitcher: string;
  account: string;
  pitch_timestamp: string;
  pitch_quote: string;
  objections: ObjectionEntry[];
  transcript_incomplete: boolean;
}

export type SignalType = "feature_request" | "gap" | "sentiment" | "competitor";
export type SpeakerSide = "prospect" | "customer" | "internal";

export interface CustomerSignal {
  type: SignalType;
  speaker_name: string;
  speaker_side: SpeakerSide;
  account: string;
  timestamp: string;
  quote: string;
  summary: string;
  product_area: string;
}

export interface AnalysisResult {
  account: string;
  product_findings: ProductFinding[];
  customer_signals: CustomerSignal[];
}

const SYSTEM_PROMPT = `You analyze Gong sales/CSM call transcripts for Maki People, which sells a suite of five AI hiring agents. In ONE pass you do two things and return everything via the report_findings tool (call it exactly once):

1. Detect meaningful discussions of each of the five Maki products.
2. Capture customer/prospect product signals (feature requests, gaps, sentiment, competitor mentions).

# The five Maki products

Maki now leads externally with CAPABILITY NAMES; the original codenames are transitional sub-labels. On customer-facing calls a rep may use the capability name, the codename, OR informal jargon — detect on ALL of these. Each finding maps to exactly ONE codename key (the "product" enum) for routing.

- **tomo** — capability "Interview Co-pilot". Joins live video calls (Google Meet, Teams, Zoom), records + transcribes, and generates a per-role tailored summary, candidate scoring, structured notes, transcript and recording. Closes the "last black box": the hiring-manager interview. Aliases: "Tomo", interview co-pilot / copilot, interview assist / companion, interview recorder / notetaker, "records and transcribes the interview", AI interview summary / notes. Positioned against generic meeting recorders (Otter, Granola, Fathom) — a rep contrasting Maki with those is almost certainly discussing tomo.
- **mochi** — capability "Voice Screening". Real-time ADAPTIVE AI voice interviewer (web or phone) that replaces the recruiter phone screen; evaluates soft skills, communication, motivation, eligibility; BARS scoring. Aliases: "Mochi", voice screening, voice interview / voice interviewer, AI voice interview, (automated) phone screen, voice agent, conversational screening.
- **kumi** — capability "Scheduling / Orchestration". Automates calendar coordination, candidate self-serve (re)scheduling, and interview confirmations; the scheduling piece of the Orchestration layer; add-on only. Aliases: "Kumi", scheduling, orchestration (layer), interview scheduling, calendar coordination, self-serve (re)scheduling, interview confirmations.
- **shiro** — capability "Skills Screening". Short, structured, NON-adaptive online assessments replacing manual CV screening; measures cognitive, behavioral, technical, role-specific skills + language; science-based scoring. Core early-funnel product. Aliases: "Shiro", skills screening, skills screener, structured assessment, screening assessment, cognitive / soft-skill test.
- **ken** — capability "Deep Assessment". In-depth, structured, NON-adaptive mid/late-funnel evaluation (15–60 min): extended cognitive, long-form coding / system design, case studies / simulations, leadership + personality (Compass). Sold only behind Shiro; competes with SHL and HackerRank. Aliases: "Ken" — THE PRODUCT ONLY, NEVER a person named Ken — deep / in-depth assessment, case study, coding test / challenge, system design, Compass (personality), leadership simulation; competitor cues SHL / HackerRank.

## Disambiguation rules
- "Ken": treat as the product ONLY when the context is clearly about assessment/testing. If "Ken" is a person (a speaker label, a colleague, "let me hand over to Ken", "Ken will follow up") it is NOT a product mention — ignore it.
- Bare "screening" / "assessment" is ambiguous. Attribute to shiro (Skills Screening — a structured online test) vs mochi (Voice Screening — a spoken/voice conversation) ONLY on modality cues. If the modality is genuinely unclear, do NOT fabricate a finding.

# Part 1 — product_findings

Return one entry per product that is MENTIONED at all (by capability name, codename, or jargon). Omit products that are never referenced — do not emit empty findings for them.

For each mentioned product, decide \`meaningful\`:
- meaningful=true if a Maki rep ACTIVELY PITCHES the product — explaining what it does, walking through features, or making a value case in a sustained block of speech — OR a prospect/customer asks a product-specific question / raises an objection.
- meaningful=false if the product is only mentioned in passing (e.g. "we also have an agent called Mochi") with no pitch, no question, and no objection. Set reason_if_skipped to a one-sentence reason.

If a product is introduced briefly early and pitched in depth later, capture the DEEPER pitch's timestamp and quote, not the introduction.

For each finding:
- primary_pitcher: full name of the Maki rep who delivers the pitch. Empty string if meaningful=false.
- account: the external company (see account rules). Empty string if meaningful=false.
- pitch_timestamp / pitch_quote: the deeper pitch. Empty strings if meaningful=false.
- objections: every product-SPECIFIC question / objection / pushback / hesitation raised by the prospect or customer (NOT a Maki rep) about THIS product. For each: ts, verbatim question_quote (label [paraphrase] if unclear), questioner_name, rep_answered (true only if answered substantively), rep_answer_or_deflection (verbatim answer, or a short verbatim phrase showing the deflection). Empty array if none.
- transcript_incomplete: true if the transcript appears truncated or the analysis may be partial.

# Part 2 — customer_signals

Independently of the pitches, capture what PROSPECTS and CUSTOMERS say about Maki's product that is worth routing to the product team. Four types:
- feature_request — an explicit ask for a capability Maki does not (clearly) have, or a "can it do X?" question framed as a need.
- gap — a missing capability, limitation, or friction the customer hits or calls out.
- sentiment — a clear expression of satisfaction or dissatisfaction about the product or experience.
- competitor — the customer names a competing / alternative tool they use or are evaluating. Seed lists (NOT exhaustive): scheduling → GoodTime, ModernLoop, Paradox; deep assessment → SHL, HackerRank; interview recording → Otter, Granola, Fathom, Gong.

For each signal: type, speaker_name, speaker_side (prospect | customer | internal), account, timestamp (best-effort [MM:SS]), quote (VERBATIM), summary (a short paraphrase suitable for a one-line Slack bullet), product_area (which product/area it relates to, or empty string if general).

Capture signals actually voiced by an external prospect/customer and mark speaker_side accordingly (use "internal" only when a Maki person is relaying a customer's request). Do NOT invent signals; if the call has none, return an empty array.

# Call-level account
Set the top-level \`account\` to the external company (e.g. "Booking.com", "Accenture") — derive from the call title, summary, or external participants. If genuinely unknown, use the call title verbatim. Reuse it for per-finding / per-signal account unless a single call clearly spans multiple accounts.

# Global rules
- Facts only. No commentary, scoring, or recommendations.
- NEVER fabricate quotes. If a quote is unclear, label it [paraphrase].
- The transcript already includes timestamps as [MM:SS] or [H:MM:SS] at the start of each speaker turn — use those directly. Format as MM:SS or H:MM:SS, no leading "~", no minute-only values.
`;

const OBJECTION_ITEM_SCHEMA = {
  type: "object",
  properties: {
    ts: { type: "string" },
    question_quote: { type: "string" },
    questioner_name: { type: "string" },
    rep_answered: {
      type: "boolean",
      description:
        "True only if the rep answered substantively. False if they deflected or gave an unclear answer.",
    },
    rep_answer_or_deflection: {
      type: "string",
      description:
        'If rep_answered=true: their verbatim answer. If rep_answered=false: a short verbatim phrase showing the deflection (e.g. "I\'ve not actually thought of it like that.").',
    },
  },
  required: [
    "ts",
    "question_quote",
    "questioner_name",
    "rep_answered",
    "rep_answer_or_deflection",
  ],
} as const;

const ANALYSIS_TOOL: Anthropic.Tool = {
  name: "report_findings",
  description:
    "Report structured product-mention findings and customer product signals from the call transcript. Always call this exactly once.",
  input_schema: {
    type: "object",
    properties: {
      account: {
        type: "string",
        description:
          'Call-level external company name, e.g. "Booking.com", "Accenture". Call title verbatim if genuinely unknown.',
      },
      product_findings: {
        type: "array",
        description:
          "One entry per Maki product that is MENTIONED in the call (by capability name, codename, or jargon). Omit products that are never referenced.",
        items: {
          type: "object",
          properties: {
            product: {
              type: "string",
              enum: ["tomo", "mochi", "kumi", "shiro", "ken"],
              description: "The product codename this finding routes to.",
            },
            meaningful: {
              type: "boolean",
              description:
                "True if the product was actively pitched OR a prospect/customer raised a product-specific question/objection. False if only mentioned in passing.",
            },
            reason_if_skipped: {
              type: "string",
              description:
                "If meaningful=false, a one-sentence reason. Empty string if meaningful=true.",
            },
            primary_pitcher: {
              type: "string",
              description:
                "Full name of the Maki rep who pitches this product. Empty string if meaningful=false.",
            },
            account: {
              type: "string",
              description:
                "External company name for this finding. Empty string if meaningful=false.",
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
                "Every product-specific question/objection raised by the prospect/customer about THIS product. Empty array if none.",
              items: OBJECTION_ITEM_SCHEMA,
            },
            transcript_incomplete: {
              type: "boolean",
              description:
                "True if the transcript appears truncated or the analysis may be partial.",
            },
          },
          required: [
            "product",
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
      },
      customer_signals: {
        type: "array",
        description:
          "Product signals voiced by prospects/customers (feature requests, gaps, sentiment, competitor mentions). Empty array if none.",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["feature_request", "gap", "sentiment", "competitor"],
            },
            speaker_name: { type: "string" },
            speaker_side: {
              type: "string",
              enum: ["prospect", "customer", "internal"],
            },
            account: { type: "string" },
            timestamp: {
              type: "string",
              description: "Best-effort MM:SS or H:MM:SS. Empty string if unclear.",
            },
            quote: {
              type: "string",
              description: "Verbatim quote. Label [paraphrase] if unclear.",
            },
            summary: {
              type: "string",
              description: "Short paraphrase for a one-line Slack bullet.",
            },
            product_area: {
              type: "string",
              description:
                "Product/area the signal relates to, or empty string if general.",
            },
          },
          required: [
            "type",
            "speaker_name",
            "speaker_side",
            "account",
            "timestamp",
            "quote",
            "summary",
            "product_area",
          ],
        },
      },
    },
    required: ["account", "product_findings", "customer_signals"],
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
    max_tokens: 8192,
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
  const input = toolUse.input as Partial<AnalysisResult>;
  return {
    account: input.account ?? call.title,
    product_findings: input.product_findings ?? [],
    customer_signals: input.customer_signals ?? [],
  };
}
