import { NextResponse } from "next/server";
import { hasAnyUsers } from "@/lib/users";
import { isAuthEnabled } from "@/lib/auth";

export async function GET() {
  try {
    const authEnabled = isAuthEnabled();
    if (!authEnabled) {
      return NextResponse.json({ authEnabled: false, needsSetup: false });
    }

    const hasUsers = await hasAnyUsers();
    return NextResponse.json({
      authEnabled: true,
      needsSetup: !hasUsers,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to check status" }, { status: 500 });
  }
}
