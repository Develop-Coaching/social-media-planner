export interface SlackResult {
  ok: boolean;
  error?: string;
}

interface SlackApiResponse {
  ok: boolean;
  error?: string;
  upload_url?: string;
  file_id?: string;
}

function getConfig() {
  return {
    webhookUrl: process.env.SLACK_WEBHOOK_URL,
    botToken: process.env.SLACK_BOT_TOKEN,
    channelId: process.env.SLACK_CHANNEL_ID,
  };
}

async function slackApi(
  endpoint: string,
  token: string,
  body: FormData | Record<string, unknown>,
  isForm = false
): Promise<SlackApiResponse> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  let reqBody: string | FormData;
  if (isForm) {
    reqBody = body as FormData;
  } else {
    headers["Content-Type"] = "application/json; charset=utf-8";
    reqBody = JSON.stringify(body);
  }

  const res = await fetch(`https://slack.com/api/${endpoint}`, {
    method: "POST",
    headers,
    body: reqBody,
  });
  return res.json() as Promise<SlackApiResponse>;
}

/**
 * Upload a single image to Slack and return the file_id.
 * Uses the two-step external upload flow.
 */
export async function uploadImageToSlack(
  token: string,
  imageData: ArrayBuffer,
  filename: string
): Promise<string | null> {
  // Step 1: get upload URL
  const form1 = new FormData();
  form1.append("filename", filename);
  form1.append("length", imageData.byteLength.toString());
  const urlRes = await slackApi("files.getUploadURLExternal", token, form1, true);
  if (!urlRes.ok || !urlRes.upload_url || !urlRes.file_id) return null;

  // Step 2: upload the file data
  await fetch(urlRes.upload_url, {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: new Blob([imageData], { type: "image/png" }),
  });

  // Step 3: complete the upload
  const completeRes = await slackApi("files.completeUploadExternal", token, {
    files: [{ id: urlRes.file_id }],
  });
  if (!completeRes.ok) return null;

  return urlRes.file_id;
}

/**
 * Post a message with blocks to a channel using the Bot API.
 */
export async function postSlackMessage(
  token: string,
  channelId: string,
  text: string,
  blocks: Record<string, unknown>[]
): Promise<SlackResult> {
  const res = await slackApi("chat.postMessage", token, {
    channel: channelId,
    text,
    blocks,
  });
  if (!res.ok) {
    return { ok: false, error: res.error || "chat.postMessage failed" };
  }
  return { ok: true };
}

/**
 * Upload a file and share it to a channel.
 */
export async function uploadAndShareImage(
  token: string,
  channelId: string,
  imageData: ArrayBuffer,
  filename: string,
  title: string
): Promise<SlackResult> {
  // Step 1: get upload URL
  const form1 = new FormData();
  form1.append("filename", filename);
  form1.append("length", imageData.byteLength.toString());
  const urlRes = await slackApi("files.getUploadURLExternal", token, form1, true);
  if (!urlRes.ok || !urlRes.upload_url || !urlRes.file_id) {
    return { ok: false, error: urlRes.error || "Failed to get upload URL" };
  }

  // Step 2: upload file data
  await fetch(urlRes.upload_url, {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: new Blob([imageData], { type: "image/png" }),
  });

  // Step 3: complete upload and share to channel
  const completeRes = await slackApi("files.completeUploadExternal", token, {
    files: [{ id: urlRes.file_id, title }],
    channel_id: channelId,
  });
  if (!completeRes.ok) {
    return { ok: false, error: completeRes.error || "Failed to complete upload" };
  }

  return { ok: true };
}

/**
 * Send a Slack notification — prefers Bot API if configured, falls back to webhook.
 */
export async function sendSlackNotification(
  payload: { text: string; blocks: Record<string, unknown>[] },
  overrideWebhookUrl?: string
): Promise<SlackResult> {
  const { botToken, channelId, webhookUrl } = getConfig();

  // Prefer bot API if configured
  if (botToken && channelId) {
    return postSlackMessage(botToken, channelId, payload.text, payload.blocks);
  }

  // Fall back to webhook
  const url = overrideWebhookUrl || webhookUrl;
  if (!url) {
    return { ok: false, error: "Slack is not configured. Set SLACK_BOT_TOKEN + SLACK_CHANNEL_ID or SLACK_WEBHOOK_URL." };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
