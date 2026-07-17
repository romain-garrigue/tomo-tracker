function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

// The five product codenames we route to per-product channels.
export type ProductKey = "tomo" | "mochi" | "kumi" | "shiro" | "ken";

// Every logical destination (5 products + the customer-signals feed).
export type TrackerKey = ProductKey | "product-signals";

export interface Tracker {
  key: ProductKey;
  label: string;
  emoji: string;
  channelId: string;
}

// Slack channel IDs. Env-overridable so local dry-runs can route everything
// to a DM. #tomo-mention-alerts already exists; the rest are created at rollout.
const channels = {
  // `||` (not `??`) so an empty env var (unset GitHub Actions variable) still
  // falls back to the known #tomo-mention-alerts ID rather than blanking it.
  tomo: process.env.SLACK_CHANNEL_TOMO || "C0B0CHKC58X",
  mochi: process.env.SLACK_CHANNEL_MOCHI ?? "",
  kumi: process.env.SLACK_CHANNEL_KUMI ?? "",
  // Shiro and Ken share one channel (#shiro-ken-mention-alerts).
  shiroKen: process.env.SLACK_CHANNEL_SHIRO_KEN ?? "",
  productSignals: process.env.SLACK_CHANNEL_PRODUCT_SIGNALS ?? "",
};

// When set, route EVERY tracker + the signals feed to this one channel/DM
// instead of the real channels — a safe end-to-end dry-run that never touches
// production channels. Wired to the workflow_dispatch `dry_run_channel` input.
const dryRunChannel = process.env.DRY_RUN_CHANNEL || "";

// One entry per product codename. Shiro and Ken point at the same channel but
// keep distinct labels/emojis so the header says which product was pitched.
const trackers: Tracker[] = [
  { key: "tomo", label: "Tomo", emoji: ":studio_microphone:", channelId: dryRunChannel || channels.tomo },
  { key: "mochi", label: "Mochi", emoji: ":telephone_receiver:", channelId: dryRunChannel || channels.mochi },
  { key: "kumi", label: "Kumi", emoji: ":spiral_calendar_pad:", channelId: dryRunChannel || channels.kumi },
  { key: "shiro", label: "Shiro", emoji: ":clipboard:", channelId: dryRunChannel || channels.shiroKen },
  { key: "ken", label: "Ken", emoji: ":microscope:", channelId: dryRunChannel || channels.shiroKen },
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
    channels,
    trackers,
    productSignalsChannel: dryRunChannel || channels.productSignals,
    productSignalsEmoji: ":bulb:",
  },
  anthropic: {
    apiKey: required("ANTHROPIC_API_KEY"),
    model: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7",
  },
  backfillDays: Number(process.env.BACKFILL_DAYS || 7),
  statePath: process.env.STATE_PATH ?? "state/processed_calls.json",
};
