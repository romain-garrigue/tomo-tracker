import Anthropic from "@anthropic-ai/sdk";
import { config, type ProductKey } from "./config.ts";
import type { CallSummary, GongCall } from "./gong.ts";

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

// Which product a signal concerns; "general" = platform-wide / cross-agent /
// a capability Maki has no product for (sourcing, exports, ATS integration…).
export type SignalProduct = ProductKey | "general";

// question + request_gap render together ("Questions / requests & gaps");
// objection and competitor are their own sections.
export type SignalType = "question" | "request_gap" | "objection" | "competitor";
export type SpeakerSide = "prospect" | "customer" | "internal";

export interface Signal {
  product: SignalProduct;
  type: SignalType;
  speaker_name: string;
  speaker_side: SpeakerSide;
  account: string;
  // Self-contained statement a PM who wasn't on the call can act on.
  summary: string;
  // Short verbatim excerpt that justifies the summary.
  quote: string;
  // For question/objection only: how the rep handled it.
  rep_addressed: boolean;
  rep_response: string;
}

export interface AnalysisResult {
  account: string;
  signals: Signal[];
}

const SYSTEM_PROMPT = `You analyze Gong sales/CSM call transcripts for Maki People, which sells five AI hiring agents (Shiro, Mochi, Ken, Kumi, Tomo). Via the report_findings tool (call it exactly once) you extract PRODUCT SIGNALS: everything a PROSPECT/CUSTOMER says that carries information about Maki's product — their questions, feature requests, gaps, objections/concerns, and competing tools.

You do NOT summarize the sales pitch. A rep pitching an agent is NOT a signal — only the customer's reactions, questions, and needs are. A call where an agent is pitched but the customer says nothing about it produces NO signal for that agent.

# The five Maki products (for attributing each signal + disambiguation)
- **tomo** — "Interview Co-pilot": joins live interviews, records/transcribes, generates interview plans + summaries + evaluation of the interviewer. Aliases: Tomo, interview co-pilot/assist/companion, interview notetaker/recorder. (Contrast set: Otter/Granola/Fathom.)
- **mochi** — "Voice Screening": adaptive AI voice interviewer (web/phone) replacing the recruiter phone screen. Aliases: Mochi, voice screening, voice/phone screen, voice agent.
- **kumi** — "Scheduling / Orchestration": calendar coordination, self-serve (re)scheduling, confirmations. Aliases: Kumi, scheduling, orchestration.
- **shiro** — "Skills Screening": short structured online assessments replacing CV screening. Aliases: Shiro, skills screening/assessment, structured assessment.
- **ken** — "Deep Assessment": in-depth assessment (coding, case study, system design, Compass personality). Aliases: Ken (THE PRODUCT ONLY — never a person named Ken), deep/in-depth assessment, case study, coding test.
Disambiguation: "Ken" as a person (a speaker/colleague) is NOT the product. Bare "screening"/"assessment" → shiro (structured online test) vs mochi (voice conversation) only on modality cues; if unclear, use "general".

# Signal types
- question — a product question that reveals a need, an evaluation criterion, or a capability the customer cares about. Examples worth capturing: "can Mochi evaluate candidates already in our pipeline, not just new applicants?"; "can Mochi place calls through our Teams VoIP?"; "can we split role-specific assessments so juniors only take the junior test?". NOT worth capturing: curiosity or pitch-clarification questions with no product implication — e.g. "is it the same technology behind Shiro and Mochi?", "is the conversational agent basically a bot?".
- request_gap — a feature request OR a gap/limitation in the product the customer needs. Requests and gaps are the SAME category. Examples: "the junior assessment is too long (100+ questions, ~1h30) — need it around 45 min"; "integrate Mochi with Microsoft Teams"; "let WhatsApp go out under our brand, not Mochi's"; "the data export doesn't include expert assessments".
- objection — a doubt, concern, risk, or pushback about the product. Example: "a voice AI agent may destabilize our older, experienced candidates and hurt our employer brand."
- competitor — a competing PRODUCT the customer uses or evaluates (seeds: scheduling → GoodTime/ModernLoop/Paradox; deep assessment → SHL/HackerRank; interview recording → Otter/Granola/Fathom/Gong). CRITICAL: ATS platforms (iCIMS, Cegid/Talentsoft, SmartRecruiters, Avature, Workday, SuccessFactors, Greenhouse, Lever, …) are NOT competitors — they are integration targets. NEVER emit an ATS as a competitor.

# Attribute each signal to a product
Set product to the agent it concerns (tomo/mochi/kumi/shiro/ken) when specific to one agent; otherwise "general" (platform-wide, cross-agent, or a capability Maki has no product for — e.g. sourcing, data exports, ATS integration).

# HARD EXCLUDE — never emit as a signal (even if deal-critical)
- Anything not about the PRODUCT's own capabilities: sales-process & deal mechanics (benchmarks/market insights for the business case, business-case framing, pricing segmentation, ROI-argument framing, which materials to show which stakeholders, the language of GTM materials e.g. "run the workshop in Spanish"); pricing/commercial/contractual terms; positioning/messaging suggestions (e.g. "position Mochi as time-to-hire reduction").
- Client-reference / social-proof requests (e.g. "do you have references in engineering — EDF, Technip?"). That is sales, and a client-fit gap is NOT a product gap.
- A need ALREADY MET by an existing Maki capability — INCLUDING when the rep confirms it is feasible/handled. E.g. "we want recruiters to stay in our ATS" when Maki already pushes results back and the rep confirms it → NOT a signal. "We manually read every resume" (Shiro already does this) → NOT a signal.
- ATS integration when the rep confirms it works / is no problem. Emit an ATS-integration signal ONLY when it is genuinely uncertain or flagged as a risk/open question (type question or request_gap, product "general").
- The customer's OWN operational metrics or pain not tied to a product-capability gap (e.g. "only 35% of our applicants get a response", applicant volumes).
- Curiosity / pitch-clarification questions with no product implication.
- Procurement / vendor-selection / tech-stack talk. Vague satisfaction scores.

Litmus test: could a PM open a build / fix / competitive-defense ticket from this? If not, DROP it. When unsure, DROP it. Fewer, sharper signals are far better than many weak ones.

# For each signal
- summary — a SELF-CONTAINED sentence understandable by a PM who was not on the call. This is the primary content.
- quote — a short verbatim excerpt that justifies the summary ("[paraphrase]" only if truly unclear).
- speaker_name — the speaker's clean personal name (strip transcript artifacts such as a leading "Cc"/"cc").
- speaker_side — prospect/customer; use "internal" ONLY when a Maki person relays a customer's point.
- account, product, type.
- rep_addressed + rep_response — for type question or objection ONLY. rep_addressed=true if the rep answered substantively OR committed to follow up ("I'll check and get back to you" = true). rep_response = the rep's verbatim answer/commitment, or if NOT addressed a short note of what the rep did instead. For request_gap and competitor: rep_addressed=false and rep_response empty.

# account + global rules
- account: the external company (from title, summary, or external participants); call title verbatim if unknown.
- Facts only. NEVER fabricate quotes.
- Deduplicate: one signal per distinct idea; never emit the same quote under two types. If a statement is both a competitor mention and a request, pick the primary product intent and note the other inside the summary.`;

const SIGNAL_ITEM_SCHEMA = {
  type: "object",
  properties: {
    product: {
      type: "string",
      enum: ["tomo", "mochi", "kumi", "shiro", "ken", "general"],
      description: "Agent the signal concerns, or 'general' if platform-wide/cross-agent/no product.",
    },
    type: {
      type: "string",
      enum: ["question", "request_gap", "objection", "competitor"],
    },
    speaker_name: {
      type: "string",
      description: "Speaker's clean personal name (strip artifacts like a leading 'Cc').",
    },
    speaker_side: { type: "string", enum: ["prospect", "customer", "internal"] },
    account: { type: "string" },
    summary: {
      type: "string",
      description: "Self-contained sentence a PM who wasn't on the call can act on. Primary content.",
    },
    quote: {
      type: "string",
      description: "Short verbatim excerpt justifying the summary. '[paraphrase]' if unclear.",
    },
    rep_addressed: {
      type: "boolean",
      description:
        "question/objection only: true if the rep answered substantively OR committed to follow up. false for request_gap/competitor.",
    },
    rep_response: {
      type: "string",
      description:
        "question/objection only: rep's verbatim answer/commitment, or a short note of what they did instead if unaddressed. Empty for request_gap/competitor.",
    },
  },
  required: [
    "product",
    "type",
    "speaker_name",
    "speaker_side",
    "account",
    "summary",
    "quote",
    "rep_addressed",
    "rep_response",
  ],
} as const;

const ANALYSIS_TOOL: Anthropic.Tool = {
  name: "report_findings",
  description:
    "Report product signals voiced by prospects/customers (questions, requests/gaps, objections, competitors). A rep's pitch is NOT a signal. Always call this exactly once.",
  input_schema: {
    type: "object",
    properties: {
      account: {
        type: "string",
        description: 'Call-level external company, e.g. "Booking.com". Call title verbatim if unknown.',
      },
      signals: {
        type: "array",
        description:
          "Product signals from the prospect/customer. Apply the HARD-EXCLUDE list and the litmus test (could a PM open a ticket?). Deduplicate. Empty array if the customer raised nothing about the product.",
        items: SIGNAL_ITEM_SCHEMA,
      },
    },
    required: ["account", "signals"],
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

Extract the product signals and call report_findings exactly once.`;

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
  // Forced tool use doesn't strictly validate types — coerce defensively.
  const input = toolUse.input as Record<string, unknown>;
  return {
    account:
      typeof input.account === "string" && input.account ? input.account : call.title,
    signals: Array.isArray(input.signals) ? (input.signals as Signal[]) : [],
  };
}
