import { NextRequest, NextResponse } from "next/server";
import { requireAgentOrAdmin, AuthError } from "@/lib/auth-helpers";
import { resolveCompanyAccess, CompanyAccessError } from "@/lib/company-access";
import { NativeIngestionValidationError, parseNativeReleaseBody, publisherRpcStatus, releaseNativePublisherContent } from "@/lib/publisher/native-ingestion";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { userId, role } = await requireAgentOrAdmin();
    const body = parseNativeReleaseBody(await request.json());
    const access = await resolveCompanyAccess(userId, role, body.companyId);
    return NextResponse.json(await releaseNativePublisherContent({
      ...body, userId: access.effectiveUserId, actor: `publisher-api:${userId}`,
    }));
  } catch (error) {
    if (error instanceof AuthError || error instanceof CompanyAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof NativeIngestionValidationError || error instanceof SyntaxError) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400 });
    }
    const rpcStatus = publisherRpcStatus(error);
    if (rpcStatus) return NextResponse.json({ error: error instanceof Error ? error.message : "Publisher request failed" }, { status: rpcStatus });
    console.error("native publisher release failed", error);
    return NextResponse.json({ error: "Unable to release publisher content" }, { status: 503 });
  }
}
