import { NextRequest, NextResponse } from "next/server";
import { getInviteByToken, isInviteValid, markInviteUsed } from "@/lib/invites";
import { createUser } from "@/lib/users";
import { createToken, COOKIE_NAME } from "@/lib/auth";
import { createRateLimiter, getClientIP } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const signupLimiter = createRateLimiter("signup", { maxAttempts: 5, windowMs: 15 * 60 * 1000 });

export async function POST(request: NextRequest) {
  const ip = getClientIP(request);
  const { allowed, retryAfterMs } = signupLimiter.check(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many signup attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } }
    );
  }

  try {
    const { token, username, displayName, password } = (await request.json()) as {
      token: string;
      username: string;
      displayName: string;
      password: string;
    };

    if (!token || !username || !displayName || !password) {
      return NextResponse.json({ error: "All fields are required" }, { status: 400 });
    }

    if (password.length < 4) {
      return NextResponse.json({ error: "Password must be at least 4 characters" }, { status: 400 });
    }

    // Validate invite
    const invite = await getInviteByToken(token);
    if (!invite) {
      return NextResponse.json({ error: "Invalid invite link" }, { status: 400 });
    }
    if (!isInviteValid(invite)) {
      return NextResponse.json({ error: "This invite has expired or already been used" }, { status: 400 });
    }

    // Create user
    const user = await createUser(username, displayName, password, invite.role, invite.createdBy);

    // Mark invite as used
    await markInviteUsed(token, user.id);

    // Create JWT (onboardingCompleted = false for new signups)
    const jwt = await createToken(user.id, user.role, false);
    const response = NextResponse.json({ success: true, redirectTo: "/onboarding" });

    response.cookies.set(COOKIE_NAME, jwt, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });

    return response;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Signup failed" },
      { status: 500 }
    );
  }
}
