// LinkedIn adapter — versioned Posts API (/rest/posts + /rest/images).
// The legacy /v2/ugcPosts endpoint rejects person URNs from modern
// OpenID-issued tokens, so we use the current versioned API instead.
// Docs: https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api

import type { PublishPayload, PublishResult } from "./types";

const LI = "https://api.linkedin.com/rest";
function linkedInVersion(): string {
  const version = process.env.LINKEDIN_API_VERSION || "202606";
  if (!/^\d{6}$/.test(version)) throw new Error("LINKEDIN_API_VERSION must be YYYYMM");
  return version;
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": linkedInVersion(),
    "X-Restli-Protocol-Version": "2.0.0",
    "Content-Type": "application/json",
  };
}

// The versioned commentary field treats these characters as reserved; they
// must be backslash-escaped or the post is rejected as invalid text.
function escapeCommentary(text: string): string {
  return text.replace(/[\\<>()\[\]{}@|#*_~]/g, (c) => `\\${c}`);
}

export function linkedInConfigured(): boolean {
  return !!(process.env.LINKEDIN_ACCESS_TOKEN && process.env.LINKEDIN_AUTHOR_URN);
}

async function uploadImage(token: string, owner: string, imageUrl: string): Promise<string> {
  // 1. Initialize the upload
  const initRes = await fetch(`${LI}/images?action=initializeUpload`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ initializeUploadRequest: { owner } }),
  });
  if (!initRes.ok) {
    throw new Error(`initializeUpload ${initRes.status}: ${(await initRes.text()).slice(0, 300)}`);
  }
  const init = (await initRes.json()) as { value: { uploadUrl: string; image: string } };
  const { uploadUrl, image } = init.value;

  // 2. Fetch the source bytes
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`fetch image failed: ${imgRes.status}`);
  const bytes = Buffer.from(await imgRes.arrayBuffer());

  // 3. PUT the bytes to the DMS upload URL.
  // LinkedIn's DMS endpoint 400s with an HTML body unless Content-Type and a
  // real User-Agent are sent explicitly.
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "User-Agent": "PostPilot/1.0",
    },
    body: bytes,
  });
  if (!putRes.ok) throw new Error(`image upload ${putRes.status}`);

  return image; // urn:li:image:...
}

async function uploadVideo(token: string, owner: string, videoUrl: string): Promise<string> {
  const source = await fetch(videoUrl, { cache: "no-store" });
  if (!source.ok) throw new Error(`fetch video failed: ${source.status}`);
  const bytes = Buffer.from(await source.arrayBuffer());
  const initRes = await fetch(`${LI}/videos?action=initializeUpload`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ initializeUploadRequest: { owner, fileSizeBytes: bytes.length, uploadCaptions: false, uploadThumbnail: false } }),
  });
  if (!initRes.ok) throw new Error(`initialize video upload ${initRes.status}: ${(await initRes.text()).slice(0, 300)}`);
  const init = (await initRes.json()) as {
    value?: {
      video?: string;
      uploadToken?: string;
      uploadInstructions?: Array<{ uploadUrl?: string; firstByte?: number; lastByte?: number }>;
    };
  };
  const video = init.value?.video;
  const instructions = init.value?.uploadInstructions ?? [];
  if (!video || instructions.length === 0) throw new Error("LinkedIn video upload initialization returned no resumable instructions");

  const uploadedPartIds: string[] = [];
  for (const instruction of instructions) {
    if (!instruction.uploadUrl || instruction.firstByte === undefined || instruction.lastByte === undefined) {
      throw new Error("LinkedIn video upload instruction was incomplete");
    }
    const part = bytes.subarray(instruction.firstByte, instruction.lastByte + 1);
    const upload = await fetch(instruction.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: part,
    });
    if (!upload.ok) throw new Error(`video part upload failed: ${upload.status}`);
    const etag = upload.headers.get("etag");
    if (!etag) throw new Error("LinkedIn video part upload returned no ETag");
    uploadedPartIds.push(etag);
  }

  const finalize = await fetch(`${LI}/videos?action=finalizeUpload`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ finalizeUploadRequest: { video, uploadToken: init.value?.uploadToken ?? "", uploadedPartIds } }),
  });
  if (!finalize.ok) throw new Error(`finalize video upload ${finalize.status}: ${(await finalize.text()).slice(0, 300)}`);
  return video;
}

export async function publishToLinkedIn(payload: PublishPayload): Promise<PublishResult> {
  if (!linkedInConfigured()) {
    return { success: false, platform: "linkedin", error: "LinkedIn not configured (LINKEDIN_ACCESS_TOKEN / LINKEDIN_AUTHOR_URN)" };
  }

  const token = process.env.LINKEDIN_ACCESS_TOKEN!;
  const authorUrn = process.env.LINKEDIN_AUTHOR_URN!; // urn:li:person:XXXX or urn:li:organization:YYYY

  let videoUrn: string | null = null;
  if (payload.videoUrl) {
    try {
      videoUrn = await uploadVideo(token, authorUrn, payload.videoUrl);
    } catch (err) {
      return { success: false, platform: "linkedin", error: `LinkedIn video upload failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  const imageUrns: string[] = [];
  for (const url of (videoUrn ? [] : payload.imageUrls.slice(0, 9))) {
    try {
      imageUrns.push(await uploadImage(token, authorUrn, url));
    } catch (err) {
      return { success: false, platform: "linkedin", error: `LinkedIn image upload failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  const body: Record<string, unknown> = {
    author: authorUrn,
    commentary: escapeCommentary(payload.caption || ""),
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  if (videoUrn) {
    body.content = { media: { id: videoUrn } };
  } else if (imageUrns.length === 1) {
    body.content = { media: { id: imageUrns[0], altText: "" } };
  } else if (imageUrns.length > 1) {
    body.content = { multiImage: { images: imageUrns.map((id) => ({ id, altText: "" })) } };
  }

  const res = await fetch(`${LI}/posts`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    return { success: false, platform: "linkedin", error: `LinkedIn ${res.status}: ${errText.slice(0, 400)}` };
  }

  const urn = res.headers.get("x-restli-id") || res.headers.get("x-linkedin-id") || undefined;
  if (!urn) {
    return { success: false, platform: "linkedin", error: "LinkedIn returned 201 without x-restli-id" };
  }
  return {
    success: true,
    platform: "linkedin",
    externalId: urn,
    externalUrl: `https://www.linkedin.com/feed/update/${urn}/`,
  };
}
