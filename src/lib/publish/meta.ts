// Meta Graph adapter — direct publish to Instagram + Facebook.
// IG single-image: POST /{ig-user-id}/media → POST /{ig-user-id}/media_publish
// IG carousel:    create child containers (is_carousel_item=true) → parent with media_type=CAROUSEL → publish
// IG reel:        POST /{ig-user-id}/media with media_type=REELS,video_url → poll status_code=FINISHED → publish
// FB:             POST /{page-id}/photos (image), /{page-id}/videos with file_url (video), /{page-id}/feed (text)

import type { PublishPayload, PublishResult } from "./types";

const GRAPH = "https://graph.facebook.com/v21.0";

export function metaIgConfigured(): boolean {
  return !!(process.env.META_ACCESS_TOKEN && process.env.META_IG_USER_ID);
}

export function metaFbConfigured(): boolean {
  return !!(
    (process.env.META_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN) &&
    process.env.META_FB_PAGE_ID
  );
}

async function fetchIgPermalink(mediaId: string, token: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${GRAPH}/${mediaId}?fields=permalink&access_token=${token}`);
    const json = (await res.json()) as { permalink?: string };
    return json.permalink;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------------

export async function publishToInstagram(payload: PublishPayload): Promise<PublishResult> {
  if (!metaIgConfigured()) {
    return { success: false, platform: "instagram", error: "Instagram not configured (META_ACCESS_TOKEN / META_IG_USER_ID)" };
  }

  if (payload.isReel || payload.videoUrl) {
    if (!payload.videoUrl) {
      return { success: false, platform: "instagram", error: "IG reel requires a video URL" };
    }
    return publishInstagramReel(payload, payload.videoUrl);
  }

  if (payload.imageUrls.length > 1) {
    return publishInstagramCarousel(payload);
  }

  const imageUrl = payload.imageUrls[0];
  if (!imageUrl) {
    return { success: false, platform: "instagram", error: "Instagram requires an image — none on post" };
  }
  return publishInstagramSingle(payload, imageUrl);
}

async function igCreate(body: Record<string, unknown>): Promise<{ id?: string; raw: unknown; ok: boolean }> {
  const token = process.env.META_ACCESS_TOKEN!;
  const igUserId = process.env.META_IG_USER_ID!;
  const res = await fetch(`${GRAPH}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, access_token: token }),
  });
  const json = (await res.json()) as { id?: string };
  return { id: json.id, raw: json, ok: res.ok && !!json.id };
}

async function igPublish(creationId: string, platform: "instagram" = "instagram"): Promise<PublishResult> {
  const token = process.env.META_ACCESS_TOKEN!;
  const igUserId = process.env.META_IG_USER_ID!;
  const res = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: creationId, access_token: token }),
  });
  const json = (await res.json()) as { id?: string };
  if (!res.ok || !json.id) {
    return { success: false, platform, error: `IG publish failed: ${JSON.stringify(json)}` };
  }
  return {
    success: true,
    platform,
    externalId: json.id,
    externalUrl: await fetchIgPermalink(json.id, token),
  };
}

async function publishInstagramSingle(payload: PublishPayload, imageUrl: string): Promise<PublishResult> {
  const create = await igCreate({ image_url: imageUrl, caption: payload.caption });
  if (!create.ok) {
    return { success: false, platform: "instagram", error: `IG single create failed: ${JSON.stringify(create.raw)}` };
  }
  return igPublish(create.id!);
}

async function publishInstagramCarousel(payload: PublishPayload): Promise<PublishResult> {
  const images = payload.imageUrls.slice(0, 10);
  if (images.length < 2) {
    return { success: false, platform: "instagram", error: `IG carousel needs 2-10 images, got ${images.length}` };
  }

  const childIds: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const child = await igCreate({ image_url: images[i], is_carousel_item: true });
    if (!child.ok) {
      return { success: false, platform: "instagram", error: `IG carousel child ${i + 1} create failed: ${JSON.stringify(child.raw)}` };
    }
    childIds.push(child.id!);
  }

  const parent = await igCreate({
    media_type: "CAROUSEL",
    children: childIds.join(","),
    caption: payload.caption,
  });
  if (!parent.ok) {
    return { success: false, platform: "instagram", error: `IG carousel parent create failed: ${JSON.stringify(parent.raw)}` };
  }
  return igPublish(parent.id!);
}

async function publishInstagramReel(payload: PublishPayload, videoUrl: string): Promise<PublishResult> {
  const token = process.env.META_ACCESS_TOKEN!;

  const create = await igCreate({
    media_type: "REELS",
    video_url: videoUrl,
    caption: payload.caption,
    share_to_feed: true,
  });
  if (!create.ok) {
    return { success: false, platform: "instagram", error: `IG reel create failed: ${JSON.stringify(create.raw)}` };
  }

  // Poll status_code until FINISHED (or ERROR). Reels can take 60-300s to process.
  const containerId = create.id!;
  const deadline = Date.now() + 4 * 60 * 1000; // stay under serverless maxDuration
  let status = "IN_PROGRESS";
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 7000));
    const sres = await fetch(`${GRAPH}/${containerId}?fields=status_code,status&access_token=${token}`);
    const sjson = (await sres.json()) as { status_code?: string; status?: string };
    status = sjson.status_code || sjson.status || "IN_PROGRESS";
    if (status === "FINISHED") break;
    if (status === "ERROR" || status === "EXPIRED") {
      return { success: false, platform: "instagram", error: `IG reel processing failed: ${JSON.stringify(sjson)}` };
    }
  }
  if (status !== "FINISHED") {
    return { success: false, platform: "instagram", error: `IG reel processing timed out (last status: ${status})` };
  }

  return igPublish(containerId);
}

// ---------------------------------------------------------------------------
// Facebook Page
// ---------------------------------------------------------------------------

export async function publishToFacebook(payload: PublishPayload): Promise<PublishResult> {
  if (!metaFbConfigured()) {
    return { success: false, platform: "facebook", error: "Facebook not configured (META_PAGE_ACCESS_TOKEN / META_FB_PAGE_ID)" };
  }

  const token = process.env.META_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN!;
  const pageId = process.env.META_FB_PAGE_ID!;
  const imageUrl = payload.imageUrls[0];

  let endpoint: string;
  const body: Record<string, unknown> = { access_token: token, published: true };

  if (payload.videoUrl) {
    endpoint = `${GRAPH}/${pageId}/videos`;
    body.file_url = payload.videoUrl;
    body.description = payload.caption;
  } else if (imageUrl) {
    endpoint = `${GRAPH}/${pageId}/photos`;
    body.url = imageUrl;
    body.caption = payload.caption;
  } else {
    endpoint = `${GRAPH}/${pageId}/feed`;
    body.message = payload.caption;
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as { id?: string; post_id?: string };
  if (!res.ok || !(json.id || json.post_id)) {
    return { success: false, platform: "facebook", error: `FB publish failed: ${JSON.stringify(json)}` };
  }

  const externalId = json.post_id || json.id!;
  return {
    success: true,
    platform: "facebook",
    externalId,
    externalUrl: `https://facebook.com/${externalId}`,
  };
}
