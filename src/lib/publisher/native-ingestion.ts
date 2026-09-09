import { supabase } from "@/lib/supabase";

export const NATIVE_CONTENT_TYPES = ["post", "carousel", "reel", "video", "quote", "article"] as const;
export const NATIVE_PLATFORMS = ["instagram", "facebook", "linkedin"] as const;
export type NativeContentType = (typeof NATIVE_CONTENT_TYPES)[number];
export type NativePlatform = (typeof NATIVE_PLATFORMS)[number];
export type NativeMediaState = "ready" | "blocked";
export type NativeContentState = "ready" | "blocked";
export interface NativeSourceMetadata {
  graphic_prompt?: string;
  audit?: string;
  audit_index?: number;
  originally_scheduled_for?: string;
  content_fingerprint_sha256?: string;
}

export interface NativeIngestionInput {
  userId: string;
  companyId: string;
  sourceSystem: string;
  sourceId: string;
  contentType: NativeContentType;
  caption: string;
  media: Record<string, unknown>;
  scheduledAt: string;
  platforms: NativePlatform[];
  mediaState: NativeMediaState;
  mediaBlockReason?: string | null;
  contentState: NativeContentState;
  contentBlockReason?: string | null;
  sourceMetadata: NativeSourceMetadata;
}

export interface NativeIngestionResult {
  content_item_id: string;
  created: boolean;
  publishability: "publishable" | "planning_only";
  media_state: NativeMediaState;
  deliveries: Array<{ id: string; platform: NativePlatform; state: string }>;
}

export class NativeIngestionValidationError extends Error {}
export class PublisherRpcError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export function publisherRpcStatus(error: unknown): number | null {
  if (!(error instanceof PublisherRpcError)) return null;
  if (error.code === "23505" || error.code === "55000") return 409;
  if (error.code === "40001") return 409;
  if (error.code === "22023" || error.code === "23514") return 400;
  if (error.code === "P0002" || error.code === "23503") return 404;
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseNativeIngestionBody(value: unknown): Omit<NativeIngestionInput, "userId"> {
  if (!isObject(value)) throw new NativeIngestionValidationError("Request body must be an object");
  const sourceSystem = typeof value.sourceSystem === "string" ? value.sourceSystem.trim().toLowerCase() : "";
  const sourceId = typeof value.sourceId === "string" ? value.sourceId.trim() : "";
  const companyId = typeof value.companyId === "string" ? value.companyId.trim() : "";
  const caption = typeof value.caption === "string" ? value.caption : "";
  const scheduledAt = typeof value.scheduledAt === "string" ? value.scheduledAt : "";
  const contentType = value.contentType;
  const mediaState = value.mediaState;
  const media = value.media;
  if (!companyId || !/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(sourceSystem) || !sourceId || sourceId.length > 200 || /[\u0000-\u001f\u007f]/.test(sourceId)) {
    throw new NativeIngestionValidationError("Invalid company or source provenance");
  }
  if (!NATIVE_CONTENT_TYPES.includes(contentType as NativeContentType)) throw new NativeIngestionValidationError("Invalid content type");
  if (!isObject(media) || JSON.stringify(media).length > 65_536) throw new NativeIngestionValidationError("Invalid media payload");
  if (mediaState !== "ready" && mediaState !== "blocked") throw new NativeIngestionValidationError("Invalid media state");
  if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) throw new NativeIngestionValidationError("Invalid scheduled time");
  if (!Array.isArray(value.platforms) || value.platforms.length === 0
    || value.platforms.some((platform) => !NATIVE_PLATFORMS.includes(platform as NativePlatform))) {
    throw new NativeIngestionValidationError("Invalid platforms");
  }
  const platforms = [...new Set(value.platforms as NativePlatform[])].sort() as NativePlatform[];
  const mediaBlockReason = typeof value.mediaBlockReason === "string" ? value.mediaBlockReason.trim() : null;
  if (mediaBlockReason && mediaBlockReason.length > 500) throw new NativeIngestionValidationError("Media block reason is too long");
  const contentState = value.contentState ?? "ready";
  const contentBlockReason = typeof value.contentBlockReason === "string" ? value.contentBlockReason.trim() : null;
  if (contentState !== "ready" && contentState !== "blocked") throw new NativeIngestionValidationError("Invalid content state");
  if (contentState === "blocked" && (!contentBlockReason || contentBlockReason.length > 500)) throw new NativeIngestionValidationError("Blocked content requires a reason");
  if (contentState === "ready" && contentBlockReason) throw new NativeIngestionValidationError("Ready content cannot have a block reason");
  const sourceMetadata = isObject(value.sourceMetadata) ? value.sourceMetadata : {};
  const allowedMetadata = new Set(["graphic_prompt", "audit", "audit_index", "originally_scheduled_for", "content_fingerprint_sha256"]);
  if (Object.keys(sourceMetadata).some((key) => !allowedMetadata.has(key)) || JSON.stringify(sourceMetadata).length > 8192) {
    throw new NativeIngestionValidationError("Invalid source metadata");
  }
  if ((sourceMetadata.graphic_prompt !== undefined && (typeof sourceMetadata.graphic_prompt !== "string" || sourceMetadata.graphic_prompt.length > 4000))
    || (sourceMetadata.audit !== undefined && (typeof sourceMetadata.audit !== "string" || sourceMetadata.audit.length > 500))
    || (sourceMetadata.audit_index !== undefined && (!Number.isSafeInteger(sourceMetadata.audit_index) || (sourceMetadata.audit_index as number) < 0))
    || (sourceMetadata.originally_scheduled_for !== undefined && (typeof sourceMetadata.originally_scheduled_for !== "string" || Number.isNaN(Date.parse(sourceMetadata.originally_scheduled_for))))
    || (sourceMetadata.content_fingerprint_sha256 !== undefined && (typeof sourceMetadata.content_fingerprint_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sourceMetadata.content_fingerprint_sha256)))) {
    throw new NativeIngestionValidationError("Invalid source metadata");
  }
  if (contentType !== "article" && platforms.includes("linkedin") && caption.length > 3000 && contentState !== "blocked") {
    throw new NativeIngestionValidationError("LinkedIn captions over 3000 characters must be blocked");
  }
  if (contentType === "article" && (platforms.length !== 1 || platforms[0] !== "linkedin" || mediaState !== "ready" || mediaBlockReason || contentState !== "ready")) {
    throw new NativeIngestionValidationError("Articles must be LinkedIn planning-only inventory");
  }
  if (contentType !== "article" && mediaState === "blocked" && !mediaBlockReason) {
    throw new NativeIngestionValidationError("Blocked media requires a reason");
  }
  return { companyId, sourceSystem, sourceId, contentType: contentType as NativeContentType, caption,
    media, scheduledAt: new Date(scheduledAt).toISOString(), platforms, mediaState, mediaBlockReason,
    contentState, contentBlockReason, sourceMetadata: sourceMetadata as NativeSourceMetadata };
}

export async function ingestNativePublisherContent(input: NativeIngestionInput): Promise<NativeIngestionResult> {
  const { data, error } = await supabase.rpc("ingest_native_publisher_content", {
    p_user_id: input.userId,
    p_company_id: input.companyId,
    p_source_system: input.sourceSystem,
    p_source_id: input.sourceId,
    p_content_type: input.contentType,
    p_caption: input.caption,
    p_media: input.media,
    p_scheduled_at: input.scheduledAt,
    p_platforms: input.platforms,
    p_media_state: input.mediaState,
    p_media_block_reason: input.mediaBlockReason ?? null,
    p_content_state: input.contentState,
    p_content_block_reason: input.contentBlockReason ?? null,
    p_source_metadata: input.sourceMetadata,
  });
  if (error) throw new PublisherRpcError(error.code ?? "unknown", error.message);
  if (!data) throw new Error("Native publisher ingestion failed: empty response");
  return data as NativeIngestionResult;
}

export async function attachNativePublisherMedia(input: {
  userId: string;
  companyId: string;
  sourceSystem: string;
  sourceId: string;
  media: Record<string, unknown>;
}): Promise<{ content_item_id: string; media_state: "ready" }> {
  const { data, error } = await supabase.rpc("attach_native_publisher_media", {
    p_user_id: input.userId,
    p_company_id: input.companyId,
    p_source_system: input.sourceSystem,
    p_source_id: input.sourceId,
    p_media: input.media,
  });
  if (error) throw new PublisherRpcError(error.code ?? "unknown", error.message);
  if (!data) throw new Error("Native publisher media attachment failed: empty response");
  return data as { content_item_id: string; media_state: "ready" };
}

export interface NativeReleaseInput {
  userId: string;
  companyId: string;
  sourceSystem: string;
  sourceId: string;
  scheduledAt: string;
  expectedLifecycleVersion: number;
  caption?: string | null;
  media?: Record<string, unknown> | null;
  actor: string;
}

export function parseNativeReleaseBody(value: unknown): Omit<NativeReleaseInput, "userId" | "actor"> {
  if (!isObject(value)) throw new NativeIngestionValidationError("Request body must be an object");
  const companyId = typeof value.companyId === "string" ? value.companyId.trim() : "";
  const sourceSystem = typeof value.sourceSystem === "string" ? value.sourceSystem.trim().toLowerCase() : "";
  const sourceId = typeof value.sourceId === "string" ? value.sourceId.trim() : "";
  const scheduledAt = typeof value.scheduledAt === "string" ? value.scheduledAt : "";
  const expectedLifecycleVersion = value.expectedLifecycleVersion;
  if (!companyId || !/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(sourceSystem) || !sourceId || sourceId.length > 200
    || !scheduledAt || Number.isNaN(Date.parse(scheduledAt)) || !Number.isSafeInteger(expectedLifecycleVersion)
    || (expectedLifecycleVersion as number) < 0) {
    throw new NativeIngestionValidationError("Invalid release identity or schedule");
  }
  if (value.caption !== undefined && typeof value.caption !== "string") throw new NativeIngestionValidationError("Invalid release caption");
  if (value.media !== undefined && value.media !== null && !isObject(value.media)) throw new NativeIngestionValidationError("Invalid release media");
  return { companyId, sourceSystem, sourceId, scheduledAt: new Date(scheduledAt).toISOString(),
    expectedLifecycleVersion: expectedLifecycleVersion as number,
    caption: value.caption as string | undefined, media: value.media as Record<string, unknown> | null | undefined };
}

export async function releaseNativePublisherContent(input: NativeReleaseInput): Promise<{
  content_item_id: string;
  released: boolean;
  scheduled_at: string;
  lifecycle_version: number;
  deliveries: Array<{ id: string; platform: NativePlatform; state: "pending" }>;
}> {
  const { data, error } = await supabase.rpc("release_native_publisher_content", {
    p_user_id: input.userId, p_company_id: input.companyId,
    p_source_system: input.sourceSystem, p_source_id: input.sourceId,
    p_scheduled_at: input.scheduledAt, p_expected_lifecycle_version: input.expectedLifecycleVersion,
    p_caption: input.caption ?? null,
    p_media: input.media ?? null, p_actor: input.actor,
  });
  if (error) throw new PublisherRpcError(error.code ?? "unknown", error.message);
  if (!data) throw new Error("Native publisher release failed: empty response");
  return data as { content_item_id: string; released: boolean; scheduled_at: string; lifecycle_version: number;
    deliveries: Array<{ id: string; platform: NativePlatform; state: "pending" }> };
}
