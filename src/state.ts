import { readFile, writeFile } from "node:fs/promises";
import { config, type TrackerKey } from "./config.ts";

export interface State {
  lastRunAt: string;
  // Calls the combined Claude pass has already analyzed (cost control).
  processedCallIds: string[];
  // Idempotent fan-out ledger: "<callId>:<trackerKey>" for every alert sent.
  // Prevents duplicate posts and makes backfill / adding a product safe.
  sentAlerts: string[];
}

function alertKey(callId: string, tracker: TrackerKey): string {
  return `${callId}:${tracker}`;
}

export function hasAlerted(
  state: State,
  callId: string,
  tracker: TrackerKey,
): boolean {
  return state.sentAlerts.includes(alertKey(callId, tracker));
}

export function markAlerted(
  state: State,
  callId: string,
  tracker: TrackerKey,
): void {
  const key = alertKey(callId, tracker);
  if (!state.sentAlerts.includes(key)) state.sentAlerts.push(key);
}

function backfillStart(): string {
  return new Date(
    Date.now() - config.backfillDays * 24 * 60 * 60 * 1000,
  ).toISOString();
}

export async function readState(): Promise<State> {
  try {
    const raw = await readFile(config.statePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed.lastRunAt) parsed.lastRunAt = backfillStart();
    if (!Array.isArray(parsed.processedCallIds)) parsed.processedCallIds = [];
    if (!Array.isArray(parsed.sentAlerts)) parsed.sentAlerts = [];
    return parsed as State;
  } catch {
    return {
      lastRunAt: backfillStart(),
      processedCallIds: [],
      sentAlerts: [],
    };
  }
}

const MAX_IDS = 1000;
const MAX_ALERTS = 3000;

export async function writeState(state: State): Promise<void> {
  const trimmed: State = {
    lastRunAt: state.lastRunAt,
    processedCallIds: state.processedCallIds.slice(-MAX_IDS),
    sentAlerts: state.sentAlerts.slice(-MAX_ALERTS),
  };
  await writeFile(
    config.statePath,
    JSON.stringify(trimmed, null, 2) + "\n",
    "utf8",
  );
}
