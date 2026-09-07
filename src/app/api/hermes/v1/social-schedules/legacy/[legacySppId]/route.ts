import { NextRequest } from "next/server";
import { verifyHermesRequest } from "@/lib/hermes-social/auth";
import { hermesErrorResponse, jsonNoStore } from "@/lib/hermes-social/http";
import { previewLegacySchedule } from "@/lib/hermes-social/repository";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ legacySppId: string }> }) {
  try {
    const verified = await verifyHermesRequest(request);
    const { legacySppId } = await context.params;
    const result = await previewLegacySchedule(verified, legacySppId);
    return result ? jsonNoStore(result) : jsonNoStore({ error: "Legacy schedule not found" }, 404);
  } catch (error) {
    return hermesErrorResponse(error);
  }
}
