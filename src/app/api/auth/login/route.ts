import { NextRequest, NextResponse } from "next/server";
import { authConfiguration, createToken, COOKIE_NAME, sessionCookieOptions } from "@/lib/auth";
import { verifyPassword } from "@/lib/users";
import { createRateLimiter, getClientIP } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const loginLimiter = createRateLimiter("login", { maxAttempts: 5, windowMs: 15 * 60 * 1000 });

export async function POST(request: NextRequest) {
  if (!authConfiguration().configured) {
    return NextResponse.json({ error: "Authentication is not configured" }, { status: 503 });
  }

  const ip = getClientIP(request);
  const { allowed, retryAfterMs } = loginLimiter.check(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
      }
    );
  }

  try {
    const { username, password } = (await request.json()) as {
      username?: string;
      password?: string;
    };

    if (!username || !password) {
      return NextResponse.json({ error: "Username and password required" }, { status: 400 });
    }

    const user = await verifyPassword(username, password);
    if (!user) {
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }

    const token = await createToken(user.id, user.role, user.onboardingCompleted);
    const response = NextResponse.json({ success: true });

    response.cookies.set(COOKIE_NAME, token, sessionCookieOptions());

    return response;
  } catch {
    return NextResponse.json({ error: "Sign in failed" }, { status: 500 });
  }
}
