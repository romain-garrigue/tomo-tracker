import { analyze } from "./claude.ts";
import { config } from "./config.ts";
import {
  flattenTranscript,
  getCallSummary,
  getTranscript,
  hasExternalParty,
  listCalls,
  type GongCall,
} from "./gong.ts";
import { renderAgentMessage, renderGeneralSignalsMessage } from "./render.ts";
import { sendSlackMessage } from "./slack.ts";
import {
  hasAlerted,
  markAlerted,
  readState,
  writeState,
  type State,
} from "./state.ts";

const OVERLAP_HOURS = 1;

function log(msg: string, meta?: Record<string, unknown>): void {
  const stamp = new Date().toISOString();
  if (meta) console.log(`[${stamp}] ${msg}`, JSON.stringify(meta));
  else console.log(`[${stamp}] ${msg}`);
}

interface CallOutcome {
  processed: boolean;
  alerts: number;
  failures: number;
  reason?: string;
}

// Analyze one call once, then fan out to every product channel + the signals
// feed. `state` is mutated in place (markAlerted) so idempotency survives even
// if a later send throws.
async function processCall(call: GongCall, state: State): Promise<CallOutcome> {
  log("call.fetch_transcript", { id: call.id, title: call.title });
  const { monologues } = await getTranscript(call.id);
  const transcript = flattenTranscript(monologues);

  if (!transcript || transcript.length < 50) {
    log("call.skip_no_transcript", { id: call.id });
    return { processed: true, alerts: 0, failures: 0, reason: "no transcript" };
  }

  if (!hasExternalParty(call)) {
    log("call.skip_internal_only", { id: call.id });
    return { processed: true, alerts: 0, failures: 0, reason: "internal-only" };
  }

  const summary = await getCallSummary(call.id);
  log("call.analyze", { id: call.id });
  const result = await analyze(call, transcript, summary);

  // Prospect/customer-voiced signals only; drop internal-relayed ones.
  const externalSignals = result.signals.filter((s) => s.speaker_side !== "internal");

  let alerts = 0;
  let failures = 0;

  // One message per agent that has ≥1 signal, to that agent's channel. No
  // signal about an agent → no message (a pitch alone is not worth an alert).
  for (const tracker of config.slack.trackers) {
    const agentSignals = externalSignals.filter((s) => s.product === tracker.key);
    if (agentSignals.length === 0) continue;
    if (hasAlerted(state, call.id, tracker.key)) continue;
    if (!tracker.channelId) {
      log("call.channel_not_configured", { id: call.id, tracker: tracker.key });
      failures++;
      continue;
    }
    try {
      await sendSlackMessage(
        tracker.channelId,
        renderAgentMessage(tracker, call, result.account, agentSignals),
      );
      markAlerted(state, call.id, tracker.key);
      alerts++;
      log("call.alerted_product", { id: call.id, product: tracker.key });
    } catch (err) {
      failures++;
      log("call.alert_error", {
        id: call.id,
        product: tracker.key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // General / platform-wide signals (not tied to one agent) → #product-signals.
  const generalSignals = externalSignals.filter((s) => s.product === "general");
  if (generalSignals.length > 0 && !hasAlerted(state, call.id, "product-signals")) {
    const channelId = config.slack.productSignalsChannel;
    if (!channelId) {
      log("call.channel_not_configured", { id: call.id, tracker: "product-signals" });
      failures++;
    } else {
      try {
        await sendSlackMessage(
          channelId,
          renderGeneralSignalsMessage(call, result.account, generalSignals),
        );
        markAlerted(state, call.id, "product-signals");
        alerts++;
        log("call.alerted_signals", { id: call.id, count: generalSignals.length });
      } catch (err) {
        failures++;
        log("call.alert_error", {
          id: call.id,
          tracker: "product-signals",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return { processed: true, alerts, failures };
}

async function main(): Promise<void> {
  const state = await readState();
  log("run.start", {
    lastRunAt: state.lastRunAt,
    processedCount: state.processedCallIds.length,
    sentAlertsCount: state.sentAlerts.length,
  });

  const fromDate = new Date(
    new Date(state.lastRunAt).getTime() - OVERLAP_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const toDate = new Date().toISOString();

  const allCalls = await listCalls(fromDate, toDate);
  const processed = new Set(state.processedCallIds);
  const newCalls = allCalls.filter((c) => !processed.has(c.id));

  log("run.calls_listed", { total: allCalls.length, new: newCalls.length });

  if (newCalls.length === 0) {
    log("run.no_new_calls");
    return;
  }

  let processedThisRun = 0;
  let alertCount = 0;
  let failureCount = 0;

  for (const call of newCalls) {
    try {
      const r = await processCall(call, state);
      alertCount += r.alerts;
      failureCount += r.failures;
      // Mark done only when every send succeeded — a failed send (e.g. bot not
      // in a channel yet) leaves the call for retry, while sentAlerts stops the
      // sends that DID land from re-posting.
      if (r.processed && r.failures === 0) {
        state.processedCallIds.push(call.id);
        processedThisRun++;
      }
    } catch (err) {
      failureCount++;
      log("call.error", {
        id: call.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    // Flush after every call so a timeout/crash mid-backfill keeps progress
    // (the workflow's commit step runs with if: always()).
    await writeState(state);
  }

  // Advance the window only if the whole batch went through cleanly; otherwise
  // keep lastRunAt so unfinished/failed calls stay in range next run.
  if (failureCount === 0) {
    state.lastRunAt = toDate;
    await writeState(state);
  }

  log("run.complete", {
    analyzed: newCalls.length,
    fullyProcessed: processedThisRun,
    alerted: alertCount,
    failed: failureCount,
  });
}

main().catch((err) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(`[fatal] ${message}`);
  process.exit(1);
});
