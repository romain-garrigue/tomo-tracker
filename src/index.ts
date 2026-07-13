import { analyze } from "./claude.ts";
import { config, type ProductKey, type Tracker } from "./config.ts";
import {
  flattenTranscript,
  getCallSummary,
  getTranscript,
  hasExternalParty,
  listCalls,
  type GongCall,
} from "./gong.ts";
import { renderProductMessage, renderSignalsMessage } from "./render.ts";
import { sendSlackMessage } from "./slack.ts";
import {
  hasAlerted,
  markAlerted,
  readState,
  writeState,
  type State,
} from "./state.ts";

const OVERLAP_HOURS = 1;

const trackerByKey = new Map<ProductKey, Tracker>(
  config.slack.trackers.map((t) => [t.key, t]),
);

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

  let alerts = 0;
  let failures = 0;

  // Per-product fan-out.
  for (const finding of result.product_findings) {
    if (!finding.meaningful) continue;
    const tracker = trackerByKey.get(finding.product);
    if (!tracker) {
      log("call.unknown_product", { id: call.id, product: finding.product });
      continue;
    }
    if (hasAlerted(state, call.id, finding.product)) continue;
    if (!tracker.channelId) {
      log("call.channel_not_configured", {
        id: call.id,
        tracker: finding.product,
      });
      failures++;
      continue;
    }
    try {
      await sendSlackMessage(
        tracker.channelId,
        renderProductMessage(tracker, call, finding),
      );
      markAlerted(state, call.id, finding.product);
      alerts++;
      log("call.alerted_product", { id: call.id, product: finding.product });
    } catch (err) {
      failures++;
      log("call.alert_error", {
        id: call.id,
        product: finding.product,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Customer-signals fan-out (prospect/customer side only, grouped per call).
  const externalSignals = result.customer_signals.filter(
    (s) => s.speaker_side !== "internal",
  );
  if (externalSignals.length > 0 && !hasAlerted(state, call.id, "product-signals")) {
    const channelId = config.slack.productSignalsChannel;
    if (!channelId) {
      log("call.channel_not_configured", {
        id: call.id,
        tracker: "product-signals",
      });
      failures++;
    } else {
      try {
        await sendSlackMessage(
          channelId,
          renderSignalsMessage(call, externalSignals, result.account),
        );
        markAlerted(state, call.id, "product-signals");
        alerts++;
        log("call.alerted_signals", {
          id: call.id,
          count: externalSignals.length,
        });
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

  const newlyProcessed: string[] = [];
  let alertCount = 0;
  let failureCount = 0;

  for (const call of newCalls) {
    try {
      const r = await processCall(call, state);
      alertCount += r.alerts;
      failureCount += r.failures;
      // Only mark the call done when every send succeeded — a failed send
      // (e.g. bot not in a channel yet) leaves it for retry next run, while
      // sentAlerts stops the successful ones from re-posting.
      if (r.processed && r.failures === 0) newlyProcessed.push(call.id);
    } catch (err) {
      failureCount++;
      log("call.error", {
        id: call.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  state.processedCallIds = [...state.processedCallIds, ...newlyProcessed];
  // Advance the window only if we fully processed something; otherwise keep
  // lastRunAt so failed calls stay in range for a retry.
  if (newlyProcessed.length > 0) state.lastRunAt = toDate;
  await writeState(state);

  log("run.complete", {
    analyzed: newCalls.length,
    fullyProcessed: newlyProcessed.length,
    alerted: alertCount,
    failed: failureCount,
  });
}

main().catch((err) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(`[fatal] ${message}`);
  process.exit(1);
});
