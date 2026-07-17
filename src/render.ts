import type {
  CustomerSignal,
  InteractionEntry,
  ProductFinding,
  SignalType,
} from "./claude.ts";
import type { Tracker } from "./config.ts";
import type { GongCall } from "./gong.ts";

function formatLongDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

// Collapse newlines/extra whitespace so a quote stays on one Slack line.
function oneLine(text: string): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function titleCase(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// Summary-first, like the signal bullets: the point in plain language, the
// quote as evidence, then how the rep handled it (answer vs. genuine non-answer).
function renderInteraction(e: InteractionEntry): string[] {
  const out = [`• ${oneLine(e.summary)} — ${e.speaker_name}`];
  if (e.quote) out.push(`> "${oneLine(e.quote)}"`);
  const handling = oneLine(e.rep_answer_or_deflection);
  if (e.rep_answered) {
    out.push(`→ Rep: ${handling ? `"${handling}"` : "answered"}`);
  } else {
    out.push(`→ :warning: No clear answer${handling ? ` — ${handling}` : ""}`);
  }
  return out;
}

// A summary-first signal bullet: the need in plain language, the quote as evidence.
function renderSignalBullet(s: CustomerSignal, withTag: boolean): string[] {
  const tag = withTag && s.product && s.product !== "general" ? ` _[${titleCase(s.product)}]_` : "";
  const out = [`• ${oneLine(s.summary)} — ${s.speaker_name}${tag}`];
  if (s.quote) out.push(`> "${oneLine(s.quote)}"`);
  return out;
}

// Per-product alert. `signals` are the customer_signals already scoped to this
// product (external side) — they feed the "Requests & gaps" and "Competitors"
// sections so the agent channel shows product-actionable asks, not just the pitch.
export function renderProductMessage(
  tracker: Tracker,
  call: GongCall,
  finding: ProductFinding,
  signals: CustomerSignal[],
): string {
  const account = finding.account || call.title;
  const hasPitch = oneLine(finding.pitch_quote).length > 0;
  const lines: string[] = [];

  // "pitched — {rep} with {account}" for a real pitch; "discussed — {account}"
  // when the product only came up via a question/objection (no manufactured pitch).
  const verb = hasPitch ? "pitched" : "discussed";
  const who = hasPitch && finding.primary_pitcher ? `${finding.primary_pitcher} with ` : "";
  lines.push(`${tracker.emoji} *${tracker.label} ${verb} — ${who}<${call.url}|${account}>*`);
  lines.push(`:date: ${formatLongDate(call.started)}`);
  lines.push(`:link: <${call.url}|Open in Gong>`);

  if (hasPitch) {
    lines.push("");
    lines.push(`*${tracker.label} pitched:*`);
    lines.push(`> "${oneLine(finding.pitch_quote)}"`);
    if (finding.primary_pitcher) lines.push(`> — ${finding.primary_pitcher}`);
  }

  const questions = finding.questions ?? [];
  if (questions.length) {
    lines.push("");
    lines.push(`*Questions*`);
    for (const q of questions) lines.push(...renderInteraction(q));
  }

  const objections = finding.objections ?? [];
  if (objections.length) {
    lines.push("");
    lines.push(`*Objections / concerns*`);
    for (const o of objections) lines.push(...renderInteraction(o));
  }

  const reqGaps = signals.filter((s) => s.type === "feature_request" || s.type === "gap");
  if (reqGaps.length) {
    lines.push("");
    lines.push(`*Requests & gaps (${tracker.label})*`);
    for (const s of reqGaps) lines.push(...renderSignalBullet(s, false));
  }

  const competitors = signals.filter((s) => s.type === "competitor");
  if (competitors.length) {
    lines.push("");
    lines.push(`*Competitors*`);
    for (const s of competitors) lines.push(...renderSignalBullet(s, false));
  }

  if (finding.transcript_incomplete) {
    lines.push("");
    lines.push(`:warning: _Transcript incomplete — pitch and follow-ups may be partial._`);
  }
  return lines.join("\n");
}

// #product-signals: one grouped message per call, a section per signal type,
// each bullet leading with a self-contained summary and the quote as evidence.
const SIGNAL_SECTIONS: Array<[SignalType, string]> = [
  ["feature_request", "Feature requests"],
  ["gap", "Gaps"],
  ["competitor", "Competitors"],
  ["sentiment", "Sentiment"],
];

export function renderSignalsMessage(
  call: GongCall,
  signals: CustomerSignal[],
  account: string,
): string {
  const lines: string[] = [];
  lines.push(
    `:bulb: *Product signal — <${call.url}|${account || call.title}>*  · ${formatLongDate(call.started)}`,
  );
  for (const [type, header] of SIGNAL_SECTIONS) {
    const group = signals.filter((s) => s.type === type);
    if (!group.length) continue;
    lines.push("");
    lines.push(`*${header}*`);
    for (const s of group) lines.push(...renderSignalBullet(s, true));
  }
  lines.push("");
  lines.push(`:link: <${call.url}|Open in Gong>`);
  return lines.join("\n");
}
