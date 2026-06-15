// LinkedIn adapter — versioned Posts API (/rest/posts + /rest/images).
// The legacy /v2/ugcPosts endpoint rejects person URNs from modern
// OpenID-issued tokens, so we use the current versioned API instead.
// Docs: https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api

import type { PublishPayload, PublishResult } from "./types";

const LI = "https://api.linkedin.com/rest";
const LI_VERSION = "202606"; // refresh ~yearly; LinkedIn keeps ~12 months active

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": LI_VERSION,
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

export async function publishToLinkedIn(payload: PublishPayload): Promise<PublishResult> {
  if (!linkedInConfigured()) {
    return { success: false, platform: "linkedin", error: "LinkedIn not configured (LINKEDIN_ACCESS_TOKEN / LINKEDIN_AUTHOR_URN)" };
  }

  const token = process.env.LINKEDIN_ACCESS_TOKEN!;
  const authorUrn = process.env.LINKEDIN_AUTHOR_URN!; // urn:li:person:XXXX or urn:li:organization:YYYY

  // Upload images (LinkedIn video isn't supported here yet — those post text-only)
  const imageUrns: string[] = [];
  for (const url of payload.imageUrls.slice(0, 9)) {
    try {
      imageUrns.push(await uploadImage(token, authorUrn, url));
    } catch (err) {
      console.warn(`LinkedIn image upload failed, continuing: ${err}`);
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

  if (imageUrns.length === 1) {
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
  return {
    success: true,
    platform: "linkedin",
    externalId: urn,
    externalUrl: urn ? `https://www.linkedin.com/feed/update/${urn}/` : undefined,
  };
}
