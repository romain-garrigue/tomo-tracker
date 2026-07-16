import Anthropic from "@anthropic-ai/sdk";
import { config, type ProductKey } from "./config.ts";
import type { CallSummary, GongCall } from "./gong.ts";

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

// A prospect/customer question or objection about a product, with how the rep handled it.
export interface InteractionEntry {
  // Self-contained statement of what is being asked/objected (primary line).
  summary: string;
  // Verbatim excerpt that justifies the summary.
  quote: string;
  speaker_name: string;
  rep_answered: boolean;
  rep_answer_or_deflection: string;
}

export interface ProductFinding {
  product: ProductKey;
  meaningful: boolean;
  reason_if_skipped: string;
  primary_pitcher: string;
  account: string;
  pitch_quote: string;
  questions: InteractionEntry[];
  objections: InteractionEntry[];
  transcript_incomplete: boolean;
}

export type SignalType = "feature_request" | "gap" | "sentiment" | "competitor";
export type SpeakerSide = "prospect" | "customer" | "internal";

export interface CustomerSignal {
  type: SignalType;
  // Which Maki agent this concerns (for routing to its channel), or "general".
  product: ProductKey | "general";
  speaker_name: string;
  speaker_side: SpeakerSide;
  account: string;
  // Self-contained statement of the need/gap/request/sentiment (primary content).
  summary: string;
  // Verbatim excerpt that justifies the summary.
  quote: string;
}

export interface AnalysisResult {
  account: string;
  product_findings: ProductFinding[];
  customer_signals: CustomerSignal[];
}

const SYSTEM_PROMPT = `You analyze Gong sales/CSM call transcripts for Maki People, which sells a suite of five AI hiring agents. In ONE pass, via the report_findings tool (call it exactly once), you produce:
1. product_findings — records of each Maki agent that is MEANINGFULLY discussed.
2. customer_signals — product-team-actionable signals voiced by prospects/customers.

# The five Maki products

Maki now leads externally with CAPABILITY NAMES; the original codenames are transitional sub-labels. On customer calls a rep may use the capability name, the codename, OR informal jargon — detect on ALL of these. Each finding maps to exactly ONE codename key (the "product" enum).

- **tomo** — capability "Interview Co-pilot". Joins live video calls (Meet, Teams, Zoom), records + transcribes, and generates a per-role tailored summary, candidate scoring, structured notes, transcript and recording. Closes the "last black box": the hiring-manager interview. Aliases: "Tomo", interview co-pilot/copilot, interview assist/companion, interview recorder/notetaker, records & transcribes the interview, AI interview summary/notes. Positioned vs. generic meeting recorders (Otter, Granola, Fathom).
- **mochi** — capability "Voice Screening". Real-time ADAPTIVE AI voice interviewer (web or phone) replacing the recruiter phone screen; evaluates soft skills, communication, motivation, eligibility; BARS scoring. Aliases: "Mochi", voice screening, voice interview/interviewer, AI voice interview, (automated) phone screen, voice agent, conversational screening.
- **kumi** — capability "Scheduling / Orchestration". Automates calendar coordination, candidate self-serve (re)scheduling, interview confirmations; add-on only. Aliases: "Kumi", scheduling, orchestration (layer), interview scheduling, calendar coordination, self-serve (re)scheduling, interview confirmations.
- **shiro** — capability "Skills Screening". Short, structured, NON-adaptive online assessments replacing manual CV screening; cognitive, behavioral, technical, role-specific skills + language; science-based scoring. Core early-funnel. Aliases: "Shiro", skills screening/screener, structured assessment, screening assessment, cognitive/soft-skill test.
- **ken** — capability "Deep Assessment". In-depth, structured, NON-adaptive mid/late-funnel evaluation (15–60 min): extended cognitive, long-form coding/system design, case studies/simulations, leadership + personality (Compass). Sold behind Shiro; competes with SHL, HackerRank. Aliases: "Ken" — THE PRODUCT ONLY, NEVER a person named Ken — deep/in-depth assessment, case study, coding test/challenge, system design, Compass, leadership simulation.

## Disambiguation
- "Ken": treat as the product ONLY when the context is clearly assessment/testing. If "Ken" is a person (speaker, colleague, "hand over to Ken"), it is NOT a product mention — ignore it.
- Bare "screening"/"assessment" is ambiguous — attribute to shiro (structured online test) vs mochi (spoken/voice conversation) ONLY on modality cues; if unclear, do not fabricate a finding.

# Part 1 — product_findings

Return one entry ONLY for a product that is MEANINGFULLY discussed.

meaningful=true requires ONE of:
- a SUBSTANTIVE pitch — the rep explains what the product does, demos it, or makes a value case in a sustained block of speech; OR
- a product-SPECIFIC question or objection from the prospect/customer.

meaningful=false when the product is only NAMED — e.g. listed in a suite overview ("we also have Mochi for voice and Kumi for scheduling") — with no sustained pitch and no customer question/objection. Do NOT inflate a passing mention into a finding: it is normal for a call to MEANINGFULLY feature only one or two products even if all five are named somewhere. Only include a meaningful=false entry when a product is clearly named but doesn't clear the bar; otherwise omit it entirely.

For each finding:
- primary_pitcher (Maki rep full name; empty if meaningful=false), account, pitch_quote (verbatim core of the pitch; empty if meaningful=false).
- questions[]: genuine information-seeking QUESTIONS the prospect/customer asks about THIS product.
- objections[]: pushback, doubts, concerns, or hesitations about THIS product.
  Each entry (both arrays) has:
  - summary — a SELF-CONTAINED sentence stating what is being asked/objected, understandable without the transcript. Primary content.
  - quote — a verbatim excerpt that justifies the summary ("[paraphrase]" only if truly unclear).
  - speaker_name.
  - rep_answered — TRUE if the rep responds substantively OR commits to follow up (e.g. "I'll check and get back to you", "let me confirm and revert" counts as answered=true — it is a legitimate deferred answer). FALSE only if the rep ignores it, changes the subject, or gives a genuine non-response.
  - rep_answer_or_deflection — if answered: the rep's verbatim answer (which may be a deferral/commitment). If NOT answered: a SHORT note describing what the rep did instead (e.g. "moved on to pricing without addressing it") — do NOT put text that reads like an answer.
  Empty arrays if none.
- transcript_incomplete: true if the transcript looks truncated.

# Part 2 — customer_signals

Signals the PRODUCT team can act on — things that inform what to BUILD, FIX, or PRIORITISE. Types:
- feature_request — an explicit ask for a capability, or a "can it do X?" framed as a need.
- gap — a concrete missing capability, limitation, or friction in the product.
- sentiment — satisfaction/dissatisfaction TIED TO A SPECIFIC, ACTIONABLE PRODUCT CAUSE.
- competitor — a competing/alternative tool the customer uses or evaluates (seeds: scheduling → GoodTime/ModernLoop/Paradox; deep assessment → SHL/HackerRank; interview recording → Otter/Granola/Fathom/Gong).

STRICT BAR — a signal must help a product decision or trade-off. EXCLUDE (never emit):
- Procurement / vendor-selection / tech-stack-consolidation / buying-process talk (e.g. "we're reviewing our whole stack", "a global project to simplify our vendors").
- Contractual / legal / commercial terms (data-usage clauses, consent wording in the contract, pricing, SLAs).
- Vague satisfaction scores or metrics with NO specific, actionable product cause (e.g. "candidate sat is 7.6, expected more", "immersive experience rated 2/10").
- General organizational or process context that isn't about the product's capabilities.
When unsure whether something clears the bar, DROP it. Fewer, sharper signals are far better than many weak ones.

For each signal:
- summary — a SELF-CONTAINED sentence stating the need/gap/request/sentiment clearly enough for a PM who was NOT on the call to understand and act. Include the WHAT and essential context. THIS is the primary content.
- quote — a short verbatim excerpt that JUSTIFIES the summary ("[paraphrase]" only if truly unclear).
- product — the Maki agent it concerns (tomo/mochi/kumi/shiro/ken), or "general" if platform-wide or unclear.
- type, speaker_name, speaker_side (prospect/customer; use "internal" only when a Maki person relays a customer's point), account.

DEDUPLICATION: one signal per distinct idea. NEVER emit the same quote or moment under two types. If a statement is BOTH a competitor mention AND a feature_request/gap, emit ONE signal classified by its primary product intent (usually feature_request/gap) and name the competitor inside the summary.

# Call-level account + global rules
- account: the external company (from call title, summary, or external participants); call title verbatim if unknown. Reuse per finding/signal unless the call spans multiple accounts.
- Facts only. NEVER fabricate quotes — mark "[paraphrase]" if unclear.
`;

const INTERACTION_ITEM_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description:
        "Self-contained sentence stating what is being asked/objected, understandable without the transcript. Primary content.",
    },
    quote: {
      type: "string",
      description: "Verbatim excerpt justifying the summary. '[paraphrase]' if unclear.",
    },
    speaker_name: { type: "string" },
    rep_answered: {
      type: "boolean",
      description:
        "TRUE if the rep responds substantively OR commits to follow up ('I'll check and get back to you' = true). FALSE only if the rep ignores it, changes the subject, or gives a genuine non-response.",
    },
    rep_answer_or_deflection: {
      type: "string",
      description:
        "If answered: the rep's verbatim answer (may be a deferral/commitment). If NOT answered: a short note describing what the rep did instead — NOT text that reads like an answer.",
    },
  },
  required: ["summary", "quote", "speaker_name", "rep_answered", "rep_answer_or_deflection"],
} as const;

const ANALYSIS_TOOL: Anthropic.Tool = {
  name: "report_findings",
  description:
    "Report meaningful per-product discussions and product-team-actionable customer signals. Always call this exactly once.",
  input_schema: {
    type: "object",
    properties: {
      account: {
        type: "string",
        description: 'Call-level external company, e.g. "Booking.com". Call title verbatim if unknown.',
      },
      product_findings: {
        type: "array",
        description:
          "One entry per Maki product MEANINGFULLY discussed (substantive pitch OR a customer question/objection). Omit products only named in passing.",
        items: {
          type: "object",
          properties: {
            product: {
              type: "string",
              enum: ["tomo", "mochi", "kumi", "shiro", "ken"],
            },
            meaningful: { type: "boolean" },
            reason_if_skipped: {
              type: "string",
              description: "If meaningful=false, one-sentence reason. Empty string otherwise.",
            },
            primary_pitcher: {
              type: "string",
              description: "Maki rep who pitches this product. Empty if meaningful=false.",
            },
            account: { type: "string", description: "Empty string if meaningful=false." },
            pitch_quote: {
              type: "string",
              description: "1–4 sentence verbatim pitch. Empty string if meaningful=false.",
            },
            questions: {
              type: "array",
              description: "Information-seeking questions the prospect/customer asks about THIS product. Empty array if none.",
              items: INTERACTION_ITEM_SCHEMA,
            },
            objections: {
              type: "array",
              description: "Pushback / doubts / concerns about THIS product. Empty array if none.",
              items: INTERACTION_ITEM_SCHEMA,
            },
            transcript_incomplete: { type: "boolean" },
          },
          required: [
            "product",
            "meaningful",
            "reason_if_skipped",
            "primary_pitcher",
            "account",
            "pitch_quote",
            "questions",
            "objections",
            "transcript_incomplete",
          ],
        },
      },
      customer_signals: {
        type: "array",
        description:
          "Product-team-actionable signals voiced by prospects/customers. Apply the STRICT BAR — drop procurement/contractual/vague-satisfaction/process talk. Deduplicate. Empty array if none.",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["feature_request", "gap", "sentiment", "competitor"],
            },
            product: {
              type: "string",
              enum: ["tomo", "mochi", "kumi", "shiro", "ken", "general"],
              description: "Agent this concerns, or 'general' if platform-wide/unclear.",
            },
            speaker_name: { type: "string" },
            speaker_side: {
              type: "string",
              enum: ["prospect", "customer", "internal"],
            },
            account: { type: "string" },
            summary: {
              type: "string",
              description:
                "Self-contained statement of the need/gap/request/sentiment, understandable by a PM who wasn't on the call. Primary content.",
            },
            quote: {
              type: "string",
              description: "Short verbatim excerpt justifying the summary. '[paraphrase]' if unclear.",
            },
          },
          required: ["type", "product", "speaker_name", "speaker_side", "account", "summary", "quote"],
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

Apply the rules and call report_findings exactly once.`;

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
  // Forced tool use doesn't strictly validate types — the model can still
  // return a non-array where the schema says array. Coerce defensively so a
  // single malformed field can't crash the whole call.
  const input = toolUse.input as Record<string, unknown>;
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    account:
      typeof input.account === "string" && input.account ? input.account : call.title,
    product_findings: arr<ProductFinding>(input.product_findings).map((f) => ({
      ...f,
      questions: arr<InteractionEntry>(f?.questions),
      objections: arr<InteractionEntry>(f?.objections),
    })),
    customer_signals: arr<CustomerSignal>(input.customer_signals),
  };
}
