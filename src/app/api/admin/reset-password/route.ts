import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth-helpers";
import { changePassword } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
    const { userId, newPassword } = (await request.json()) as {
      userId?: string;
      newPassword?: string;
    };

    if (!userId || !newPassword) {
      return NextResponse.json({ error: "userId and newPassword are required" }, { status: 400 });
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const ok = await changePassword(userId, newPassword);
    if (!ok) {
      return NextResponse.json({ error: "Failed to update password" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Failed to reset password" }, { status: 500 });
  }
}
