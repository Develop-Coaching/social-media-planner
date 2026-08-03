import { NextRequest, NextResponse } from "next/server";
import { claimDuePosts, markPostResult, resolvePublishPayload } from "@/lib/scheduled-posts";
import { publishToInstagram, publishToFacebook } from "@/lib/publish/meta";
import { publishToLinkedIn } from "@/lib/publish/linkedin";
import { sendSlackNotification } from "@/lib/slack";
import { decideTickOutcome, IG_CONTAINER_KEY, IG_CONTAINER_SINCE_KEY } from "@/lib/publish/outcome";
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
  // Watchdog buckets, reported to Slack after the loop: successes are confirmed
  // and failures alert on the FIRST bad attempt (within one ~5-min tick), with a
  // louder alert once retries are exhausted, so a broken token never fails silently.
  const published: ScheduledPost[] = [];
  const waiting: Array<{ post: ScheduledPost; detail: string }> = [];
  const retrying: Array<{ post: ScheduledPost; detail: string; attempt: number }> = [];
  const failed: Array<{ post: ScheduledPost; detail: string }> = [];

  for (const post of claimed) {
    try {
      const payload = await resolvePublishPayload(post);
      // Skip platforms already published on a previous (partially failed) attempt
      const platformPostIds: Record<string, string> = { ...post.platform_post_ids };
      const errors: string[] = [];
      let waitingOnContainer = false;

      for (const platform of post.platforms) {
        if (platformPostIds[platform]) continue;
        const publish = PUBLISHERS[platform];
        if (!publish) {
          errors.push(`${platform}: unsupported platform`);
          continue;
        }
        if (platform === "instagram") {
          payload.igContainerId = platformPostIds[IG_CONTAINER_KEY];
        }
        const result = await publish(payload);
        if (result.success && result.externalId) {
          platformPostIds[platform] = result.externalId;
          if (platform === "instagram") {
            delete platformPostIds[IG_CONTAINER_KEY];
            delete platformPostIds[IG_CONTAINER_SINCE_KEY];
          }
        } else if (result.pendingContainerId) {
          // IG reel container still processing — remember it so the next tick
          // resumes polling instead of re-uploading the video from zero.
          waitingOnContainer = true;
          platformPostIds[IG_CONTAINER_KEY] = result.pendingContainerId;
          if (!platformPostIds[IG_CONTAINER_SINCE_KEY]) {
            platformPostIds[IG_CONTAINER_SINCE_KEY] = new Date().toISOString();
          }
        } else {
          errors.push(`${platform}: ${result.error ?? "unknown error"}`);
          if (platform === "instagram") {
            // Terminal container state — clear it so a retry starts fresh.
            delete platformPostIds[IG_CONTAINER_KEY];
            delete platformPostIds[IG_CONTAINER_SINCE_KEY];
          }
        }
      }

      const sinceRaw = platformPostIds[IG_CONTAINER_SINCE_KEY];
      const sinceMs = sinceRaw ? Date.parse(sinceRaw) : NaN;
      const outcome = decideTickOutcome({
        errors,
        waitingOnContainer,
        containerSinceMs: Number.isNaN(sinceMs) ? null : sinceMs,
        nowMs: Date.now(),
        retryCount: post.retry_count,
        maxRetries: MAX_RETRIES,
      });

      if (outcome.kind === "failed" || outcome.status === "failed") {
        // Abandon the container on terminal failure so a manual re-queue starts clean.
        delete platformPostIds[IG_CONTAINER_KEY];
        delete platformPostIds[IG_CONTAINER_SINCE_KEY];
      }

      await markPostResult(post.id, {
        status: outcome.status,
        platform_post_ids: platformPostIds,
        error: outcome.error ? outcome.error.slice(0, 2000) : null,
        retry_count: outcome.retryCount,
      });
      results.push({ id: post.id, status: outcome.kind, detail: outcome.error ?? undefined });

      if (outcome.kind === "published") published.push(post);
      else if (outcome.kind === "waiting") waiting.push({ post, detail: outcome.error ?? "" });
      else if (outcome.kind === "retrying") retrying.push({ post, detail: outcome.error ?? "", attempt: outcome.retryCount });
      else failed.push({ post, detail: outcome.error ?? "" });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      const retryCount = post.retry_count + 1;
      const status = retryCount >= MAX_RETRIES ? "failed" : "queued";
      try {
        await markPostResult(post.id, { status, error: detail.slice(0, 2000), retry_count: retryCount });
      } catch (markErr) {
        console.error(`publish-tick: failed to mark post ${post.id}:`, markErr);
      }
      results.push({ id: post.id, status, detail });
      if (status === "failed") failed.push({ post, detail });
      else retrying.push({ post, detail, attempt: retryCount });
    }
  }

  const notify = async (text: string) => {
    try {
      const slack = await sendSlackNotification({ text });
      if (!slack.ok) console.error("publish-tick: Slack notify failed:", slack.error);
    } catch (err) {
      console.error("publish-tick: Slack notify threw:", err);
    }
  };
  const snippetOf = (post: ScheduledPost) => post.caption.replace(/\s+/g, " ").slice(0, 80);

  // Terminal failures: retries exhausted, needs a human to reconnect + re-queue.
  if (failed.length > 0) {
    const lines = failed.map(({ post, detail }) =>
      `• *${post.platforms.join(", ")}*: "${snippetOf(post)}..."\n   ${detail.slice(0, 300)}`
    );
    await notify(
      `:rotating_light: *${failed.length} scheduled post${failed.length > 1 ? "s" : ""} failed to publish* ` +
        `(gave up after ${MAX_RETRIES} attempts)\n${lines.join("\n")}\n` +
        `_Reconnect the account in Vercel env, then re-queue the post._`
    );
  }

  // First/interim failures: alerts within minutes but self-heals via auto-retry.
  if (retrying.length > 0) {
    const lines = retrying.map(({ post, detail, attempt }) =>
      `• *${post.platforms.join(", ")}*: "${snippetOf(post)}..."\n   ${detail.slice(0, 300)}\n` +
      `   _attempt ${attempt}/${MAX_RETRIES}, auto-retrying next tick_`
    );
    await notify(
      `:warning: *${retrying.length} scheduled post${retrying.length > 1 ? "s" : ""} hit an error, auto-retrying*\n${lines.join("\n")}`
    );
  }

  // IG still processing a reel: informational only — no action needed, the
  // next tick resumes the same container. Only turns into an alert if the
  // 20-minute cap is hit (which lands in the failed bucket above).
  if (waiting.length > 0) {
    const lines = waiting.map(({ post, detail }) => `• *${post.platforms.join(", ")}*: "${snippetOf(post)}..."\n   ${detail.slice(0, 300)}`);
    await notify(
      `:hourglass_flowing_sand: *${waiting.length} reel${waiting.length > 1 ? "s" : ""} still processing on Instagram, resuming next tick*\n${lines.join("\n")}`
    );
  }

  // Success confirmation: a silent success still gets a positive signal.
  if (published.length > 0) {
    const lines = published.map((post) => `• *${post.platforms.join(", ")}*: "${snippetOf(post)}..."`);
    await notify(
      `:white_check_mark: *${published.length} post${published.length > 1 ? "s" : ""} published*\n${lines.join("\n")}`
    );
  }

  return NextResponse.json({ claimed: claimed.length, results });
}
