import { NextRequest, NextResponse } from "next/server";
import { createToken, COOKIE_NAME, isAuthEnabled } from "@/lib/auth";

export async function POST(request: NextRequest) {
  if (!isAuthEnabled()) {
    return NextResponse.json({ error: "Auth not configured" }, { status: 400 });
  }

  try {
    const { password } = (await request.json()) as { password?: string };

    if (!password || password !== process.env.AUTH_PASSWORD) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    const token = await createToken();
    const response = NextResponse.json({ success: true });

    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    return response;
  } catch {
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
