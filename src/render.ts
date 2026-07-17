import type { Signal, SignalType } from "./claude.ts";
import { config } from "./config.ts";
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

// Sub-categories inside each agent paragraph. question + request_gap merge.
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

// One consolidated message per call: a paragraph per agent that has signals
// (each grouped into sub-categories), then a "New product opportunities" block
// for net-new (non-agent) needs.
export function renderCallSignals(
  call: GongCall,
  account: string,
  signals: Signal[],
): string {
  const lines: string[] = [
    `:bulb: *Product signals — ${account || call.title}*  · ${formatLongDate(call.started)}`,
    `:link: <${call.url}|Open in Gong>`,
  ];

  for (const agent of config.slack.agents) {
    const group = signals.filter((s) => s.product === agent.key);
    if (!group.length) continue;
    lines.push("");
    lines.push(`${agent.emoji} *${agent.label}*`);
    lines.push(...renderSubsections(group));
  }

  const netNew = signals.filter((s) => s.product === "new_product");
  if (netNew.length) {
    lines.push("");
    lines.push(`:seedling: *New product opportunities*`);
    lines.push(...renderSubsections(netNew));
  }

  return lines.join("\n");
}
