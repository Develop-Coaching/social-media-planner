import { NextRequest, NextResponse } from "next/server";
import { checkAllTokens, buildTokenAlert } from "@/lib/publish/token-health";
import { sendSlackNotification } from "@/lib/slack";

export const dynamic = "force-dynamic";

// Daily proactive check: verify each publishing token is valid and not about to
// expire, and Slack-alert if any needs reconnecting BEFORE a post fails on it.
// Guarded by CRON_SECRET like publish-tick.
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const statuses = await checkAllTokens();
  const alert = buildTokenAlert(statuses);

  if (alert) {
    try {
      const slack = await sendSlackNotification({ text: alert });
      if (!slack.ok) console.error("token-health: Slack alert failed:", slack.error);
    } catch (err) {
      console.error("token-health: Slack alert threw:", err);
    }
  }

  return NextResponse.json({
    checked: statuses.length,
    alerted: !!alert,
    statuses: statuses.map(({ label, configured, severity, daysLeft, detail }) => ({
      label, configured, severity, daysLeft, detail,
    })),
  });
}
