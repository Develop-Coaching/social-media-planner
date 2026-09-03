import { NextRequest } from "next/server";
import { verifyHermesRequest } from "@/lib/hermes-social/auth";
import { hermesErrorResponse, jsonNoStore, parseJsonBody } from "@/lib/hermes-social/http";
import { adoptHermesSchedule } from "@/lib/hermes-social/repository";
import { validateAdoptBody } from "@/lib/hermes-social/validation";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const verified = await verifyHermesRequest(request);
    const input = validateAdoptBody(parseJsonBody(verified.rawBody));
    const result = await adoptHermesSchedule(verified, input);
    return jsonNoStore(result, result.replayed ? 200 : 201);
  } catch (error) {
    return hermesErrorResponse(error);
  }
}
