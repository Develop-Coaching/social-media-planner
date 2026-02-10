import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { sendSlackNotification, uploadAndShareImage } from "@/lib/slack";
import { getImages } from "@/lib/images";

interface ScheduleItem {
  time: string;
  type: string;
  title: string;
  preview: string;
  imageKey?: string;
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
}

function buildSlackText(payload: SlackPayload): string {
  const lines: string[] = [];

  lines.push(`*\ud83d\udccb Content Ready for Posting*`);
  lines.push(`*Company:* ${payload.companyName}`);
  if (payload.themeName) {
    lines.push(`*Theme:* \u201c${payload.themeName}\u201d`);
  }
  if (payload.weekLabel) {
    lines.push(`*Week:* ${payload.weekLabel}`);
  }
  lines.push("---");

  for (const day of payload.days) {
    if (day.items.length === 0) continue;

    lines.push("");
    lines.push(`*\ud83d\udcc5 ${day.dayName}${day.date ? `, ${day.date}` : ""}*`);

    for (const item of day.items) {
      const timeStr = item.time ? `${item.time} \u2014 ` : "";
      lines.push(`\u2022 ${timeStr}*${item.type}:* ${item.title}`);
      if (item.preview) {
        const truncated =
          item.preview.length > 150
            ? item.preview.slice(0, 150) + "\u2026"
            : item.preview;
        lines.push(`   _${truncated}_`);
      }
    }
  }

  return lines.join("\n");
}

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer | null {
  const match = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
  if (!match) return null;
  const buf = Buffer.from(match[1], "base64");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth();

    const body = (await request.json()) as SlackPayload;

    if (!body.companyName || !body.weekLabel || !Array.isArray(body.days)) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Post the schedule message via webhook (plain text only — most reliable)
    const text = buildSlackText(body);
    const result = await sendSlackNotification({ text });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    // Upload images directly to Slack if bot token is configured
    const botToken = process.env.SLACK_BOT_TOKEN;
    const channelId = process.env.SLACK_CHANNEL_ID;
    let imagesUploaded = 0;

    if (botToken && channelId && body.companyId) {
      const images = await getImages(userId, body.companyId);

      for (const day of body.days) {
        for (const item of day.items) {
          if (!item.imageKey) continue;

          // Find the right image key (carousels use slide-0)
          const keysToTry =
            item.imageKey.startsWith("carousel-")
              ? [`${item.imageKey}-slide-0`, item.imageKey]
              : [item.imageKey];

          for (const key of keysToTry) {
            if (!images[key]) continue;
            const buf = dataUrlToArrayBuffer(images[key]);
            if (!buf) continue;

            const title = `${day.dayName}, ${day.date} \u2014 ${item.type}: ${item.title}`;
            await uploadAndShareImage(
              botToken,
              channelId,
              buf,
              `${key}.png`,
              title
            );
            imagesUploaded++;
            break;
          }
        }
      }
    }

    return NextResponse.json({ ok: true, imagesUploaded });
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
