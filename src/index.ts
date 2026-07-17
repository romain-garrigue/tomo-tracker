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
import { renderAgentMessage, renderNewProductMessage } from "./render.ts";
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

  // One message per agent that has ≥1 signal → that agent's channel.
  for (const agent of config.slack.agents) {
    const agentSignals = externalSignals.filter((s) => s.product === agent.key);
    if (agentSignals.length === 0) continue;
    if (hasAlerted(state, call.id, agent.key)) continue;
    if (!agent.channelId) {
      log("call.channel_not_configured", { id: call.id, tracker: agent.key });
      failures++;
      continue;
    }
    try {
      await sendSlackMessage(
        agent.channelId,
        renderAgentMessage(agent, call, result.account, agentSignals),
      );
      markAlerted(state, call.id, agent.key);
      alerts++;
      log("call.alerted_agent", { id: call.id, product: agent.key });
    } catch (err) {
      failures++;
      log("call.alert_error", {
        id: call.id,
        product: agent.key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Net-new product requests only → the new-product channel (low volume).
  const netNew = externalSignals.filter((s) => s.product === "new_product");
  if (netNew.length > 0 && !hasAlerted(state, call.id, "new-product")) {
    const channelId = config.slack.newProductChannel;
    if (!channelId) {
      log("call.channel_not_configured", { id: call.id, tracker: "new-product" });
      failures++;
    } else {
      try {
        await sendSlackMessage(
          channelId,
          renderNewProductMessage(call, result.account, netNew),
        );
        markAlerted(state, call.id, "new-product");
        alerts++;
        log("call.alerted_new_product", { id: call.id, count: netNew.length });
      } catch (err) {
        failures++;
        log("call.alert_error", {
          id: call.id,
          tracker: "new-product",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  if (alerts === 0 && failures === 0) log("call.no_signals", { id: call.id });

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
