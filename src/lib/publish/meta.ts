// Meta Graph adapter — direct publish to Instagram + Facebook.
// IG single-image: POST /{ig-user-id}/media → POST /{ig-user-id}/media_publish
// IG carousel:    create child containers (is_carousel_item=true) → parent with media_type=CAROUSEL → publish
// IG reel:        POST /{ig-user-id}/media with media_type=REELS,video_url → poll status_code=FINISHED → publish
// FB:             POST /{page-id}/photos (image), /{page-id}/videos with file_url (video), /{page-id}/feed (text)

import type { PublishPayload, PublishResult } from "./types";

export type InstagramPreparation =
  | { kind: "ready"; checkpoint: { instagram_creation_id: string; instagram_media_kind: "image" | "carousel" | "reel" } }
  | { kind: "safe_retry" | "permanent_failure" | "indeterminate"; error: string; checkpoint?: { instagram_creation_id: string; instagram_media_kind: "image" | "carousel" | "reel" } };

function graphBase(): string {
  const version = process.env.META_GRAPH_VERSION || "v24.0";
  if (!/^v\d+\.\d+$/.test(version)) throw new Error("META_GRAPH_VERSION must look like v24.0");
  return `https://graph.facebook.com/${version}`;
}

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
    const res = await fetch(`${graphBase()}/${mediaId}?fields=permalink&access_token=${token}`, { cache: "no-store" });
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
  const res = await fetch(`${graphBase()}/${igUserId}/media`, {
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
  const res = await fetch(`${graphBase()}/${igUserId}/media_publish`, {
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

  // Resume a container from a previous tick when one exists; processing
  // continues on Meta's side between ticks, so re-creating would restart it.
  let containerId = payload.igContainerId;
  if (!containerId) {
    const create = await igCreate({
      media_type: "REELS",
      video_url: videoUrl,
      caption: payload.caption,
      share_to_feed: true,
      ...(payload.coverUrl ? { cover_url: payload.coverUrl } : {}),
    });
    if (!create.ok) {
      return { success: false, platform: "instagram", error: `IG reel create failed: ${JSON.stringify(create.raw)}` };
    }
    containerId = create.id!;
  }

  // Poll status_code until FINISHED (or ERROR). Processing time is highly
  // variable (observed 33s to >4min for the same file), so a closed poll
  // window hands the container back via pendingContainerId for the next tick.
  // cache: "no-store" is load-bearing: without it, Next.js's fetch Data Cache
  // can pin the first IN_PROGRESS response for this URL and every later poll
  // (across ticks too, same URL) replays it, so FINISHED is never observed.
  const deadline = Date.now() + 4 * 60 * 1000; // stay under serverless maxDuration
  let status = "IN_PROGRESS";
  let lastReadError: string | null = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 7000));
    const sres = await fetch(`${graphBase()}/${containerId}?fields=status_code,status&access_token=${token}`, { cache: "no-store" });
    const sjson = (await sres.json()) as { status_code?: string; status?: string; error?: unknown };
    if (sjson.error) {
      // A failed read is not IN_PROGRESS — remember it and keep trying, so a
      // broken token or rate limit surfaces in the error text instead of
      // masquerading as slow processing.
      lastReadError = JSON.stringify(sjson.error).slice(0, 300);
      continue;
    }
    status = sjson.status_code || sjson.status || "IN_PROGRESS";
    if (status === "FINISHED") break;
    if (status === "ERROR" || status === "EXPIRED") {
      // Terminal container state — don't hand it back for resumption.
      return { success: false, platform: "instagram", error: `IG reel processing failed: ${JSON.stringify(sjson)}` };
    }
  }
  if (status !== "FINISHED") {
    return {
      success: false,
      platform: "instagram",
      pendingContainerId: containerId,
      error:
        `IG reel still processing (status: ${status}), resuming next tick` +
        (lastReadError ? ` [status reads failing: ${lastReadError}]` : ""),
    };
  }

  return igPublish(containerId);
}

export async function prepareInstagramForPublisher(
  payload: PublishPayload,
  existing: Record<string, unknown>,
  options: { fetcher?: typeof fetch; sleep?: (milliseconds: number) => Promise<void>; maxPolls?: number } = {},
): Promise<InstagramPreparation> {
  const priorId = typeof existing.instagram_creation_id === "string" ? existing.instagram_creation_id : null;
  const priorKind = existing.instagram_media_kind;
  if (priorId) {
    if (priorKind !== "image" && priorKind !== "carousel" && priorKind !== "reel") {
      return { kind: "permanent_failure", error: "Instagram checkpoint has an invalid media kind" };
    }
    const checkpoint: { instagram_creation_id: string; instagram_media_kind: "image" | "carousel" | "reel" } = {
      instagram_creation_id: priorId,
      instagram_media_kind: priorKind,
    };
    if (priorKind !== "reel") return { kind: "ready", checkpoint };
    const fetcher = options.fetcher ?? fetch;
    const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    const maxPolls = options.maxPolls ?? 34;
    for (let attempt = 0; attempt < maxPolls; attempt++) {
      try {
        const token = process.env.META_ACCESS_TOKEN!;
        const response = await fetcher(`${graphBase()}/${encodeURIComponent(priorId)}?fields=status_code,status&access_token=${encodeURIComponent(token)}`, { cache: "no-store" });
        if (!response.ok) return { kind: "indeterminate", error: `Instagram container status read failed (${response.status})`, checkpoint };
        const body = (await response.json()) as { status_code?: string; status?: string };
        const status = body.status_code || body.status || "IN_PROGRESS";
        if (status === "FINISHED") return { kind: "ready", checkpoint };
        if (status === "ERROR" || status === "EXPIRED") return { kind: "permanent_failure", error: `Instagram container reached ${status}`, checkpoint };
      } catch {
        return { kind: "indeterminate", error: "Instagram container status transport failed", checkpoint };
      }
      if (attempt + 1 < maxPolls) await sleep(7000);
    }
    return { kind: "indeterminate", error: "Instagram container readiness timed out", checkpoint };
  }

  if (payload.isReel || payload.videoUrl) {
    if (!payload.videoUrl) return { kind: "permanent_failure", error: "Instagram reel requires a video URL" };
    const create = await igCreate({
      media_type: "REELS", video_url: payload.videoUrl, caption: payload.caption, share_to_feed: true,
      ...(payload.coverUrl ? { cover_url: payload.coverUrl } : {}),
    });
    if (!create.ok) return { kind: "safe_retry", error: `Instagram reel prepare failed: ${JSON.stringify(create.raw)}` };
    return {
      kind: "safe_retry",
      error: "Instagram reel container created; readiness will resume from checkpoint",
      checkpoint: { instagram_creation_id: create.id!, instagram_media_kind: "reel" },
    };
  }
  if (payload.imageUrls.length > 1) {
    const childIds: string[] = [];
    for (const imageUrl of payload.imageUrls.slice(0, 10)) {
      const child = await igCreate({ image_url: imageUrl, is_carousel_item: true });
      if (!child.ok) return { kind: "safe_retry", error: `Instagram carousel child prepare failed: ${JSON.stringify(child.raw)}` };
      childIds.push(child.id!);
    }
    const parent = await igCreate({ media_type: "CAROUSEL", children: childIds.join(","), caption: payload.caption });
    if (!parent.ok) return { kind: "safe_retry", error: `Instagram carousel prepare failed: ${JSON.stringify(parent.raw)}` };
    return { kind: "ready", checkpoint: { instagram_creation_id: parent.id!, instagram_media_kind: "carousel" } };
  }
  const imageUrl = payload.imageUrls[0];
  if (!imageUrl) return { kind: "permanent_failure", error: "Instagram delivery has no publishable media" };
  const create = await igCreate({ image_url: imageUrl, caption: payload.caption });
  if (!create.ok) return { kind: "safe_retry", error: `Instagram image prepare failed: ${JSON.stringify(create.raw)}` };
  return { kind: "ready", checkpoint: { instagram_creation_id: create.id!, instagram_media_kind: "image" } };
}

export async function dispatchPreparedInstagram(existing: Record<string, unknown>): Promise<PublishResult> {
  const creationId = existing.instagram_creation_id;
  if (typeof creationId !== "string" || !creationId) {
    return { success: false, platform: "instagram", error: "Instagram dispatch checkpoint is missing creation ID" };
  }
  return igPublish(creationId);
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
    endpoint = `${graphBase()}/${pageId}/videos`;
    body.file_url = payload.videoUrl;
    body.description = payload.caption;
  } else if (imageUrl) {
    endpoint = `${graphBase()}/${pageId}/photos`;
    body.url = imageUrl;
    body.caption = payload.caption;
  } else {
    endpoint = `${graphBase()}/${pageId}/feed`;
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
  let permalink: string | undefined;
  try {
    const read = await fetch(`${graphBase()}/${encodeURIComponent(externalId)}?fields=permalink_url&access_token=${encodeURIComponent(token)}`, { cache: "no-store" });
    if (read.ok) permalink = ((await read.json()) as { permalink_url?: string }).permalink_url;
  } catch {
    // The provider ID is durable even if the optional canonical URL read fails.
  }
  return {
    success: true,
    platform: "facebook",
    externalId,
    externalUrl: permalink,
  };
}
