import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { resolveCompanyAccess, CompanyAccessError } from "@/lib/company-access";
import { listOperatorQueue } from "@/lib/publisher/operator-repository";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { userId, role } = await requireAuth();
    const companyId = request.nextUrl.searchParams.get("companyId")?.trim();
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 });
    const { effectiveUserId } = await resolveCompanyAccess(userId, role, companyId);
    const items = await listOperatorQueue(effectiveUserId, companyId);
    return NextResponse.json({ items }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthError || error instanceof CompanyAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("publisher queue read failed", error);
    return NextResponse.json({ error: "Unable to load publisher queue" }, { status: 503 });
  }
}
