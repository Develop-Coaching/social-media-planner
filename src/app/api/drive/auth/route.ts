import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { saveDriveTokens, clearDriveTokens } from "@/lib/drive-tokens";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth();

    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return NextResponse.json({ error: "Google OAuth not configured" }, { status: 400 });
    }

    const { code } = (await request.json()) as { code?: string };
    if (!code) {
      return NextResponse.json({ error: "Missing authorization code" }, { status: 400 });
    }

    // Exchange the authorization code for tokens
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, "postmessage");
    const { tokens } = await oauth2.getToken(code);

    if (!tokens.access_token || !tokens.refresh_token) {
      return NextResponse.json(
        { error: "Failed to get tokens. Make sure the app has offline access." },
        { status: 400 }
      );
    }

    // Get the user's email from the token info
    oauth2.setCredentials(tokens);
    const oauth2Api = google.oauth2({ version: "v2", auth: oauth2 });
    const userInfo = await oauth2Api.userinfo.get();
    const email = userInfo.data.email || "unknown";

    await saveDriveTokens(userId, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expiry_date || Date.now() + 3600 * 1000,
      email,
    });

    return NextResponse.json({ ok: true, email });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("Drive auth error:", e);
    return NextResponse.json(
      { error: "Failed to authenticate with Google Drive" },
      { status: 500 }
    );
  }
}

/** Disconnect Google Drive — clears stored tokens */
export async function DELETE() {
  try {
    const { userId } = await requireAuth();
    await clearDriveTokens(userId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: (e as AuthError & { status: number }).status });
    }
    return NextResponse.json({ error: "Failed to disconnect" }, { status: 500 });
  }
}
