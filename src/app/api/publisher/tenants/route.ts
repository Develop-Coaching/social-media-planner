import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { getCompaniesWithAssignments } from "@/lib/companies";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { userId } = await requireAuth();
    const companies = await getCompaniesWithAssignments(userId);
    const tenants = companies.map(({ id, name, isAssigned }) => ({ id, name, isAssigned: !!isAssigned }));
    return NextResponse.json({ tenants }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("publisher tenants read failed", error);
    return NextResponse.json({ error: "Unable to load queue access" }, { status: 503 });
  }
}
