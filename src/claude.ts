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

Create an entry for a product ONLY when at least ONE of these is true:
1. REAL PITCH — a Maki rep actively describes what the product DOES, how it works, or the value it delivers, in a substantive way (a genuine explanation or demo, typically several sentences).
2. PRODUCT-SPECIFIC ENGAGEMENT — the prospect/customer asks a question, raises an objection, or discusses THIS product specifically, beyond the rep merely naming it.

A "real pitch" is NOT any of the following, and these DO NOT qualify a product on their own:
- a recap of what the call covered — e.g. "the majority of everything we spoke about was skills screening, phone screening…";
- a passing name-drop — e.g. "we also have an agent called Mochi", "we have other agents for scheduling";
- a pricing / cost / packaging discussion that names the product — e.g. "Shiro is 5,000 assessments at €1.75… Mochi costs more because of the telephony" — quoting costs or packaging is NOT explaining what the product does;
- listing the product among others without explaining it.

If a product is only named, listed, or recapped — with no real pitch AND no product-specific question/objection — DO NOT create a finding for it (omit it entirely). It is normal for a call to feature only one or two products meaningfully even if all five are named.

Only create entries that clear the bar above; set meaningful=true on each. For each:
- pitch_quote — the verbatim core of the pitch. Fill ONLY if condition 1 holds. If the product qualifies only via condition 2 (a question/objection, no real pitch), leave pitch_quote EMPTY — NEVER manufacture a pitch from a recap or name-drop.
- primary_pitcher — the Maki rep who delivers the pitch; EMPTY if there was no real pitch.
- account.
- questions[] / objections[] — SUBSTANTIVE questions/objections SPECIFICALLY ABOUT THIS product that reveal a real evaluation criterion, concern, doubt, or product limitation (its capabilities, fit, results). A general question about the platform, the funnel, sourcing, or a DIFFERENT capability does NOT belong here — route it to customer_signals instead. Skip trivial logistics/clarifications. Never let a non-product-specific question be the sole reason a product qualifies.
  Each entry (both arrays) has:
  - summary — a SELF-CONTAINED sentence stating what is being asked/objected, understandable without the transcript. Primary content.
  - quote — a verbatim excerpt that justifies the summary ("[paraphrase]" only if truly unclear).
  - speaker_name.
  - rep_answered — TRUE if the rep responds substantively OR commits to follow up (e.g. "I'll check and get back to you", "let me confirm and revert" counts as answered=true — it is a legitimate deferred answer). FALSE only if the rep ignores it, changes the subject, or gives a genuine non-response.
  - rep_answer_or_deflection — if answered: the rep's verbatim answer (which may be a deferral/commitment). If NOT answered: a SHORT note describing what the rep did instead (e.g. "moved on to pricing without addressing it") — do NOT put text that reads like an answer.
  Empty arrays if none.
- transcript_incomplete: true if the transcript looks truncated.

# Part 2 — customer_signals

A customer_signal is STRICTLY about Maki's PRODUCT — the capabilities of its hiring agents (Shiro, Mochi, Ken, Kumi, Tomo) and platform (exports, integrations, data, consent controls, candidate/recruiter experience). It answers ONE question: "what should we BUILD, FIX, or CHANGE in the PRODUCT?" If a statement is not about the product's own capabilities, it is NOT a signal — no matter how important it is to the deal.

Types:
- feature_request — the customer asks for a PRODUCT capability that doesn't exist yet ("can Mochi do X?", "I wish Shiro could Y").
- gap — a concrete limitation or missing capability IN THE PRODUCT the customer hits ("the data export doesn't include expert assessments", "no playback-speed control on video responses", "you have no sourcing / top-of-funnel product").
- competitor — a competing PRODUCT the customer uses or evaluates (seeds: scheduling → GoodTime/ModernLoop/Paradox; deep assessment → SHL/HackerRank; interview recording → Otter/Granola/Fathom/Gong).
- sentiment — satisfaction/dissatisfaction about how the PRODUCT actually works, tied to a specific product cause.

HARD EXCLUDE — these are NEVER product signals, even when they matter to the deal:
- Sales-process & deal mechanics: asking for benchmarks / market insights to support a business case; how to frame or structure the business case; how to segment or present pricing; ROI-argument framing; which materials to show which stakeholders; the language of GTM materials (e.g. "can we run the workshop in Spanish?").
- Pricing / commercial / contractual terms (cost per assessment, packaging, discounts, data-usage clauses, SLAs).
- Positioning / messaging / usage suggestions (e.g. "position Mochi as time-to-hire reduction") — that is messaging, not a product feature.
- The customer's OWN operational metrics or pain that isn't a product-capability gap (e.g. "only 35% of our applicants get a response", applicant volumes, "our recruiters manually read every resume" — already solved by existing agents). Capture such a pain ONLY when it points to a capability Maki genuinely LACKS (e.g. sourcing for low-volume roles).
- Procurement / vendor-selection / tech-stack consolidation.
- Vague satisfaction scores with no specific product cause (e.g. "candidate sat 7.6, expected more").
- Sales-enablement tooling asks (e.g. "a built-in ROI calculator") — not part of the hiring product.

Litmus test: could a product manager open a ticket to build or fix something in the agents or platform from this? If not, DROP it. When unsure, DROP it — fewer, sharper signals are far better than many weak ones.

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
            meaningful: {
              type: "boolean",
              description:
                "Always true for an emitted finding. Only emit a product that has a REAL pitch OR a product-specific question/objection.",
            },
            reason_if_skipped: {
              type: "string",
              description: "Leave as empty string (products that don't qualify are omitted entirely).",
            },
            primary_pitcher: {
              type: "string",
              description:
                "Maki rep who delivers the pitch. EMPTY string if there was no real pitch (product qualifies only via a question/objection).",
            },
            account: { type: "string" },
            pitch_quote: {
              type: "string",
              description:
                "Verbatim core of the pitch (1–4 sentences). EMPTY string if there was no real pitch — never manufacture one from a call recap or a name-drop.",
            },
            questions: {
              type: "array",
              description:
                "Questions SPECIFICALLY about THIS product. Route general/platform/other-capability questions to customer_signals, not here. Empty array if none.",
              items: INTERACTION_ITEM_SCHEMA,
            },
            objections: {
              type: "array",
              description: "Objections / doubts / concerns SPECIFICALLY about THIS product. Empty array if none.",
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
          "Signals STRICTLY about Maki's PRODUCT (what to build/fix/change in the agents or platform). HARD-EXCLUDE sales-process, pricing/commercial, positioning/messaging, the customer's own operational metrics, and GTM logistics — even when deal-critical. Litmus: could a PM open a build/fix ticket from it? Deduplicate. Empty array if none.",
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
