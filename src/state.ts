import { readFile, writeFile } from "node:fs/promises";
import { config } from "./config.ts";

export interface State {
  lastRunAt: string;
  processedCallIds: string[];
}

export async function readState(): Promise<State> {
  try {
    const raw = await readFile(config.statePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed.lastRunAt) {
      const fallback = new Date(
        Date.now() - config.backfillDays * 24 * 60 * 60 * 1000,
      ).toISOString();
      parsed.lastRunAt = fallback;
    }
    if (!Array.isArray(parsed.processedCallIds)) parsed.processedCallIds = [];
    return parsed as State;
  } catch {
    return {
      lastRunAt: new Date(
        Date.now() - config.backfillDays * 24 * 60 * 60 * 1000,
      ).toISOString(),
      processedCallIds: [],
    };
  }
}

const MAX_IDS = 500;

export async function writeState(state: State): Promise<void> {
  const trimmed: State = {
    lastRunAt: state.lastRunAt,
    processedCallIds: state.processedCallIds.slice(-MAX_IDS),
  };
  await writeFile(
    config.statePath,
    JSON.stringify(trimmed, null, 2) + "\n",
    "utf8",
  );
}
