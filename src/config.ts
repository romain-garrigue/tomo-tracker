function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  gong: {
    baseUrl: process.env.GONG_BASE_URL ?? "https://eu-93246.api.gong.io",
    accessKey: required("GONG_ACCESS_KEY"),
    accessKeySecret: required("GONG_ACCESS_KEY_SECRET"),
    workspaceId: process.env.GONG_WORKSPACE_ID ?? "6135656620898778750",
  },
  slack: {
    webhookUrl: required("SLACK_WEBHOOK_URL"),
  },
  anthropic: {
    apiKey: required("ANTHROPIC_API_KEY"),
    model: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7",
  },
  backfillDays: Number(process.env.BACKFILL_DAYS ?? 7),
  statePath: process.env.STATE_PATH ?? "state/processed_calls.json",
};
