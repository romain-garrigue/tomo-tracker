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

// Short tag so mixed bullets stay scannable within one agent paragraph.
const TYPE_TAG: Record<SignalType, string> = {
  question: "question",
  request_gap: "request",
  objection: "objection",
  competitor: "competitor",
};

function renderSignalBullet(s: Signal): string[] {
  const out = [`• _[${TYPE_TAG[s.type]}]_ ${oneLine(s.summary)} — ${cleanName(s.speaker_name)}`];
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

// One consolidated message per call: a paragraph per agent that has signals,
// then a "New product opportunities" section for net-new (non-agent) needs.
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
    for (const s of group) lines.push(...renderSignalBullet(s));
  }

  const netNew = signals.filter((s) => s.product === "new_product");
  if (netNew.length) {
    lines.push("");
    lines.push(`:seedling: *New product opportunities*`);
    for (const s of netNew) lines.push(...renderSignalBullet(s));
  }

  return lines.join("\n");
}
