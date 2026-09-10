import { NextRequest } from "next/server";
import { verifyHermesRequest } from "@/lib/hermes-social/auth";
import { hermesErrorResponse, jsonNoStore, parseJsonBody } from "@/lib/hermes-social/http";
import { rescheduleHermesQueue } from "@/lib/hermes-social/repository";
import { validateRescheduleBody } from "@/lib/hermes-social/validation";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const verified = await verifyHermesRequest(request);
    const input = validateRescheduleBody(parseJsonBody(verified.rawBody));
    const result = await rescheduleHermesQueue(verified, input);
    
    return jsonNoStore(result);
  } catch (error) {
    return hermesErrorResponse(error);
  }
}
