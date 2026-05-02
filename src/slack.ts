import { config } from "./config.ts";

export async function sendSlackMessage(text: string): Promise<void> {
  const res = await fetch(config.slack.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Slack webhook → ${res.status}: ${body}`);
  }
}
