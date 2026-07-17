import { config } from "./config.ts";

// Post to a channel by ID using a bot token (chat:write). Unlike incoming
// webhooks (one URL per channel), one bot token can post to every channel it
// has been invited to — so adding a product = adding a channel ID, no new secret.
export async function sendSlackMessage(
  channelId: string,
  text: string,
): Promise<void> {
  if (!channelId) {
    throw new Error("sendSlackMessage: missing channelId");
  }
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.slack.botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ channel: channelId, text, unfurl_links: false }),
  });

  const body = (await res.json()) as { ok: boolean; error?: string };
  if (!res.ok || !body.ok) {
    // Common errors: not_in_channel (bot not invited), channel_not_found,
    // invalid_auth (bad/expired token).
    throw new Error(
      `Slack chat.postMessage (${channelId}) failed: ${body.error ?? res.status}`,
    );
  }
}
