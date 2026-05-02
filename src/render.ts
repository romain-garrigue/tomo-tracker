import type { AnalysisResult } from "./claude.ts";
import type { GongCall } from "./gong.ts";

const TOMO_SIGNAL_PATTERN =
  /\btomo\b|interview recording|interview intelligence|interview companion|interview notes|ai interview summary/i;

export function hasTomoSignal(transcript: string): boolean {
  return TOMO_SIGNAL_PATTERN.test(transcript);
}

function formatLongDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function renderMessage(call: GongCall, r: AnalysisResult): string {
  const lines: string[] = [];
  const account = r.account || call.title;
  const dateLong = formatLongDate(call.started);

  lines.push(
    `:studio_microphone: *Tomo mentioned — ${r.primary_pitcher} with <${call.url}|${account}>*`,
  );
  lines.push(`:date: ${dateLong}`);
  lines.push(`:link: <${call.url}|Open in Gong>`);
  lines.push("");
  lines.push(`*Tomo pitched:* \`${r.pitch_timestamp}\``);
  lines.push(`> "${r.pitch_quote}"`);
  lines.push(`> — ${r.primary_pitcher}`);
  lines.push("");

  const objections = r.objections ?? [];
  if (objections.length === 0) {
    lines.push(`*Objections / Questions:* none`);
  } else {
    lines.push(`*Objections / Questions:*`);
    for (const o of objections) {
      const head = `• \`${o.ts}\` — "${o.question_quote}" (${o.questioner_name})`;
      if (o.rep_answered) {
        lines.push(`${head} → Rep: "${o.rep_answer_or_deflection}"`);
      } else {
        lines.push(
          `${head} → :warning: Rep did not answer / unclear answer — ${o.rep_answer_or_deflection}`,
        );
      }
    }
  }

  if (r.transcript_incomplete) {
    lines.push("");
    lines.push(
      `:warning: _Transcript incomplete — pitch and objections may be partial._`,
    );
  }
  return lines.join("\n");
}
