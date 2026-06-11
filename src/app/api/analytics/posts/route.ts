import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { listPostMetrics } from "@/lib/post-metrics";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuth();
    const posts = await listPostMetrics();
    return NextResponse.json({ posts });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("analytics/posts error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load metrics" },
      { status: 500 }
    );
  }
}
