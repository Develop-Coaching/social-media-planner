import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import {
  syncInstagramMetrics,
  syncFacebookMetrics,
  syncLinkedInMetrics,
} from "@/lib/post-metrics";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // per-post insight calls add up

// Callable two ways: by Vercel cron (Bearer CRON_SECRET) or by a signed-in
// user via the "Sync now" button.
async function isAuthorized(request: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") === `Bearer ${secret}`) {
    return true;
  }
  try {
    await requireAuth();
    return true;
  } catch (e) {
    if (e instanceof AuthError) return false;
    throw e;
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [instagram, facebook, linkedin] = await Promise.all([
    syncInstagramMetrics().catch((e) => ({ synced: 0, error: String(e) })),
    syncFacebookMetrics().catch((e) => ({ synced: 0, error: String(e) })),
    syncLinkedInMetrics().catch((e) => ({ synced: 0, error: String(e) })),
  ]);

  return NextResponse.json({ instagram, facebook, linkedin });
}

export async function GET(request: NextRequest) {
  // Vercel crons issue GET requests
  return POST(request);
}
