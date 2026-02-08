import { SignJWT, jwtVerify } from "jose";

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || "post-creator-default-secret-change-me"
);

const COOKIE_NAME = "pc_session";
const EXPIRY = "7d";

export { COOKIE_NAME };

export async function createToken(): Promise<string> {
  return new SignJWT({ authenticated: true })
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

export function isAuthEnabled(): boolean {
  return !!process.env.AUTH_PASSWORD;
}
