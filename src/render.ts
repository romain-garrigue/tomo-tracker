import type { Signal, SignalType } from "./claude.ts";
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

function oneLine(text: string): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

// Strip transcript artifacts like a leading "Cc " from speaker names.
function cleanName(name: string): string {
  return oneLine(name).replace(/^cc\s+/i, "");
}

// Sections, in display order. Questions and requests/gaps share one section.
const SECTIONS: Array<{ header: string; types: SignalType[] }> = [
  { header: "Questions / requests & gaps", types: ["question", "request_gap"] },
  { header: "Objections / concerns", types: ["objection"] },
  { header: "Competitors", types: ["competitor"] },
];

function renderSignalItem(s: Signal): string[] {
  const out = [`• ${oneLine(s.summary)} — ${cleanName(s.speaker_name)}`];
  if (s.quote) out.push(`> "${oneLine(s.quote)}"`);
  // Only questions/objections carry a rep response.
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

function renderSignalSections(signals: Signal[]): string[] {
  const lines: string[] = [];
  for (const sec of SECTIONS) {
    const group = signals.filter((s) => sec.types.includes(s.type));
    if (!group.length) continue;
    lines.push("");
    lines.push(`*${sec.header}*`);
    for (const s of group) lines.push(...renderSignalItem(s));
  }
  return lines;
}

// Per-agent alert: the product signals voiced about THIS agent. No pitch — an
// agent with no customer signals doesn't get a message (the caller checks).
export function renderAgentMessage(
  tracker: Tracker,
  call: GongCall,
  account: string,
  signals: Signal[],
): string {
  const lines: string[] = [
    `${tracker.emoji} *${tracker.label} — <${call.url}|${account || call.title}>*`,
    `:date: ${formatLongDate(call.started)}`,
    `:link: <${call.url}|Open in Gong>`,
  ];
  lines.push(...renderSignalSections(signals));
  return lines.join("\n");
}

// #product-signals: the general / platform-wide signals (not tied to one agent).
export function renderGeneralSignalsMessage(
  call: GongCall,
  account: string,
  signals: Signal[],
): string {
  const lines: string[] = [
    `:bulb: *Product signal — <${call.url}|${account || call.title}>*  · ${formatLongDate(call.started)}`,
  ];
  lines.push(...renderSignalSections(signals));
  lines.push("");
  lines.push(`:link: <${call.url}|Open in Gong>`);
  return lines.join("\n");
}
