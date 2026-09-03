import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { authConfiguration, getSecret, COOKIE_NAME } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Authentication status and the sign-in screen must remain reachable so a
  // broken deployment can explain that it is unavailable. Everything else
  // fails closed before any application or tenant data is touched.
  if (pathname === "/login" || pathname === "/api/auth/status" || isStatic(pathname)) {
    return NextResponse.next();
  }

  if (!authConfiguration().configured) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Authentication is not configured" }, { status: 503 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("configuration", "missing");
    return NextResponse.redirect(loginUrl);
  }

  // Allow login page, setup page, auth API routes, signup pages, and onboarding
  if (
    pathname === "/setup" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/signup/") ||
    pathname === "/api/stripe/webhook" ||
    pathname === "/api/cron/publish-tick" ||
    pathname === "/api/cron/publisher-tick" ||
    pathname === "/api/cron/token-health" ||
    pathname === "/api/health/publisher" ||
    pathname === "/api/analytics/sync"
  ) {
    return NextResponse.next();
  }

  // Allow static assets and Next.js internals (scoped to non-API paths)
  // Check for valid session cookie
  const token = request.cookies.get(COOKIE_NAME)?.value;

  if (!token) {
    return unauthorized(request);
  }

  try {
    const { payload } = await jwtVerify(token, getSecret());

    return NextResponse.next();
  } catch {
    return unauthorized(request);
  }
}

function unauthorized(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

function isStatic(pathname: string): boolean {
  return pathname.startsWith("/_next/") || pathname.startsWith("/favicon") || (
    !pathname.startsWith("/api/") && [".ico", ".svg", ".png", ".jpg", ".jpeg", ".webp"].some((extension) => pathname.endsWith(extension))
  );
}

export const config = {
  matcher: [
    // Match all paths except static files
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
