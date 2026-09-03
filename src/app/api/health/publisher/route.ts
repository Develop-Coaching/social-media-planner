import { NextRequest, NextResponse } from "next/server";
import { checkPublisherIdentities } from "@/lib/publisher/identity-health";

export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const platforms = await checkPublisherIdentities();
  const healthy = platforms.every((platform) => platform.state === "ok");
  return NextResponse.json({ healthy, platforms }, { status: healthy ? 200 : 503 });
}
