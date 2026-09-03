import { NextResponse } from "next/server";
import { hasAnyUsers } from "@/lib/users";
import { authConfiguration } from "@/lib/auth";

export async function GET() {
  try {
    const configuration = authConfiguration();
    if (!configuration.configured) {
      return NextResponse.json(
        { configured: false, authEnabled: false, needsSetup: false },
        { status: 503 },
      );
    }

    const hasUsers = await hasAnyUsers();
    return NextResponse.json({
      configured: true,
      authEnabled: true,
      needsSetup: !hasUsers,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to check status" }, { status: 500 });
  }
}
