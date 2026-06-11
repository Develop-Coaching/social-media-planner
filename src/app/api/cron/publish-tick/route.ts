import { NextRequest, NextResponse } from "next/server";
import { claimDuePosts, markPostResult, resolvePublishPayload } from "@/lib/scheduled-posts";
import { publishToInstagram, publishToFacebook } from "@/lib/publish/meta";
import { publishToLinkedIn } from "@/lib/publish/linkedin";
import type { Platform, PublishPayload, PublishResult, ScheduledPost } from "@/lib/publish/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // IG reels can take minutes to process

const MAX_RETRIES = 3;

const PUBLISHERS: Record<Platform, (payload: PublishPayload) => Promise<PublishResult>> = {
  instagram: publishToInstagram,
  facebook: publishToFacebook,
  linkedin: publishToLinkedIn,
};

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let claimed: ScheduledPost[];
  try {
    claimed = await claimDuePosts(5);
  } catch (e) {
    console.error("publish-tick claim failed:", e);
    return NextResponse.json({ error: "claim failed" }, { status: 500 });
  }

  const results: Array<{ id: string; status: string; detail?: string }> = [];

  for (const post of claimed) {
    try {
      const payload = await resolvePublishPayload(post);
      // Skip platforms already published on a previous (partially failed) attempt
      const platformPostIds: Record<string, string> = { ...post.platform_post_ids };
      const errors: string[] = [];

      for (const platform of post.platforms) {
        if (platformPostIds[platform]) continue;
        const publish = PUBLISHERS[platform];
        if (!publish) {
          errors.push(`${platform}: unsupported platform`);
          continue;
        }
        const result = await publish(payload);
        if (result.success && result.externalId) {
          platformPostIds[platform] = result.externalId;
        } else {
          errors.push(`${platform}: ${result.error ?? "unknown error"}`);
        }
      }

      if (errors.length === 0) {
        await markPostResult(post.id, { status: "published", platform_post_ids: platformPostIds });
        results.push({ id: post.id, status: "published" });
      } else {
        const retryCount = post.retry_count + 1;
        const status = retryCount >= MAX_RETRIES ? "failed" : "queued";
        await markPostResult(post.id, {
          status,
          platform_post_ids: platformPostIds,
          error: errors.join(" | ").slice(0, 2000),
          retry_count: retryCount,
        });
        results.push({ id: post.id, status, detail: errors.join(" | ") });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const retryCount = post.retry_count + 1;
      const status = retryCount >= MAX_RETRIES ? "failed" : "queued";
      try {
        await markPostResult(post.id, { status, error: message.slice(0, 2000), retry_count: retryCount });
      } catch (markErr) {
        console.error(`publish-tick: failed to mark post ${post.id}:`, markErr);
      }
      results.push({ id: post.id, status, detail: message });
    }
  }

  return NextResponse.json({ claimed: claimed.length, results });
}
