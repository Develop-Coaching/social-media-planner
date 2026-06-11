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
export async function claimDuePosts(limit: number = 5): Promise<ScheduledPost[]> {
  const { data: due, error } = await supabase
    .from("scheduled_posts")
    .select("id")
    .eq("status", "queued")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`claimDuePosts select: ${error.message}`);
  if (!due?.length) return [];

  const claimed: ScheduledPost[] = [];
  for (const row of due) {
    const { data, error: claimError } = await supabase
      .from("scheduled_posts")
      .update({ status: "publishing", updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "queued")
      .select()
      .maybeSingle();
    if (!claimError && data) claimed.push(data as ScheduledPost);
  }
  return claimed;
}

export async function markPostResult(
  id: string,
  result: {
    status: "published" | "failed" | "queued";
    platform_post_ids?: Record<string, string>;
    error?: string | null;
    retry_count?: number;
  }
): Promise<void> {
  const patch: Record<string, unknown> = {
    status: result.status,
    updated_at: new Date().toISOString(),
    error: result.error ?? null,
  };
  if (result.platform_post_ids) patch.platform_post_ids = result.platform_post_ids;
  if (typeof result.retry_count === "number") patch.retry_count = result.retry_count;
  if (result.status === "published") patch.published_at = new Date().toISOString();

  const { error } = await supabase.from("scheduled_posts").update(patch).eq("id", id);
  if (error) throw new Error(`markPostResult: ${error.message}`);
}

// Resolve a scheduled post's media into URLs the platforms can fetch:
// stored image keys become signed Storage URLs; media_urls pass through.
export async function resolvePublishPayload(post: ScheduledPost): Promise<PublishPayload> {
  const imageUrls: string[] = [...(post.media_urls ?? [])];

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
    videoUrl: post.video_url,
    isReel: post.content_type === "reel",
  };
}
