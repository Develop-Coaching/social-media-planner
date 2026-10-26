import { supabase } from "@/lib/supabase";
import { NativeIngestionValidationError, PublisherRpcError, type NativePlatform } from "./native-ingestion";

export interface NativeRevisionInput {
  requestId: string;
  userId: string;
  companyId: string;
  contentItemId: string;
  expectedEpoch: number;
  expectedLifecycleVersion: number;
  caption: string;
  media: Record<string, unknown>;
  scheduledAt: string;
  approvalReference: string;
  actor: string;
}
export interface NativeRevisionResult {
  content_item_id: string;
  revised: true;
  replayed: boolean;
  scheduled_at: string;
  lifecycle_version: number;
  deliveries: Array<{ id: string; platform: NativePlatform; state: "pending" }>;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u001f\u007f]/;
export function parseNativeRevisionBody(value: unknown): Omit<NativeRevisionInput, "userId" | "actor"> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new NativeIngestionValidationError("Request body must be an object");
  }
  const body = value as Record<string, unknown>;
  const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";
  const approvalReference = typeof body.approvalReference === "string" ? body.approvalReference.trim() : "";
  if (!companyId || companyId.length > 200 || CONTROL.test(companyId)
    || typeof body.requestId !== "string" || !UUID.test(body.requestId)
    || typeof body.contentItemId !== "string" || !UUID.test(body.contentItemId)
    || !Number.isSafeInteger(body.expectedEpoch) || (body.expectedEpoch as number) < 1
    || !Number.isSafeInteger(body.expectedLifecycleVersion) || (body.expectedLifecycleVersion as number) < 0
    || !approvalReference || approvalReference.length > 256 || CONTROL.test(approvalReference)) {
    throw new NativeIngestionValidationError("Invalid revision identity or approval");
  }
  if (typeof body.caption !== "string" || !body.caption.trim() || body.caption.length > 100_000) {
    throw new NativeIngestionValidationError("Invalid revision caption");
  }
  if (typeof body.media !== "object" || body.media === null || Array.isArray(body.media)
    || Buffer.byteLength(JSON.stringify(body.media), "utf8") > 65_536) {
    throw new NativeIngestionValidationError("Invalid revision media");
  }
  if (typeof body.scheduledAt !== "string" || Number.isNaN(Date.parse(body.scheduledAt))) {
    throw new NativeIngestionValidationError("Invalid revision schedule");
  }
  // Future-time and eligibility checks live in the transaction, after exact replay detection.
  return { requestId: body.requestId.toLowerCase(), companyId, contentItemId: body.contentItemId.toLowerCase(),
    expectedEpoch: body.expectedEpoch as number, expectedLifecycleVersion: body.expectedLifecycleVersion as number,
    caption: body.caption, media: body.media as Record<string, unknown>,
    scheduledAt: new Date(body.scheduledAt).toISOString(), approvalReference };
}

export async function reviseNativePublisherContent(input: NativeRevisionInput): Promise<NativeRevisionResult> {
  const { data, error } = await supabase.rpc("revise_native_publisher_content", {
    p_request_id: input.requestId, p_user_id: input.userId, p_company_id: input.companyId,
    p_content_item_id: input.contentItemId, p_expected_epoch: input.expectedEpoch,
    p_expected_lifecycle_version: input.expectedLifecycleVersion, p_caption: input.caption,
    p_media: input.media, p_scheduled_at: input.scheduledAt,
    p_approval_reference: input.approvalReference, p_actor: input.actor,
  });
  if (error) throw new PublisherRpcError(error.code ?? "unknown", error.message);
  if (!data) throw new Error("Native publisher revision failed: empty response");
  return data as NativeRevisionResult;
}
