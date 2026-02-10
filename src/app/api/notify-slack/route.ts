import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { sendSlackNotification } from "@/lib/slack";
import { getImages } from "@/lib/images";
import { signImageParams } from "@/lib/images";

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

function buildSlackBlocks(
  payload: SlackPayload,
  imageUrls: Record<string, string>
) {
  const blocks: Record<string, unknown>[] = [];

  // Use section instead of header (webhooks don't support header blocks)
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*\ud83d\udccb Content Ready for Posting*`,
    },
  });

  blocks.push({
    type: "section",
    fields: [
      { type: "mrkdwn", text: `*Company:*\n${payload.companyName}` },
      { type: "mrkdwn", text: `*Theme:*\n\u201c${payload.themeName}\u201d` },
    ],
  });

  blocks.push({
    type: "context",
    elements: [
      { type: "mrkdwn", text: `\ud83d\udcc5 *Week:* ${payload.weekLabel}` },
    ],
  });

  blocks.push({ type: "divider" });

  for (const day of payload.days) {
    if (day.items.length === 0) continue;

    // Build per-item blocks so each can have an image accessory
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*\ud83d\udcc5 ${day.dayName}, ${day.date}*` },
    });

    for (const item of day.items) {
      let itemText = `\u2022 ${item.time} \u2014 *${item.type}:* ${item.title}`;
      if (item.preview) {
        const truncated =
          item.preview.length > 100
            ? item.preview.slice(0, 100) + "\u2026"
            : item.preview;
        itemText += `\n    _${truncated}_`;
      }

      const block: Record<string, unknown> = {
        type: "section",
        text: { type: "mrkdwn", text: itemText },
      };

      // Attach image as accessory thumbnail if available
      if (item.imageKey && imageUrls[item.imageKey]) {
        block.accessory = {
          type: "image",
          image_url: imageUrls[item.imageKey],
          alt_text: `${item.type}: ${item.title}`,
        };
      }

      blocks.push(block);
    }
  }

  // text field is required fallback for webhook notifications
  return { text: `\ud83d\udccb Content Ready for Posting — ${payload.companyName}`, blocks };
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

    // Build signed image URLs if companyId is provided
    const imageUrls: Record<string, string> = {};
    if (body.companyId) {
      const origin = new URL(request.url).origin;
      const images = await getImages(userId, body.companyId);
      const expires = Math.floor(Date.now() / 1000) + 3600; // 1 hour

      // Collect all image keys from the schedule
      for (const day of body.days) {
        for (const item of day.items) {
          if (!item.imageKey) continue;
          // For carousels, check the first slide image
          const keysToTry =
            item.imageKey.startsWith("carousel-")
              ? [`${item.imageKey}-slide-0`, item.imageKey]
              : [item.imageKey];

          for (const key of keysToTry) {
            if (images[key]) {
              const sig = signImageParams(userId, body.companyId, key, expires);
              imageUrls[item.imageKey] =
                `${origin}/api/images/serve?uid=${encodeURIComponent(userId)}&cid=${encodeURIComponent(body.companyId)}&key=${encodeURIComponent(key)}&exp=${expires}&sig=${sig}`;
              break;
            }
          }
        }
      }
    }

    const message = buildSlackBlocks(body, imageUrls);
    const result = await sendSlackNotification(message);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
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
