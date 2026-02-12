import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { markOnboardingComplete } from "@/lib/users";
import { createToken, COOKIE_NAME } from "@/lib/auth";
import {
  OnboardingResponses,
  saveOnboardingResponses,
  createCompanyFromOnboarding,
  createMemoryFromOnboarding,
} from "@/lib/onboarding";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { userId, role } = await requireAuth();
    const responses = (await request.json()) as OnboardingResponses;

    if (!responses.businessName?.trim()) {
      return NextResponse.json({ error: "Business name is required" }, { status: 400 });
    }

    // 1. Create company from answers
    const companyId = await createCompanyFromOnboarding(userId, responses);

    // 2. Build and save memory file from answers
    await createMemoryFromOnboarding(userId, companyId, responses);

    // 3. Save raw responses
    await saveOnboardingResponses(userId, responses);

    // 4. Mark onboarding complete
    await markOnboardingComplete(userId);

    // 5. Re-issue JWT with onboardingCompleted=true
    const token = await createToken(userId, role, true);
    const res = NextResponse.json({ success: true, companyId });
    res.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });

    return res;
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("Onboarding error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Onboarding failed" },
      { status: 500 }
    );
  }
}
