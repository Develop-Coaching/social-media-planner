import { SignJWT, jwtVerify } from "jose";

const COOKIE_NAME = "pc_session";
const EXPIRY = "7d";

export { COOKIE_NAME };

/**
 * Get the JWT signing secret. When auth is enabled (ADMIN_PASSWORD is set),
 * AUTH_SECRET must also be set — otherwise we throw to prevent using an
 * insecure default. When auth is disabled, a harmless default is fine.
 */
export function getSecret(): Uint8Array {
  if (process.env.ADMIN_PASSWORD && !process.env.AUTH_SECRET) {
    throw new Error(
      "AUTH_SECRET environment variable is required when ADMIN_PASSWORD is set. " +
      "Generate one with: openssl rand -base64 32"
    );
  }
  return new TextEncoder().encode(
    process.env.AUTH_SECRET || "postpilot-default-secret-change-me"
  );
}

export interface TokenPayload {
  userId: string;
  role: "admin" | "user";
  onboardingCompleted?: boolean;
}

export async function createToken(
  userId: string,
  role: "admin" | "user",
  onboardingCompleted = true
): Promise<string> {
  return new SignJWT({ userId, role, onboardingCompleted })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(getSecret());
}

export async function verifyToken(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, getSecret());
    return true;
  } catch {
    return false;
  }
}

export async function getUserFromToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const userId = payload.userId as string | undefined;
    const role = payload.role as string | undefined;
    if (!userId || !role) return null;
    return {
      userId,
      role: role as "admin" | "user",
      onboardingCompleted: payload.onboardingCompleted as boolean | undefined,
    };
  } catch {
    return null;
  }
}

export function isAuthEnabled(): boolean {
  return !!process.env.ADMIN_PASSWORD;
}
