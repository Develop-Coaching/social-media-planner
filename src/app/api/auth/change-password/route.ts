import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { getUserById, changePassword } from "@/lib/users";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth();

    const { currentPassword, newPassword } = (await request.json()) as {
      currentPassword?: string;
      newPassword?: string;
    };

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: "Current password and new password are required" }, { status: 400 });
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ error: "New password must be at least 8 characters" }, { status: 400 });
    }

    const user = await getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
    }

    const success = await changePassword(userId, newPassword);
    if (!success) {
      return NextResponse.json({ error: "Failed to update password" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
