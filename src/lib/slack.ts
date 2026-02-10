export interface SlackResult {
  ok: boolean;
  error?: string;
}

export async function sendSlackNotification(
  blocks: Record<string, unknown>,
  overrideWebhookUrl?: string
): Promise<SlackResult> {
  const url = overrideWebhookUrl || process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    return { ok: false, error: "Slack webhook URL is not configured" };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(blocks),
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Slack API error: ${res.status} ${text}` };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error sending to Slack",
    };
  }
}
