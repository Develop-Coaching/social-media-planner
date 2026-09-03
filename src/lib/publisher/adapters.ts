import { resolvePublishPayload } from "@/lib/scheduled-posts";
import { metaFbConfigured, metaIgConfigured, publishToInstagram, publishToFacebook } from "@/lib/publish/meta";
import { linkedInConfigured, publishToLinkedIn } from "@/lib/publish/linkedin";
import type { PublishPayload, PublishResult, ScheduledPost } from "@/lib/publish/types";
import type { ClaimedPublisherDelivery } from "./queue-types";
import type { AdapterOutcome, AdapterRegistry, PublishRequest, PublisherAdapter } from "./runtime-types";

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asLegacyPost(delivery: ClaimedPublisherDelivery): ScheduledPost {
  const media = delivery.media;
  return {
    id: delivery.legacy_spp_id ?? delivery.content_item_id,
    user_id: delivery.user_id,
    company_id: delivery.company_id,
    saved_content_id: nullableString(media.saved_content_id),
    item_id: null,
    content_type: delivery.content_type,
    caption: delivery.caption,
    image_keys: strings(media.image_keys),
    media_urls: strings(media.media_urls),
    upload_paths: strings(media.upload_paths),
    video_url: nullableString(media.video_url),
    cover_path: nullableString(media.cover_path),
    platforms: [delivery.platform],
    scheduled_at: delivery.scheduled_at,
    status: "publishing",
    platform_post_ids: {}, error: null, retry_count: delivery.attempt_number - 1,
    created_at: delivery.scheduled_at, updated_at: delivery.scheduled_at, published_at: null,
  };
}

function toOutcome(result: PublishResult): AdapterOutcome {
  if (result.success && result.externalId) {
    return {
      kind: "delivered",
      platformPostId: result.externalId,
      liveUrl: result.externalUrl,
      providerResponse: { platform: result.platform, externalId: result.externalId },
    };
  }
  // A pending IG container is a provider handle that needs a richer checkpoint
  // schema before it can be resumed safely in the replacement queue.
  if (result.pendingContainerId) {
    return { kind: "indeterminate", error: `Provider processing incomplete; reconcile handle ${result.pendingContainerId}` };
  }
  return { kind: "indeterminate", error: result.error ?? "Provider returned no durable result" };
}

function createAdapter(
  configured: () => boolean,
  publish: (payload: PublishPayload) => Promise<PublishResult>,
): PublisherAdapter {
  const prepared = new Map<string, PublishPayload>();
  return {
    async preflight(request) {
      if (!configured()) return { kind: "safe_retry", error: `${request.delivery.platform} credentials are not configured` };
      try {
        const payload = await resolvePublishPayload(asLegacyPost(request.delivery));
        if (request.delivery.platform === "instagram" && !payload.videoUrl && payload.imageUrls.length === 0) {
          return { kind: "permanent_failure", error: "Instagram delivery has no publishable media" };
        }
        prepared.set(request.requestFingerprint, payload);
        return null;
      } catch (error) {
        return { kind: "safe_retry", error: `Media preflight failed: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
    async publish(request) {
      const payload = prepared.get(request.requestFingerprint);
      prepared.delete(request.requestFingerprint);
      if (!payload) return { kind: "indeterminate", error: "Prepared media payload was lost before dispatch" };
      return toOutcome(await publish(payload));
    },
  };
}

export function createProductionAdapters(): AdapterRegistry {
  return {
    instagram: createAdapter(metaIgConfigured, publishToInstagram),
    facebook: createAdapter(metaFbConfigured, publishToFacebook),
    linkedin: createAdapter(linkedInConfigured, publishToLinkedIn),
  };
}

export class SyntheticAdapter implements PublisherAdapter {
  calls: PublishRequest[] = [];
  preflight?: PublisherAdapter["preflight"];
  constructor(private readonly outcomes: AdapterOutcome[]) {}
  async publish(request: PublishRequest): Promise<AdapterOutcome> {
    this.calls.push(request);
    return this.outcomes.shift() ?? { kind: "indeterminate", error: "No synthetic outcome configured" };
  }
}
