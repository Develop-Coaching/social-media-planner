import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { sendSlackNotification } from "@/lib/slack";
import { createAsanaTask } from "@/lib/asana";
import { isDriveEnabled, getDriveClient, ensureFolder, DriveAuthError } from "@/lib/drive";

interface SendToEditorBody {
  companyName: string;
  companyId: string;
  themeName: string;
  reelIndex: number;
  script: string;
  caption: string;
}

function buildEditorSlackBlocks(
  body: SendToEditorBody,
  driveLink?: string
): Record<string, unknown> {
  const blocks: Record<string, unknown>[] = [];

  blocks.push({
    type: "header",
    text: { type: "plain_text", text: "\ud83c\udfac Reel Ready for Editing", emoji: true },
  });

  blocks.push({
    type: "section",
    fields: [
      { type: "mrkdwn", text: `*Company:*\n${body.companyName}` },
      { type: "mrkdwn", text: `*Theme:*\n\u201c${body.themeName || "N/A"}\u201d` },
    ],
  });

  blocks.push({ type: "divider" });

  // Truncate script for Slack's 3000-char block limit
  const scriptText =
    body.script.length > 2800
      ? body.script.slice(0, 2800) + "\u2026\n_(truncated \u2014 see Asana task for full script)_"
      : body.script;

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*Reel ${body.reelIndex + 1} \u2014 Script:*\n${scriptText}`,
    },
  });

  if (body.caption) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Caption:*\n${body.caption}` },
    });
  }

  if (driveLink) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Google Drive:* <${driveLink}|Open folder in Drive>`,
      },
    });
  }

  return { blocks };
}

function buildAsanaNotes(body: SendToEditorBody, driveLink?: string): string {
  let notes = `Company: ${body.companyName}\nTheme: ${body.themeName || "N/A"}\n\n`;
  notes += `--- SCRIPT ---\n${body.script}\n\n`;
  if (body.caption) {
    notes += `--- CAPTION ---\n${body.caption}\n\n`;
  }
  if (driveLink) {
    notes += `Google Drive: ${driveLink}\n`;
  }
  return notes;
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth();

    const body = (await request.json()) as SendToEditorBody;

    if (!body.companyName || !body.script || body.reelIndex == null) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Best-effort Drive folder link (only if user has OAuth tokens)
    let driveLink: string | undefined;
    if (isDriveEnabled()) {
      try {
        const drive = await getDriveClient(userId);
        const companyFolderId = await ensureFolder(drive, "root", body.companyName);
        const themeFolderId = body.themeName
          ? await ensureFolder(drive, companyFolderId, body.themeName)
          : companyFolderId;
        driveLink = `https://drive.google.com/drive/folders/${themeFolderId}`;
      } catch (err) {
        if (!(err instanceof DriveAuthError)) {
          // Log unexpected errors but continue without link
          console.error("Drive folder lookup failed:", err);
        }
      }
    }

    // Build Slack message
    const slackBlocks = buildEditorSlackBlocks(body, driveLink);
    const editingWebhook = process.env.SLACK_EDITING_WEBHOOK_URL;

    // Run Slack + Asana in parallel (independent)
    const [slackResult, asanaResult] = await Promise.all([
      editingWebhook
        ? sendSlackNotification(slackBlocks, editingWebhook)
        : Promise.resolve({ ok: false as const, error: "Editing webhook not configured" }),
      createAsanaTask({
        name: `Edit Reel ${body.reelIndex + 1} - ${body.companyName}${body.themeName ? ` - ${body.themeName}` : ""}`,
        notes: buildAsanaNotes(body, driveLink),
      }),
    ]);

    const overallOk = slackResult.ok || asanaResult.ok;
    return NextResponse.json(
      {
        ok: overallOk,
        slack: { ok: slackResult.ok, error: slackResult.error },
        asana: { ok: asanaResult.ok, taskUrl: asanaResult.taskUrl, error: asanaResult.error },
        driveLink,
      },
      { status: overallOk ? 200 : 502 }
    );
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("Send to editor error:", e);
    return NextResponse.json(
      { error: "Failed to send to editor" },
      { status: 500 }
    );
  }
}
