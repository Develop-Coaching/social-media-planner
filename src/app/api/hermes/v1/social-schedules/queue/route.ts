import { NextRequest } from "next/server";
import { verifyHermesRequest } from "@/lib/hermes-social/auth";
import { hermesErrorResponse, jsonNoStore } from "@/lib/hermes-social/http";
import { listHermesQueue } from "@/lib/hermes-social/repository";
import { validateQueueQuery } from "@/lib/hermes-social/validation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const verified = await verifyHermesRequest(request);
    const input = validateQueueQuery(request.nextUrl.searchParams);
    const result = await listHermesQueue(verified, input);
    
    return jsonNoStore(result);
  } catch (error) {
    return hermesErrorResponse(error);
  }
}
