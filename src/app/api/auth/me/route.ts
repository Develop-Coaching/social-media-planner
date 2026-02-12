import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { getUserById } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { userId } = await requireAuth();
    const user = await getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      onboardingCompleted: user.onboardingCompleted,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Failed to get user info" }, { status: 500 });
  }
}
