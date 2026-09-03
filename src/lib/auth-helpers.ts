import { cookies } from "next/headers";
import { authConfiguration, COOKIE_NAME, getUserFromToken, TokenPayload } from "./auth";

export async function requireAuth(): Promise<TokenPayload> {
  if (!authConfiguration().configured) {
    throw new AuthError("Authentication is not configured", 503);
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
