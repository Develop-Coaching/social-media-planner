import { NextRequest } from "next/server";
import { verifyHermesRequest } from "@/lib/hermes-social/auth";
import { hermesErrorResponse, jsonNoStore } from "@/lib/hermes-social/http";
import { resolveHermesQueue } from "@/lib/hermes-social/repository";
import { validateResolveQuery } from "@/lib/hermes-social/validation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const verified = await verifyHermesRequest(request);
    const input = validateResolveQuery(request.nextUrl.searchParams);
    const result = await resolveHermesQueue(verified, input);
    if (!result) return jsonNoStore({ error: "Queue item not found" }, 404);
    return jsonNoStore(result);
  } catch (error) {
    return hermesErrorResponse(error);
  }
}
