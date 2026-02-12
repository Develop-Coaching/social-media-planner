import { NextRequest, NextResponse } from "next/server";
import { createToken, COOKIE_NAME } from "@/lib/auth";
import { hasAnyUsers, createUser, migrateExistingData } from "@/lib/users";
import { createRateLimiter, getClientIP } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const setupLimiter = createRateLimiter("setup", { maxAttempts: 3, windowMs: 15 * 60 * 1000 });

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIP(request);
    const { allowed, retryAfterMs } = setupLimiter.check(ip);
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many setup attempts. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
        }
      );
    }

    const alreadySetUp = await hasAnyUsers();
    if (alreadySetUp) {
      return NextResponse.json({ error: "Setup already completed" }, { status: 400 });
    }

    const { setupKey, username, displayName, password } = (await request.json()) as {
      setupKey?: string;
      username?: string;
      displayName?: string;
      password?: string;
    };

    if (!setupKey || !username || !displayName || !password) {
      return NextResponse.json(
        { error: "setupKey, username, displayName, and password are all required" },
        { status: 400 }
      );
    }

    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword || setupKey !== adminPassword) {
      return NextResponse.json({ error: "Invalid setup key" }, { status: 401 });
    }

    if (password.length < 4) {
      return NextResponse.json({ error: "Password must be at least 4 characters" }, { status: 400 });
    }

    const user = await createUser(username, displayName, password, "admin", null);

    // Migrate existing flat data files into the new admin user's directory
    const migrated = await migrateExistingData(user.id);

    const token = await createToken(user.id, "admin", true);
    const response = NextResponse.json({
      success: true,
      user,
      migratedFiles: migrated,
    });

    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });

    return response;
  } catch (e) {
    console.error(e);
    const message = e instanceof Error ? e.message : "Setup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
