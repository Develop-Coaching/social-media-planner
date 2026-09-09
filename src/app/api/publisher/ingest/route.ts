import { NextRequest, NextResponse } from "next/server";
import { requireAgentOrAdmin, AuthError } from "@/lib/auth-helpers";
import { resolveCompanyAccess, CompanyAccessError } from "@/lib/company-access";
import { ingestNativePublisherContent, NativeIngestionValidationError, parseNativeIngestionBody, publisherRpcStatus } from "@/lib/publisher/native-ingestion";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { userId, role } = await requireAgentOrAdmin();
    const body = parseNativeIngestionBody(await request.json());
    const access = await resolveCompanyAccess(userId, role, body.companyId);
    const result = await ingestNativePublisherContent({ ...body, userId: access.effectiveUserId });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof AuthError || error instanceof CompanyAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof NativeIngestionValidationError || error instanceof SyntaxError) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400 });
    }
    const rpcStatus = publisherRpcStatus(error);
    if (rpcStatus) return NextResponse.json({ error: error instanceof Error ? error.message : "Publisher request failed" }, { status: rpcStatus });
    console.error("native publisher ingestion failed", error);
    return NextResponse.json({ error: "Unable to ingest publisher content" }, { status: 503 });
  }
}
