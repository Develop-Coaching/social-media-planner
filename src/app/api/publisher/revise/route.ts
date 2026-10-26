import { NextRequest, NextResponse } from "next/server";
import { requireAgentOrAdmin, AuthError } from "@/lib/auth-helpers";
import { resolveCompanyAccess, CompanyAccessError } from "@/lib/company-access";
import { NativeIngestionValidationError, publisherRpcStatus } from "@/lib/publisher/native-ingestion";
import { parseNativeRevisionBody, reviseNativePublisherContent } from "@/lib/publisher/native-revision";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { userId, role } = await requireAgentOrAdmin();
    const body = parseNativeRevisionBody(await request.json());
    const access = await resolveCompanyAccess(userId, role, body.companyId);
    return NextResponse.json(await reviseNativePublisherContent({
      ...body, userId: access.effectiveUserId, actor: `publisher-api:${userId}`,
    }));
  } catch (error) {
    if (error instanceof AuthError || error instanceof CompanyAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof NativeIngestionValidationError || error instanceof SyntaxError) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400 });
    }
    const status = publisherRpcStatus(error);
    if (status) return NextResponse.json({ error: error instanceof Error ? error.message : "Publisher request failed" }, { status });
    console.error("native publisher revision failed", error);
    return NextResponse.json({ error: "Unable to revise publisher content" }, { status: 503 });
  }
}
