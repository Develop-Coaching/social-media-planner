import { SignJWT, jwtVerify } from "jose";

const COOKIE_NAME = "pc_session";
const EXPIRY = "7d";

export { COOKIE_NAME };

export interface AuthConfiguration {
  configured: boolean;
  missing: Array<"ADMIN_PASSWORD" | "AUTH_SECRET">;
}

export function authConfiguration(
  env?: { ADMIN_PASSWORD?: string; AUTH_SECRET?: string },
): AuthConfiguration {
  const source = env ?? process.env;
  const missing: AuthConfiguration["missing"] = [];
  if (!source.ADMIN_PASSWORD?.trim()) missing.push("ADMIN_PASSWORD");
  if (!source.AUTH_SECRET?.trim()) missing.push("AUTH_SECRET");
  return { configured: missing.length === 0, missing };
}

export function getSecret(): Uint8Array {
  const configuration = authConfiguration();
  if (!configuration.configured) {
    throw new AuthConfigurationError(configuration.missing);
  }
  return new TextEncoder().encode(process.env.AUTH_SECRET!);
}

export class AuthConfigurationError extends Error {
  readonly missing: AuthConfiguration["missing"];

  constructor(missing: AuthConfiguration["missing"]) {
    super("Authentication is not configured");
    this.name = "AuthConfigurationError";
    this.missing = missing;
  }
}

export type UserRole = "admin" | "agent" | "client";

export interface TokenPayload {
  userId: string;
  role: UserRole;
  onboardingCompleted?: boolean;
}

export async function createToken(
  userId: string,
  role: UserRole,
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
    // Migrate old "user" role JWTs to "client"
    const normalizedRole = role === "user" ? "client" : role;
    if (!["admin", "agent", "client"].includes(normalizedRole)) return null;
    return {
      userId,
      role: normalizedRole as UserRole,
      onboardingCompleted: payload.onboardingCompleted as boolean | undefined,
    };
  } catch {
    return null;
  }
}

export function isAuthEnabled(): boolean {
  return authConfiguration().configured;
}
