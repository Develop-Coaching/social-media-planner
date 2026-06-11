// LinkedIn UGC Posts adapter — share text + optional image as a person or organization.
// Docs: https://learn.microsoft.com/linkedin/marketing/integrations/community-management/shares/ugc-post-api

import type { PublishPayload, PublishResult } from "./types";

const LI_API = "https://api.linkedin.com/v2";

export function linkedInConfigured(): boolean {
  return !!(process.env.LINKEDIN_ACCESS_TOKEN && process.env.LINKEDIN_AUTHOR_URN);
}

export async function publishToLinkedIn(payload: PublishPayload): Promise<PublishResult> {
  if (!linkedInConfigured()) {
    return { success: false, platform: "linkedin", error: "LinkedIn not configured (LINKEDIN_ACCESS_TOKEN / LINKEDIN_AUTHOR_URN)" };
  }

  const token = process.env.LINKEDIN_ACCESS_TOKEN!;
  const authorUrn = process.env.LINKEDIN_AUTHOR_URN!; // urn:li:person:XXXX or urn:li:organization:YYYY
  const imageUrl = payload.imageUrls[0];

  let mediaAsset: string | null = null;
  if (imageUrl) {
    try {
      mediaAsset = await uploadImageToLinkedIn(token, authorUrn, imageUrl);
    } catch (err) {
      // Soft-fail: post text-only rather than blocking the publish
      console.warn(`LinkedIn image upload failed, posting text-only: ${err}`);
    }
  }

  const media = mediaAsset
    ? [
        {
          status: "READY",
          description: { text: payload.caption.slice(0, 200) },
          media: mediaAsset,
          title: { text: "Develop Coaching" },
        },
      ]
    : [];

  const res = await fetch(`${LI_API}/ugcPosts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      author: authorUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: payload.caption },
          shareMediaCategory: mediaAsset ? "IMAGE" : "NONE",
          ...(media.length ? { media } : {}),
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return { success: false, platform: "linkedin", error: `LinkedIn ${res.status}: ${errText.slice(0, 400)}` };
  }

  const urn =
    res.headers.get("x-restli-id") ||
    ((await res.json().catch(() => ({}))) as { id?: string }).id;
  return {
    success: true,
    platform: "linkedin",
    externalId: urn || undefined,
    externalUrl: urn ? `https://www.linkedin.com/feed/update/${urn}/` : undefined,
  };
}

async function uploadImageToLinkedIn(token: string, owner: string, imageUrl: string): Promise<string> {
  // 1. Register upload
  const regRes = await fetch(`${LI_API}/assets?action=registerUpload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
        owner,
        serviceRelationships: [
          { relationshipType: "OWNER", identifier: "urn:li:userGeneratedContent" },
        ],
      },
    }),
  });
  if (!regRes.ok) {
    throw new Error(`registerUpload failed: ${await regRes.text()}`);
  }
  const reg = (await regRes.json()) as {
    value: {
      uploadMechanism: Record<string, { uploadUrl: string }>;
      asset: string;
    };
  };
  const uploadUrl =
    reg.value.uploadMechanism["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"].uploadUrl;
  const asset = reg.value.asset;

  // 2. Fetch the image bytes
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`fetch image failed: ${imgRes.status}`);
  const bytes = Buffer.from(await imgRes.arrayBuffer());

  // 3. PUT the bytes to LinkedIn.
  // LinkedIn's upload endpoint 400s with an HTML body unless Content-Type and a
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
  if (!putRes.ok) throw new Error(`asset upload failed: ${putRes.status}`);

  return asset;
}
