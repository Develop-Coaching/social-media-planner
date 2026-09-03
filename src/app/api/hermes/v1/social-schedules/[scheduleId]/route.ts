import { NextRequest } from "next/server";
import { verifyHermesRequest } from "@/lib/hermes-social/auth";
import { hermesErrorResponse, jsonNoStore } from "@/lib/hermes-social/http";
import { getHermesSchedule } from "@/lib/hermes-social/repository";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ scheduleId: string }> }) {
  try {
    const verified = await verifyHermesRequest(request);
    const { scheduleId } = await context.params;
    const result = await getHermesSchedule(verified, scheduleId);
    return result ? jsonNoStore(result) : jsonNoStore({ error: "Hermes schedule not found" }, 404);
  } catch (error) {
    return hermesErrorResponse(error);
  }
}
