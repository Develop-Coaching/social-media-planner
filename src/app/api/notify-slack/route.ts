import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { sendSlackNotification, uploadAndShareImage } from "@/lib/slack";
import { getImages } from "@/lib/images";
import { getCompanyById } from "@/lib/companies";
import { getDriveClient, uploadImage, ensureFolder, DriveAuthError } from "@/lib/drive";

export const dynamic = "force-dynamic";

interface ScheduleItem {
  time: string;
  type: string;
  title: string;
  preview: string;
  imageKey?: string;
  postingDate?: string;
}

interface ScheduleDay {
  dayName: string;
  date: string;
  items: ScheduleItem[];
}

interface SlackPayload {
  companyName: string;
  themeName: string;
  weekLabel: string;
  companyId: string;
  days: ScheduleDay[];
  driveEnabled?: boolean;
}

function buildSlackText(payload: SlackPayload, driveLink?: string): string {
  const lines: string[] = [];

  lines.push(`${payload.companyName} — Content Ready for Posting`);
  if (payload.themeName) {
    lines.push(`Theme: ${payload.themeName}`);
  }
  if (payload.weekLabel) {
    lines.push(`Week: ${payload.weekLabel}`);
  }
  lines.push("");
  lines.push("---");

  for (const day of payload.days) {
    if (day.items.length === 0) continue;

    // Only show day header if it has a meaningful name
    if (day.dayName && day.dayName !== "All Content") {
      lines.push("");
      lines.push(`${day.dayName}${day.date ? `, ${day.date}` : ""}`);
      lines.push("");
    } else {
      lines.push("");
    }

    for (const item of day.items) {
      // Format posting date as readable string (e.g. "Wed, Feb 12")
      let dateStr = "";
      if (item.postingDate) {
        const d = new Date(item.postingDate + "T00:00:00");
        dateStr = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      }

      lines.push(`${item.type}: ${item.title}`);
      if (dateStr) {
        lines.push(`Post on: ${dateStr}`);
      }
      if (item.preview) {
        lines.push("");
        lines.push(item.preview);
      }
      lines.push("");
      lines.push("---");
    }
  }

  if (driveLink) {
    lines.push("");
    lines.push(`Images: ${driveLink}`);
  }

  return lines.join("\n");
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth();

    const body = (await request.json()) as SlackPayload;

    if (!body.companyName || !Array.isArray(body.days)) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Look up per-company Slack settings (falls back to env vars)
    const company = body.companyId ? await getCompanyById(userId, body.companyId) : null;

    // Collect all image keys from the payload
    const imageKeys: string[] = [];
    for (const day of body.days) {
      for (const item of day.items) {
        if (item.imageKey) imageKeys.push(item.imageKey);
      }
    }

    let driveLink: string | undefined;
    let imagesUploaded = 0;

    // If Drive is enabled, upload images there and include the folder link
    if (body.driveEnabled && body.companyId && imageKeys.length > 0) {
      try {
        const drive = await getDriveClient(userId);
        const images = await getImages(userId, body.companyId);
        const companyFolder = await ensureFolder(drive, "root", body.companyName);
        const folderName = body.themeName || "Content";
        const targetFolder = await ensureFolder(drive, companyFolder, folderName);

        for (const imageKey of imageKeys) {
          // For carousels, try slide-0 first
          const keysToTry = imageKey.startsWith("carousel-")
            ? [`${imageKey}-slide-0`, imageKey]
            : [imageKey];

          for (const key of keysToTry) {
            if (!images[key]) continue;
            try {
              await uploadImage(drive, targetFolder, `${key}.png`, images[key]);
              imagesUploaded++;
            } catch (uploadErr) {
              console.error(`Drive upload failed for ${key}:`, uploadErr);
            }
            break;
          }
        }

        driveLink = `https://drive.google.com/drive/folders/${targetFolder}`;
      } catch (driveErr) {
        if (!(driveErr instanceof DriveAuthError)) {
          console.error("Drive upload error:", driveErr);
        }
        // Fall through — send message without Drive link
      }
    }

    // Post the message via webhook
    const text = buildSlackText(body, driveLink);
    const result = await sendSlackNotification({ text }, company?.slackWebhookUrl);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    // If Drive wasn't used, try uploading images directly to Slack via bot token
    if (!driveLink) {
      const botToken = company?.slackBotToken || process.env.SLACK_BOT_TOKEN;
      const channelId = company?.slackChannelId || process.env.SLACK_CHANNEL_ID;

      if (botToken && channelId && body.companyId && imageKeys.length > 0) {
        const images = await getImages(userId, body.companyId);

        for (const imageKey of imageKeys) {
          const keysToTry = imageKey.startsWith("carousel-")
            ? [`${imageKey}-slide-0`, imageKey]
            : [imageKey];

          for (const key of keysToTry) {
            if (!images[key]) continue;
            const match = images[key].match(/^data:[^;]+;base64,(.+)$/);
            if (!match) continue;
            const buf = Buffer.from(match[1], "base64");
            const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

            try {
              await uploadAndShareImage(botToken, channelId, arrayBuf, `${key}.png`, `${key}`);
              imagesUploaded++;
            } catch (imgErr) {
              console.error(`Slack image upload failed for ${key}:`, imgErr);
            }
            break;
          }
        }
      }
    }

    return NextResponse.json({ ok: true, imagesUploaded, driveLink: driveLink || undefined });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("Slack notification error:", e);
    return NextResponse.json(
      { error: "Failed to send Slack notification" },
      { status: 500 }
    );
  }
}
