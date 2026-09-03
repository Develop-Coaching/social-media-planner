import { supabase } from "@/lib/supabase";
import type { Platform, PublishPayload, ScheduledPost } from "@/lib/publish/types";

const BUCKET = "content-images";
const SIGNED_URL_TTL = 60 * 60; // 1h — long enough for IG reel processing

export interface NewScheduledPost {
  user_id: string;
  company_id: string;
  saved_content_id?: string | null;
  item_id?: string | null;
  content_type?: string;
  caption: string;
  image_keys?: string[];
  media_urls?: string[];
  upload_paths?: string[];
  video_url?: string | null;
  platforms: Platform[];
  scheduled_at: string;
}

export async function listScheduledPosts(userId: string, companyId: string): Promise<ScheduledPost[]> {
  const { data, error } = await supabase
    .from("scheduled_posts")
    .select("*")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .order("scheduled_at", { ascending: true });
  if (error) throw new Error(`listScheduledPosts: ${error.message}`);
  return (data ?? []) as ScheduledPost[];
}

export async function createScheduledPost(post: NewScheduledPost): Promise<ScheduledPost> {
  const { data, error } = await supabase
    .from("scheduled_posts")
    .insert({
      ...post,
      image_keys: post.image_keys ?? [],
      media_urls: post.media_urls ?? [],
      upload_paths: post.upload_paths ?? [],
      content_type: post.content_type ?? "post",
    })
    .select()
    .single();
  if (error) throw new Error(`createScheduledPost: ${error.message}`);
  return data as ScheduledPost;
}

export async function updateScheduledPost(
  id: string,
  userId: string,
  companyId: string,
  patch: Partial<Pick<ScheduledPost, "caption" | "platforms" | "scheduled_at" | "status" | "image_keys" | "media_urls" | "video_url">>
): Promise<ScheduledPost | null> {
  const { data, error } = await supabase
    .from("scheduled_posts")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("company_id", companyId)
    // Only still-pending posts can be edited
    .in("status", ["queued", "failed", "cancelled"])
    .select()
    .maybeSingle();
  if (error) throw new Error(`updateScheduledPost: ${error.message}`);
  return data as ScheduledPost | null;
}

export async function cancelScheduledPost(id: string, userId: string, companyId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("scheduled_posts")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .in("status", ["queued", "failed"])
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`cancelScheduledPost: ${error.message}`);
  return !!data;
}

// Claim due posts with an optimistic queued→publishing transition so a
// concurrent tick can't double-publish the same row.
// LinkedIn has no API for creating native articles, so an article row is a
// PLANNING entry: it shows on the calendar and in the posts list, but it must
// never be picked up by the publisher. Without this guard the publisher would
// treat it like any other post and push its caption out as a plain text update,
// because the LinkedIn adapter does not look at content_type at all.
export const NON_PUBLISHABLE_CONTENT_TYPES = ["article"] as const;

export async function claimDuePosts(expectedEpoch: number, limit: number = 5): Promise<ScheduledPost[]> {
  const { data, error } = await supabase.rpc("claim_legacy_spp_posts", {
    p_expected_epoch: expectedEpoch,
    p_limit: limit,
    p_lease_seconds: 420,
    p_now: new Date().toISOString(),
  });
  if (error) throw new Error(`claimDuePosts: ${error.message}`);
  return (data ?? []) as ScheduledPost[];
}

export async function reapExpiredLegacyClaims(expectedEpoch: number, now: Date = new Date()): Promise<
  Array<{ post_id: string; verification_required: boolean }>
> {
  const { data, error } = await supabase.rpc("reap_expired_legacy_spp_leases", {
    p_expected_epoch: expectedEpoch,
    p_now: now.toISOString(),
  });
  if (error) throw new Error(`reapExpiredLegacyClaims: ${error.message}`);
  return (data ?? []) as Array<{ post_id: string; verification_required: boolean }>;
}

export async function markLegacyDispatchStarted(post: ScheduledPost, expectedEpoch: number): Promise<void> {
  if (!post.publisher_lease_token) throw new Error("Legacy claim has no lease token");
  const { data, error } = await supabase.rpc("mark_legacy_spp_dispatch_started", {
    p_post_id: post.id,
    p_lease_token: post.publisher_lease_token,
    p_expected_epoch: expectedEpoch,
  });
  if (error || !data) throw new Error(`markLegacyDispatchStarted: ${error?.message ?? "lease lost"}`);
}

export async function markPostResult(
  post: ScheduledPost,
  expectedEpoch: number,
  result: {
    status: "published" | "failed" | "queued";
    platform_post_ids?: Record<string, string>;
    error?: string | null;
    retry_count?: number;
  }
): Promise<void> {
  if (!post.publisher_lease_token) throw new Error("Legacy claim has no lease token");
  const { data, error } = await supabase.rpc("complete_legacy_spp_claim", {
    p_post_id: post.id,
    p_lease_token: post.publisher_lease_token,
    p_expected_epoch: expectedEpoch,
    p_status: result.status,
    p_platform_post_ids: result.platform_post_ids ?? post.platform_post_ids,
    p_error: result.error ?? null,
    p_retry_count: result.retry_count ?? post.retry_count,
    p_published_at: result.status === "published" ? new Date().toISOString() : null,
  });
  if (error || !data) throw new Error(`markPostResult: ${error?.message ?? "lease lost"}`);
}

// Resolve a scheduled post's media into URLs the platforms can fetch:
// stored image keys become signed Storage URLs; media_urls pass through.
export async function resolvePublishPayload(post: ScheduledPost): Promise<PublishPayload> {
  const imageUrls: string[] = [...(post.media_urls ?? [])];
  let videoUrl: string | null = post.video_url;
  const isVideoType = post.content_type === "reel" || post.content_type === "video";

  // Directly-uploaded media: sign each storage path into a temporary public URL.
  if (post.upload_paths?.length) {
    for (const path of post.upload_paths) {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
      if (!signed?.signedUrl) continue;
      if (isVideoType) videoUrl = videoUrl || signed.signedUrl;
      else imageUrls.push(signed.signedUrl);
    }
  }

  let coverUrl: string | null = null;
  if (post.cover_path) {
    const { data: signed } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(post.cover_path, SIGNED_URL_TTL);
    coverUrl = signed?.signedUrl ?? null;
  }

  if (post.image_keys?.length && post.saved_content_id) {
    const { data: rows } = await supabase
      .from("images")
      .select("key, storage_path")
      .eq("user_id", post.user_id)
      .eq("company_id", post.company_id)
      .eq("saved_content_id", post.saved_content_id)
      .in("key", post.image_keys);

    const byKey = new Map((rows ?? []).map((r) => [r.key, r.storage_path]));
    // Preserve the order of image_keys (matters for carousels)
    for (const key of post.image_keys) {
      const path = byKey.get(key);
      if (!path) continue;
      const { data: signed } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, SIGNED_URL_TTL);
      if (signed?.signedUrl) imageUrls.push(signed.signedUrl);
    }
  }

  return {
    caption: post.caption,
    imageUrls,
    videoUrl,
    coverUrl,
    isReel: isVideoType,
  };
}
