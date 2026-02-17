import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { getAgentUsers } from "@/lib/assignments";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuth();
    const agents = await getAgentUsers();
    return NextResponse.json({ agents });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Failed to load agents" }, { status: 500 });
  }
}
