import { NextRequest, NextResponse } from "next/server";
import { createProductionAdapters } from "@/lib/publisher/adapters";
import { publisherCronAuthorized, publisherDispatchEnabled } from "@/lib/publisher/cron-gates";
import { notifyPublisherTransitions } from "@/lib/publisher/notifications";
import { createPublisherRepository } from "@/lib/publisher/repository";
import { runPublisherTick } from "@/lib/publisher/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!publisherCronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!publisherDispatchEnabled()) {
    return NextResponse.json({ dispatchEnabled: false, claimed: 0 });
  }
  const expectedEpoch = Number(process.env.PUBLISHER_OWNERSHIP_EPOCH);
  if (!Number.isSafeInteger(expectedEpoch) || expectedEpoch < 1) {
    return NextResponse.json({ error: "Publisher ownership epoch is not configured" }, { status: 503 });
  }
  try {
    const result = await runPublisherTick({
      expectedEpoch,
      dispatchEnabled: true,
      repository: createPublisherRepository(),
      adapters: createProductionAdapters(),
    });
    await notifyPublisherTransitions(result);
    return NextResponse.json(result);
  } catch (error) {
    console.error("publisher tick failed:", error);
    return NextResponse.json({ error: "Publisher tick failed closed" }, { status: 503 });
  }
}
