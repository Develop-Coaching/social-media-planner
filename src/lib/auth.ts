import { SignJWT, jwtVerify } from "jose";

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || "post-creator-default-secret-change-me"
);

const COOKIE_NAME = "pc_session";
const EXPIRY = "7d";

export { COOKIE_NAME };

export interface TokenPayload {
  userId: string;
  role: "admin" | "user";
}

export async function createToken(userId: string, role: "admin" | "user"): Promise<string> {
  return new SignJWT({ userId, role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(SECRET);
}

export async function verifyToken(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, SECRET);
    return true;
  } catch {
    return false;
  }
}

export async function getUserFromToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    const userId = payload.userId as string | undefined;
    const role = payload.role as string | undefined;
    if (!userId || !role) return null;
    return { userId, role: role as "admin" | "user" };
  } catch {
    return null;
  }
}

export function isAuthEnabled(): boolean {
  return !!process.env.ADMIN_PASSWORD;
}
