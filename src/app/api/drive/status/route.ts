import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { isDriveEnabled } from "@/lib/drive";
import { getDriveTokens } from "@/lib/drive-tokens";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const enabled = isDriveEnabled();
    if (!enabled) {
      return NextResponse.json({ enabled: false, authenticated: false });
    }

    const { userId } = await requireAuth();
    const tokens = await getDriveTokens(userId);

    return NextResponse.json({
      enabled: true,
      authenticated: !!tokens,
      email: tokens?.email || undefined,
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      // If not authenticated (no user session), just return enabled status
      return NextResponse.json({
        enabled: isDriveEnabled(),
        authenticated: false,
      });
    }
    return NextResponse.json({ enabled: false, authenticated: false });
  }
}
