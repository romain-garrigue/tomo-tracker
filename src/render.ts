import type { CustomerSignal, ProductFinding, SignalType } from "./claude.ts";
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
  return text.replace(/\s+/g, " ").trim();
}

// A per-product alert. Same layout as the original Tomo message, parameterized
// by tracker (emoji + label) so every product reads consistently. Shiro and Ken
// share a channel but each carries its own label here.
export function renderProductMessage(
  tracker: Tracker,
  call: GongCall,
  finding: ProductFinding,
): string {
  const lines: string[] = [];
  const account = finding.account || call.title;
  const dateLong = formatLongDate(call.started);

  lines.push(
    `${tracker.emoji} *${tracker.label} mentioned — ${finding.primary_pitcher} with <${call.url}|${account}>*`,
  );
  lines.push(`:date: ${dateLong}`);
  lines.push(`:link: <${call.url}|Open in Gong>`);
  lines.push("");
  lines.push(`*${tracker.label} pitched:* \`${finding.pitch_timestamp}\``);
  lines.push(`> "${oneLine(finding.pitch_quote)}"`);
  lines.push(`> — ${finding.primary_pitcher}`);
  lines.push("");

  const objections = finding.objections ?? [];
  if (objections.length === 0) {
    lines.push(`*Objections / Questions:* none`);
  } else {
    lines.push(`*Objections / Questions:*`);
    for (const o of objections) {
      const head = `• \`${o.ts}\` — "${oneLine(o.question_quote)}" (${o.questioner_name})`;
      if (o.rep_answered) {
        lines.push(`${head} → Rep: "${oneLine(o.rep_answer_or_deflection)}"`);
      } else {
        lines.push(
          `${head} → :warning: Rep did not answer / unclear answer — ${oneLine(o.rep_answer_or_deflection)}`,
        );
      }
    }
  }

  if (finding.transcript_incomplete) {
    lines.push("");
    lines.push(
      `:warning: _Transcript incomplete — pitch and objections may be partial._`,
    );
  }
  return lines.join("\n");
}

const SIGNAL_LABELS: Record<SignalType, string> = {
  feature_request: "feature request",
  gap: "gap",
  sentiment: "sentiment",
  competitor: "competitor",
};

function renderSignalLine(s: CustomerSignal): string {
  const label = SIGNAL_LABELS[s.type] ?? s.type;
  const ts = s.timestamp ? `\`${s.timestamp}\` ` : "";
  const quote = oneLine(s.quote);
  const body = quote ? `"${quote}"` : oneLine(s.summary);
  const speaker = s.speaker_name ? ` — ${s.speaker_name}` : "";
  const area = s.product_area ? ` · _${s.product_area}_` : "";
  return `• [${label}] ${ts}${body}${speaker}${area}`;
}

// One grouped message per call carrying all prospect/customer product signals.
export function renderSignalsMessage(
  call: GongCall,
  signals: CustomerSignal[],
  account: string,
): string {
  const dateLong = formatLongDate(call.started);
  const lines: string[] = [];
  lines.push(
    `:bulb: *Product signal — <${call.url}|${account || call.title}>*  · ${dateLong}`,
  );
  for (const s of signals) {
    lines.push(renderSignalLine(s));
  }
  lines.push(`:link: <${call.url}|Open in Gong>`);
  return lines.join("\n");
}
