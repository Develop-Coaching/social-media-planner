// Fetches recent post performance directly from the platform APIs and
// upserts into post_metrics. Works for any post on the connected accounts,
// not just ones published through the app.

import { supabase } from "@/lib/supabase";

const GRAPH = "https://graph.facebook.com/v21.0";
const LI_API = "https://api.linkedin.com/v2";
const FETCH_LIMIT = 50;

export interface PostMetric {
  platform: "instagram" | "facebook" | "linkedin";
  platform_post_id: string;
  posted_at: string | null;
  content_snippet: string;
  content_type: string | null;
  permalink: string | null;
  reach: number;
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  video_views: number;
  engagement_rate: number;
}

function engagementRate(m: Omit<PostMetric, "engagement_rate">): number {
  const interactions = m.likes + m.comments + m.shares + m.saves;
  const base = m.reach || m.impressions;
  return base > 0 ? Math.round((interactions / base) * 10000) / 100 : 0;
}

async function upsertMetrics(rows: PostMetric[]): Promise<number> {
  if (!rows.length) return 0;
  const { error } = await supabase
    .from("post_metrics")
    .upsert(
      rows.map((r) => ({ ...r, fetched_at: new Date().toISOString() })),
      { onConflict: "platform,platform_post_id" }
    );
  if (error) throw new Error(`post_metrics upsert: ${error.message}`);
  return rows.length;
}

// ---------------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------------

export async function syncInstagramMetrics(): Promise<{ synced: number; error?: string }> {
  const token = process.env.META_ACCESS_TOKEN;
  const igUserId = process.env.META_IG_USER_ID;
  if (!token || !igUserId) return { synced: 0, error: "Instagram not configured" };

  const fields = "id,caption,permalink,timestamp,media_type,media_product_type,like_count,comments_count";
  const res = await fetch(`${GRAPH}/${igUserId}/media?fields=${fields}&limit=${FETCH_LIMIT}&access_token=${token}`);
  const json = (await res.json()) as {
    data?: Array<{
      id: string;
      caption?: string;
      permalink?: string;
      timestamp?: string;
      media_type?: string;
      media_product_type?: string;
      like_count?: number;
      comments_count?: number;
    }>;
    error?: { message: string };
  };
  if (!res.ok || !json.data) {
    return { synced: 0, error: `IG media fetch failed: ${json.error?.message ?? res.status}` };
  }

  const rows: PostMetric[] = [];
  for (const media of json.data) {
    let reach = 0;
    let saves = 0;
    let shares = 0;
    let videoViews = 0;
    try {
      const isVideo = media.media_type === "VIDEO";
      const metricSet = isVideo ? "reach,saved,shares,plays" : "reach,saved,shares";
      const ires = await fetch(`${GRAPH}/${media.id}/insights?metric=${metricSet}&access_token=${token}`);
      const ijson = (await ires.json()) as {
        data?: Array<{ name: string; values?: Array<{ value?: number }> }>;
      };
      for (const metric of ijson.data ?? []) {
        const value = metric.values?.[0]?.value ?? 0;
        if (metric.name === "reach") reach = value;
        if (metric.name === "saved") saves = value;
        if (metric.name === "shares") shares = value;
        if (metric.name === "plays") videoViews = value;
      }
    } catch {
      // Insights can be unavailable for some media types — keep base counts
    }

    const base = {
      platform: "instagram" as const,
      platform_post_id: media.id,
      posted_at: media.timestamp ?? null,
      content_snippet: (media.caption ?? "").slice(0, 300),
      content_type:
        media.media_type === "CAROUSEL_ALBUM"
          ? "carousel"
          : media.media_type === "VIDEO"
            ? "video"
            : "image",
      permalink: media.permalink ?? null,
      reach,
      impressions: 0,
      likes: media.like_count ?? 0,
      comments: media.comments_count ?? 0,
      shares,
      saves,
      video_views: videoViews,
    };
    rows.push({ ...base, engagement_rate: engagementRate(base) });
  }

  return { synced: await upsertMetrics(rows) };
}

// ---------------------------------------------------------------------------
// Facebook Page
// ---------------------------------------------------------------------------

export async function syncFacebookMetrics(): Promise<{ synced: number; error?: string }> {
  const token = process.env.META_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
  const pageId = process.env.META_FB_PAGE_ID;
  if (!token || !pageId) return { synced: 0, error: "Facebook not configured" };

  const fields =
    "id,message,permalink_url,created_time,likes.summary(true),comments.summary(true),shares,attachments{media_type}";
  const res = await fetch(`${GRAPH}/${pageId}/posts?fields=${fields}&limit=${FETCH_LIMIT}&access_token=${token}`);
  const json = (await res.json()) as {
    data?: Array<{
      id: string;
      message?: string;
      permalink_url?: string;
      created_time?: string;
      likes?: { summary?: { total_count?: number } };
      comments?: { summary?: { total_count?: number } };
      shares?: { count?: number };
      attachments?: { data?: Array<{ media_type?: string }> };
    }>;
    error?: { message: string };
  };
  if (!res.ok || !json.data) {
    return { synced: 0, error: `FB posts fetch failed: ${json.error?.message ?? res.status}` };
  }

  const rows: PostMetric[] = [];
  for (const post of json.data) {
    let reach = 0;
    let impressions = 0;
    try {
      const ires = await fetch(
        `${GRAPH}/${post.id}/insights?metric=post_impressions,post_impressions_unique&access_token=${token}`
      );
      const ijson = (await ires.json()) as {
        data?: Array<{ name: string; values?: Array<{ value?: number }> }>;
      };
      for (const metric of ijson.data ?? []) {
        const value = metric.values?.[0]?.value ?? 0;
        if (metric.name === "post_impressions") impressions = value;
        if (metric.name === "post_impressions_unique") reach = value;
      }
    } catch {
      // insights may need read_insights scope — keep base counts
    }

    const mediaType = post.attachments?.data?.[0]?.media_type?.toLowerCase() ?? null;
    const base = {
      platform: "facebook" as const,
      platform_post_id: post.id,
      posted_at: post.created_time ?? null,
      content_snippet: (post.message ?? "").slice(0, 300),
      content_type: mediaType,
      permalink: post.permalink_url ?? null,
      reach,
      impressions,
      likes: post.likes?.summary?.total_count ?? 0,
      comments: post.comments?.summary?.total_count ?? 0,
      shares: post.shares?.count ?? 0,
      saves: 0,
      video_views: 0,
    };
    rows.push({ ...base, engagement_rate: engagementRate(base) });
  }

  return { synced: await upsertMetrics(rows) };
}

// ---------------------------------------------------------------------------
// LinkedIn organisation
// ---------------------------------------------------------------------------

export async function syncLinkedInMetrics(): Promise<{ synced: number; error?: string }> {
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  const orgUrn = process.env.LINKEDIN_ORGANIZATION_URN;
  if (!token || !orgUrn) return { synced: 0, error: "LinkedIn not configured (LINKEDIN_ORGANIZATION_URN)" };

  const headers = {
    Authorization: `Bearer ${token}`,
    "X-Restli-Protocol-Version": "2.0.0",
    "User-Agent": "PostPilot/1.0",
  };

  const sharesRes = await fetch(
    `${LI_API}/shares?q=owners&owners=${encodeURIComponent(orgUrn)}&count=${FETCH_LIMIT}&sharesPerOwner=${FETCH_LIMIT}`,
    { headers }
  );
  if (!sharesRes.ok) {
    return { synced: 0, error: `LinkedIn shares fetch failed: ${sharesRes.status}` };
  }
  const sharesJson = (await sharesRes.json()) as {
    elements?: Array<{
      id?: string;
      activity?: string;
      created?: { time?: number };
      text?: { text?: string };
    }>;
  };

  const rows: PostMetric[] = [];
  for (const share of sharesJson.elements ?? []) {
    if (!share.id) continue;
    const shareUrn = `urn:li:share:${share.id}`;
    let likes = 0;
    let comments = 0;
    let shares = 0;
    let impressions = 0;
    let reach = 0;
    try {
      const statsRes = await fetch(
        `${LI_API}/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(orgUrn)}&shares[0]=${encodeURIComponent(shareUrn)}`,
        { headers }
      );
      const statsJson = (await statsRes.json()) as {
        elements?: Array<{
          totalShareStatistics?: {
            likeCount?: number;
            commentCount?: number;
            shareCount?: number;
            impressionCount?: number;
            uniqueImpressionsCount?: number;
          };
        }>;
      };
      const stats = statsJson.elements?.[0]?.totalShareStatistics;
      if (stats) {
        likes = stats.likeCount ?? 0;
        comments = stats.commentCount ?? 0;
        shares = stats.shareCount ?? 0;
        impressions = stats.impressionCount ?? 0;
        reach = stats.uniqueImpressionsCount ?? 0;
      }
    } catch {
      // stats need rw_organization_admin scope — keep the share row anyway
    }

    const base = {
      platform: "linkedin" as const,
      platform_post_id: share.id,
      posted_at: share.created?.time ? new Date(share.created.time).toISOString() : null,
      content_snippet: (share.text?.text ?? "").slice(0, 300),
      content_type: "text" as string | null,
      permalink: share.activity ? `https://www.linkedin.com/feed/update/${share.activity}/` : null,
      reach,
      impressions,
      likes,
      comments,
      shares,
      saves: 0,
      video_views: 0,
    };
    rows.push({ ...base, engagement_rate: engagementRate(base) });
  }

  return { synced: await upsertMetrics(rows) };
}

export async function listPostMetrics(): Promise<Array<PostMetric & { fetched_at: string }>> {
  const { data, error } = await supabase
    .from("post_metrics")
    .select("*")
    .order("posted_at", { ascending: false, nullsFirst: false })
    .limit(300);
  if (error) throw new Error(`listPostMetrics: ${error.message}`);
  return (data ?? []) as Array<PostMetric & { fetched_at: string }>;
}
