import { NextRequest, NextResponse } from "next/server";
import { createToken, COOKIE_NAME, sessionCookieOptions } from "@/lib/auth";
import { hasAnyUsers, createUser, migrateExistingData } from "@/lib/users";
import { createRateLimiter, getClientIP } from "@/lib/rate-limit";
import { authConfiguration } from "@/lib/auth";
import { credentialPolicyError, secureCredentialEqual } from "@/lib/credential-policy";

export const dynamic = "force-dynamic";

const setupLimiter = createRateLimiter("setup", { maxAttempts: 3, windowMs: 15 * 60 * 1000 });

export async function POST(request: NextRequest) {
  try {
    if (!authConfiguration().configured) {
      return NextResponse.json({ error: "Authentication is not securely configured" }, { status: 503 });
    }
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
    if (!adminPassword || !secureCredentialEqual(setupKey, adminPassword)) {
      return NextResponse.json({ error: "Invalid setup key" }, { status: 401 });
    }

    const passwordError = credentialPolicyError(password);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
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

    response.cookies.set(COOKIE_NAME, token, sessionCookieOptions());

    return response;
  } catch (e) {
    console.error(e);
    const message = e instanceof Error ? e.message : "Setup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
