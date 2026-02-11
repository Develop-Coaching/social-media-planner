import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { sendSlackNotification } from "@/lib/slack";
import { createAsanaTask } from "@/lib/asana";
import { isDriveEnabled, getDriveClient, ensureFolder, DriveAuthError } from "@/lib/drive";
import { getCompanyById } from "@/lib/companies";

export const dynamic = "force-dynamic";

type Target = "editor" | "filming";

const TARGET_CONFIG: Record<Target, {
  slackEnvVar: string;
  asanaProjectEnvVar: string;
  asanaAssigneeEnvVar: string;
  slackHeading: string;
  slackFallback: (body: SendBody) => string;
  asanaTaskName: (body: SendBody) => string;
}> = {
  editor: {
    slackEnvVar: "SLACK_SEND_TO_EDITOR_WEBHOOK_URL",
    asanaProjectEnvVar: "ASANA_PROJECT_ID",
    asanaAssigneeEnvVar: "ASANA_EDITOR_USER_ID",
    slackHeading: "*\ud83c\udfac Reel Ready for Editing*",
    slackFallback: (b) => `\ud83c\udfac ${b.reelTitle || `Reel ${b.reelIndex + 1}`} ready for editing \u2014 ${b.companyName}`,
    asanaTaskName: (b) => `Edit: ${b.reelTitle || `Reel ${b.reelIndex + 1}`} - ${b.companyName}${b.themeName ? ` - ${b.themeName}` : ""}`,
  },
  filming: {
    slackEnvVar: "SLACK_SEND_FOR_FILMING_WEBHOOK_URL",
    asanaProjectEnvVar: "ASANA_FILMING_PROJECT_ID",
    asanaAssigneeEnvVar: "ASANA_FILMING_USER_ID",
    slackHeading: "*\ud83c\udfac Reel Ready for Filming*",
    slackFallback: (b) => `\ud83c\udfac ${b.reelTitle || `Reel ${b.reelIndex + 1}`} ready for filming \u2014 ${b.companyName}`,
    asanaTaskName: (b) => `Film: ${b.reelTitle || `Reel ${b.reelIndex + 1}`} - ${b.companyName}${b.themeName ? ` - ${b.themeName}` : ""}`,
  },
};

interface SendBody {
  companyName: string;
  companyId: string;
  themeName: string;
  reelIndex: number;
  reelTitle?: string;
  script: string;
  caption: string;
  target?: Target;
}

function buildSlackBlocks(
  body: SendBody,
  config: typeof TARGET_CONFIG[Target],
  driveLink?: string
): { text: string; blocks: Record<string, unknown>[] } {
  const blocks: Record<string, unknown>[] = [];

  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: config.slackHeading },
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
      text: `*${body.reelTitle || `Reel ${body.reelIndex + 1}`} \u2014 Script:*\n${scriptText}`,
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

  return { text: config.slackFallback(body), blocks };
}

function buildAsanaNotes(body: SendBody, driveLink?: string): string {
  let notes = "";
  if (body.reelTitle) notes += `Reel: ${body.reelTitle}\n`;
  notes += `Company: ${body.companyName}\nTheme: ${body.themeName || "N/A"}\n\n`;
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

    const body = (await request.json()) as SendBody;
    const target: Target = body.target === "filming" ? "filming" : "editor";
    const config = TARGET_CONFIG[target];

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

    // Look up per-company Slack settings (falls back to env vars)
    const company = body.companyId ? await getCompanyById(userId, body.companyId) : null;

    // Build Slack message
    const slackBlocks = buildSlackBlocks(body, config, driveLink);
    const webhookUrl = company?.slackEditorWebhookUrl || process.env[config.slackEnvVar];
    const projectId = process.env[config.asanaProjectEnvVar];
    const assignee = process.env[config.asanaAssigneeEnvVar];

    // Run Slack + Asana in parallel (independent)
    const [slackResult, asanaResult] = await Promise.all([
      webhookUrl
        ? sendSlackNotification(slackBlocks, webhookUrl)
        : Promise.resolve({ ok: false as const, error: `${target} webhook not configured` }),
      createAsanaTask({
        name: config.asanaTaskName(body),
        notes: buildAsanaNotes(body, driveLink),
        projectId,
        assignee,
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
