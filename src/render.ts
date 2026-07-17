import type { Pitch, Signal, SignalType } from "./claude.ts";
import type { Agent } from "./config.ts";
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

function oneLine(text: string): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

// Strip transcript artifacts like a leading "Cc " from speaker names.
function cleanName(name: string): string {
  return oneLine(name).replace(/^cc\s+/i, "");
}

// Sub-categories inside a message. question + request_gap merge into one.
const SUBSECTIONS: Array<{ header: string; types: SignalType[] }> = [
  { header: "Questions, requests & gaps", types: ["question", "request_gap"] },
  { header: "Objections / concerns", types: ["objection"] },
  { header: "Competitors", types: ["competitor"] },
];

// One idea per bullet: summary first, quote (with the speaker) beneath, then the
// rep's handling for questions/objections.
function renderBullet(s: Signal): string[] {
  const speaker = cleanName(s.speaker_name);
  const quote = oneLine(s.quote);
  const out: string[] = [];
  if (quote) {
    out.push(`• ${oneLine(s.summary)}`);
    out.push(`> "${quote}"${speaker ? ` — ${speaker}` : ""}`);
  } else {
    out.push(`• ${oneLine(s.summary)}${speaker ? ` — ${speaker}` : ""}`);
  }
  if (s.type === "question" || s.type === "objection") {
    const r = oneLine(s.rep_response);
    if (s.rep_addressed) {
      if (r) out.push(`→ Rep: "${r}"`);
    } else {
      out.push(`→ :warning: Unaddressed${r ? ` — ${r}` : ""}`);
    }
  }
  return out;
}

function renderSubsections(signals: Signal[]): string[] {
  const lines: string[] = [];
  for (const sub of SUBSECTIONS) {
    const group = signals.filter((s) => sub.types.includes(s.type));
    if (!group.length) continue;
    lines.push(`*${sub.header}*`);
    for (const s of group) lines.push(...renderBullet(s));
  }
  return lines;
}

// One message per agent that has signals, to that agent's channel. If the rep
// pitched the agent on this call, the pitch (quote + pitcher) leads for context.
export function renderAgentMessage(
  agent: Agent,
  call: GongCall,
  account: string,
  signals: Signal[],
  pitch?: Pitch,
): string {
  const lines = [
    `${agent.emoji} *${agent.label} — ${account || call.title}*  · ${formatLongDate(call.started)}`,
    `:link: <${call.url}|Open in Gong>`,
  ];
  if (pitch && oneLine(pitch.quote)) {
    lines.push("");
    lines.push(`*Pitched by ${cleanName(pitch.pitcher)}:*`);
    lines.push(`> "${oneLine(pitch.quote)}"`);
  }
  const subs = renderSubsections(signals);
  if (subs.length) {
    lines.push("");
    lines.push(...subs);
  }
  return lines.join("\n");
}

// The new-product channel: only net-new product requests (not existing-product
// features/integration). Low volume — not a message per call.
export function renderNewProductMessage(
  call: GongCall,
  account: string,
  signals: Signal[],
): string {
  const lines = [
    `:seedling: *New product signal — ${account || call.title}*  · ${formatLongDate(call.started)}`,
    `:link: <${call.url}|Open in Gong>`,
  ];
  const subs = renderSubsections(signals);
  if (subs.length) {
    lines.push("");
    lines.push(...subs);
  }
  return lines.join("\n");
}
