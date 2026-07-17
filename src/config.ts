function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export type ProductKey = "tomo" | "mochi" | "kumi" | "shiro" | "ken";

// Idempotency-ledger keys: one per agent channel, plus the new-product channel.
export type TrackerKey = ProductKey | "new-product";

export interface Agent {
  key: ProductKey;
  label: string;
  emoji: string;
  channelId: string;
}

// When set (workflow_dispatch dry_run input), route EVERY message here (e.g. a DM)
// instead of the real channels — a safe end-to-end dry-run.
const dryRunChannel = process.env.DRY_RUN_CHANNEL || "";

// Channel IDs (env-overridable; defaults are the real channels). Shiro and Ken
// share one channel. The new-product channel gets ONLY net-new product requests.
const ch = {
  tomo: process.env.SLACK_CHANNEL_TOMO || "C0B0CHKC58X",
  mochi: process.env.SLACK_CHANNEL_MOCHI || "C0BH3QDQXS8",
  kumi: process.env.SLACK_CHANNEL_KUMI || "C0BH20RQH2M",
  shiroKen: process.env.SLACK_CHANNEL_SHIRO_KEN || "C0BGJN0925D",
  newProduct: process.env.SLACK_CHANNEL_NEW_PRODUCT || "C0BH20VCTFB",
};

const agents: Agent[] = [
  { key: "tomo", label: "Tomo", emoji: ":studio_microphone:", channelId: dryRunChannel || ch.tomo },
  { key: "mochi", label: "Mochi", emoji: ":telephone_receiver:", channelId: dryRunChannel || ch.mochi },
  { key: "kumi", label: "Kumi", emoji: ":spiral_calendar_pad:", channelId: dryRunChannel || ch.kumi },
  { key: "shiro", label: "Shiro", emoji: ":clipboard:", channelId: dryRunChannel || ch.shiroKen },
  { key: "ken", label: "Ken", emoji: ":microscope:", channelId: dryRunChannel || ch.shiroKen },
];

export const config = {
  gong: {
    baseUrl: process.env.GONG_BASE_URL ?? "https://eu-93246.api.gong.io",
    accessKey: required("GONG_ACCESS_KEY"),
    accessKeySecret: required("GONG_ACCESS_KEY_SECRET"),
    workspaceId: process.env.GONG_WORKSPACE_ID ?? "6135656620898778750",
  },
  slack: {
    botToken: required("SLACK_BOT_TOKEN"),
    agents,
    // Net-new product requests only (low volume; not a message per call).
    newProductChannel: dryRunChannel || ch.newProduct,
  },
  anthropic: {
    apiKey: required("ANTHROPIC_API_KEY"),
    model: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7",
  },
  backfillDays: Number(process.env.BACKFILL_DAYS || 7),
  statePath: process.env.STATE_PATH ?? "state/processed_calls.json",
};
