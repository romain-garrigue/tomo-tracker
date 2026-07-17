function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

// The five product codenames a signal can be attributed to.
export type ProductKey = "tomo" | "mochi" | "kumi" | "shiro" | "ken";

// Idempotency-ledger key. One consolidated message per call → "product-signals".
export type TrackerKey = ProductKey | "product-signals";

// Emoji + label per agent, used to render one paragraph per agent (in this order).
export interface Agent {
  key: ProductKey;
  label: string;
  emoji: string;
}

const agents: Agent[] = [
  { key: "tomo", label: "Tomo", emoji: ":studio_microphone:" },
  { key: "mochi", label: "Mochi", emoji: ":telephone_receiver:" },
  { key: "kumi", label: "Kumi", emoji: ":spiral_calendar_pad:" },
  { key: "shiro", label: "Shiro", emoji: ":clipboard:" },
  { key: "ken", label: "Ken", emoji: ":microscope:" },
];

// When set (workflow_dispatch dry_run input), route the message here (e.g. a DM)
// instead of the real channel — a safe end-to-end dry-run.
const dryRunChannel = process.env.DRY_RUN_CHANNEL || "";

export const config = {
  gong: {
    baseUrl: process.env.GONG_BASE_URL ?? "https://eu-93246.api.gong.io",
    accessKey: required("GONG_ACCESS_KEY"),
    accessKeySecret: required("GONG_ACCESS_KEY_SECRET"),
    workspaceId: process.env.GONG_WORKSPACE_ID ?? "6135656620898778750",
  },
  slack: {
    botToken: required("SLACK_BOT_TOKEN"),
    // Single consolidated channel. Reuses the existing tracker channel
    // (was #tomo-mention-alerts; being renamed to a product-signals tracker).
    signalsChannel:
      dryRunChannel || process.env.SLACK_CHANNEL_PRODUCT_SIGNALS || "C0B0CHKC58X",
    agents,
  },
  anthropic: {
    apiKey: required("ANTHROPIC_API_KEY"),
    model: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7",
  },
  backfillDays: Number(process.env.BACKFILL_DAYS || 7),
  statePath: process.env.STATE_PATH ?? "state/processed_calls.json",
};
