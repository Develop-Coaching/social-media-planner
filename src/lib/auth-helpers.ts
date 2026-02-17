import { cookies } from "next/headers";
import { COOKIE_NAME, getUserFromToken, isAuthEnabled, TokenPayload } from "./auth";

const DEFAULT_USER: TokenPayload = { userId: "default", role: "admin" };

export async function requireAuth(): Promise<TokenPayload> {
  // When auth is disabled, use a default user so data goes to data/default/
  if (!isAuthEnabled()) {
    return DEFAULT_USER;
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) {
    throw new AuthError("Not authenticated", 401);
  }
  const payload = await getUserFromToken(token);
  if (!payload) {
    throw new AuthError("Invalid session", 401);
  }
  return payload;
}

export async function requireAdmin(): Promise<TokenPayload> {
  const payload = await requireAuth();
  if (payload.role !== "admin") {
    throw new AuthError("Admin access required", 403);
  }
  return payload;
}

export async function requireAgentOrAdmin(): Promise<TokenPayload> {
  const payload = await requireAuth();
  if (payload.role !== "admin" && payload.role !== "agent") {
    throw new AuthError("Agent or admin access required", 403);
  }
  return payload;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
