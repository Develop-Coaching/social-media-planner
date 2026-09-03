import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuth } from "@/lib/auth-helpers";
import { CompanyAccessError, resolveCompanyAccess } from "@/lib/company-access";
import { listScheduledPosts } from "@/lib/scheduled-posts";

export const dynamic = "force-dynamic";

function handleError(error: unknown): NextResponse {
  if (error instanceof AuthError || error instanceof CompanyAccessError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error("scheduled-posts error:", error);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const { userId, role } = await requireAuth();
    const companyId = request.nextUrl.searchParams.get("companyId");
    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 });
    }

    const { effectiveUserId } = await resolveCompanyAccess(userId, role, companyId);
    const posts = await listScheduledPosts(effectiveUserId, companyId);
    return NextResponse.json({ posts });
  } catch (error) {
    return handleError(error);
  }
}

async function retiredWrite(): Promise<NextResponse> {
  try {
    await requireAuth();
    return NextResponse.json(
      { error: "Legacy scheduling writes are retired. Use the controlled publisher workflow." },
      { status: 410 },
    );
  } catch (error) {
    return handleError(error);
  }
}

export async function POST() {
  return retiredWrite();
}

export async function PUT() {
  return retiredWrite();
}

export async function DELETE() {
  return retiredWrite();
}
