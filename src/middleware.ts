import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const COOKIE_NAME = "pc_session";

function getSecret() {
  return new TextEncoder().encode(
    process.env.AUTH_SECRET || "post-creator-default-secret-change-me"
  );
}

export async function middleware(request: NextRequest) {
  // If AUTH_PASSWORD is not set, auth is disabled — allow everything
  if (!process.env.AUTH_PASSWORD) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  // Allow login page and auth API routes
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/auth/")
  ) {
    return NextResponse.next();
  }

  // Allow static assets and Next.js internals
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname.endsWith(".ico") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg")
  ) {
    return NextResponse.next();
  }

  // Check for valid session cookie
  const token = request.cookies.get(COOKIE_NAME)?.value;

  if (!token) {
    return redirectToLogin(request);
  }

  try {
    await jwtVerify(token, getSecret());
    return NextResponse.next();
  } catch {
    return redirectToLogin(request);
  }
}

function redirectToLogin(request: NextRequest) {
  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Match all paths except static files
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
