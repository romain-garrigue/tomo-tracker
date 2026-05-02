import { analyze } from "./claude.ts";
import {
  flattenTranscript,
  getCallSummary,
  getTranscript,
  listCalls,
  type GongCall,
} from "./gong.ts";
import { hasTomoSignal, renderMessage } from "./render.ts";
import { sendSlackMessage } from "./slack.ts";
import { readState, writeState } from "./state.ts";

const OVERLAP_HOURS = 1;

function log(msg: string, meta?: Record<string, unknown>): void {
  const stamp = new Date().toISOString();
  if (meta) console.log(`[${stamp}] ${msg}`, JSON.stringify(meta));
  else console.log(`[${stamp}] ${msg}`);
}

async function processCall(call: GongCall): Promise<{
  processed: boolean;
  alerted: boolean;
  reason?: string;
}> {
  log("call.fetch_transcript", { id: call.id, title: call.title });
  const { monologues } = await getTranscript(call.id);
  const transcript = flattenTranscript(monologues);

  if (!transcript || transcript.length < 50) {
    log("call.transcript_unavailable", { id: call.id });
    return { processed: true, alerted: false, reason: "no transcript" };
  }

  if (!hasTomoSignal(transcript)) {
    return { processed: true, alerted: false, reason: "no tomo signal" };
  }

  const summary = await getCallSummary(call.id);
  log("call.analyze", { id: call.id });
  const result = await analyze(call, transcript, summary);

  if (!result.meaningful) {
    log("call.skip_not_meaningful", {
      id: call.id,
      reason: result.reason_if_skipped,
    });
    return { processed: true, alerted: false, reason: result.reason_if_skipped };
  }

  const message = renderMessage(call, result);
  await sendSlackMessage(message);
  log("call.alerted", { id: call.id });
  return { processed: true, alerted: true };
}

async function main(): Promise<void> {
  const state = await readState();
  log("run.start", {
    lastRunAt: state.lastRunAt,
    processedCount: state.processedCallIds.length,
  });

  const fromDate = new Date(
    new Date(state.lastRunAt).getTime() - OVERLAP_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const toDate = new Date().toISOString();

  const allCalls = await listCalls(fromDate, toDate);
  const processed = new Set(state.processedCallIds);
  const newCalls = allCalls.filter((c) => !processed.has(c.id));

  log("run.calls_listed", {
    total: allCalls.length,
    new: newCalls.length,
  });

  if (newCalls.length === 0) {
    log("run.no_new_calls");
    return;
  }

  const newlyProcessed: string[] = [];
  let alertCount = 0;
  let failureCount = 0;

  for (const call of newCalls) {
    try {
      const r = await processCall(call);
      if (r.processed) newlyProcessed.push(call.id);
      if (r.alerted) alertCount++;
    } catch (err) {
      failureCount++;
      const message = err instanceof Error ? err.message : String(err);
      log("call.error", { id: call.id, error: message });
    }
  }

  const updatedState = {
    lastRunAt: newlyProcessed.length > 0 ? toDate : state.lastRunAt,
    processedCallIds: [...state.processedCallIds, ...newlyProcessed],
  };
  await writeState(updatedState);

  log("run.complete", {
    analyzed: newlyProcessed.length,
    alerted: alertCount,
    failed: failureCount,
  });
}

main().catch((err) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(`[fatal] ${message}`);
  process.exit(1);
});
