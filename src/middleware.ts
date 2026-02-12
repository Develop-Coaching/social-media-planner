import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getSecret, COOKIE_NAME } from "@/lib/auth";

export async function middleware(request: NextRequest) {
  // If ADMIN_PASSWORD is not set, auth is disabled — allow everything
  if (!process.env.ADMIN_PASSWORD) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  // Allow login page, setup page, auth API routes, signup pages, and onboarding
  if (
    pathname === "/login" ||
    pathname === "/setup" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/signup/") ||
    pathname === "/api/stripe/webhook"
  ) {
    return NextResponse.next();
  }

  // Allow static assets and Next.js internals (scoped to non-API paths)
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    (!pathname.startsWith("/api/") && (
      pathname.endsWith(".ico") ||
      pathname.endsWith(".svg") ||
      pathname.endsWith(".png") ||
      pathname.endsWith(".jpg")
    ))
  ) {
    return NextResponse.next();
  }

  // Check for valid session cookie
  const token = request.cookies.get(COOKIE_NAME)?.value;

  if (!token) {
    return redirectToLogin(request);
  }

  try {
    const { payload } = await jwtVerify(token, getSecret());

    // If user hasn't completed onboarding, redirect to onboarding
    // (allow onboarding page, its API, and auth routes through)
    if (
      payload.onboardingCompleted === false &&
      pathname !== "/onboarding" &&
      !pathname.startsWith("/api/onboarding") &&
      !pathname.startsWith("/api/auth/")
    ) {
      const onboardingUrl = new URL("/onboarding", request.url);
      return NextResponse.redirect(onboardingUrl);
    }

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
