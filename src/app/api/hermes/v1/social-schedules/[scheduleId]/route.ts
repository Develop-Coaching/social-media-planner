import { NextRequest } from "next/server";
import { verifyHermesRequest } from "@/lib/hermes-social/auth";
import { hermesErrorResponse, jsonNoStore } from "@/lib/hermes-social/http";
import { getHermesSchedule } from "@/lib/hermes-social/repository";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ scheduleId: string }> }) {
  try {
    await verifyHermesRequest(request);
    const companyId = request.nextUrl.searchParams.get("companyId")?.trim();
    if (!companyId) return jsonNoStore({ error: "companyId is required" }, 400);
    const { scheduleId } = await context.params;
    const result = await getHermesSchedule(companyId, scheduleId);
    return result ? jsonNoStore(result) : jsonNoStore({ error: "Hermes schedule not found" }, 404);
  } catch (error) {
    return hermesErrorResponse(error);
  }
}
