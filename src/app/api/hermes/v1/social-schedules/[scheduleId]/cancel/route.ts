import { NextRequest } from "next/server";
import { verifyHermesRequest } from "@/lib/hermes-social/auth";
import { hermesErrorResponse, jsonNoStore, parseJsonBody } from "@/lib/hermes-social/http";
import { cancelHermesSchedule } from "@/lib/hermes-social/repository";
import { validateCancelBody } from "@/lib/hermes-social/validation";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ scheduleId: string }> }) {
  try {
    const verified = await verifyHermesRequest(request);
    const input = validateCancelBody(parseJsonBody(verified.rawBody));
    const { scheduleId } = await context.params;
    return jsonNoStore(await cancelHermesSchedule(verified, scheduleId, input));
  } catch (error) {
    return hermesErrorResponse(error);
  }
}
