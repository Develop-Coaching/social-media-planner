import { resolvePublishPayload } from "@/lib/scheduled-posts";
import { dispatchPreparedInstagram, metaFbConfigured, metaIgConfigured, prepareInstagramForPublisher, publishToFacebook } from "@/lib/publish/meta";
import { dispatchPreparedLinkedIn, linkedInConfigured, prepareLinkedInForPublisher } from "@/lib/publish/linkedin";
import type { PublishPayload, PublishResult, ScheduledPost } from "@/lib/publish/types";
import type { ClaimedPublisherDelivery } from "./queue-types";
import type { AdapterOutcome, AdapterRegistry, PrepareOutcome, ProviderCheckpoint, PublishRequest, PublisherAdapter } from "./runtime-types";

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
    platforms: [delivery.platform], scheduled_at: delivery.scheduled_at, status: "publishing",
    platform_post_ids: {}, error: null, retry_count: delivery.attempt_number - 1,
    created_at: delivery.scheduled_at, updated_at: delivery.scheduled_at, published_at: null,
  };
}

function toOutcome(result: PublishResult): AdapterOutcome {
  if (result.success && result.externalId) {
    return {
      kind: "delivered", platformPostId: result.externalId, liveUrl: result.externalUrl,
      providerResponse: { platform: result.platform, externalId: result.externalId },
    };
  }
  return { kind: "indeterminate", error: result.error ?? "Provider returned no durable result" };
}

function phasedAdapter(input: {
  configured: () => boolean;
  prepare(payload: PublishPayload, checkpoint: ProviderCheckpoint): Promise<PrepareOutcome>;
  dispatch(payload: PublishPayload, checkpoint: ProviderCheckpoint): Promise<PublishResult>;
}): PublisherAdapter {
  const prepared = new Map<string, PublishPayload>();
  return {
    async prepare(request) {
      if (!input.configured()) return { kind: "safe_retry", error: `${request.delivery.platform} credentials are not configured` };
      let payload: PublishPayload;
      try {
        payload = await resolvePublishPayload(asLegacyPost(request.delivery));
      } catch (error) {
        return { kind: "safe_retry", error: `Media preflight failed: ${error instanceof Error ? error.message : String(error)}` };
      }
      const result = await input.prepare(payload, request.delivery.provider_reconciliation_metadata);
      if (result.kind === "ready") prepared.set(request.requestFingerprint, payload);
      else prepared.delete(request.requestFingerprint);
      return result;
    },
    async dispatch(request, checkpoint) {
      const payload = prepared.get(request.requestFingerprint);
      prepared.delete(request.requestFingerprint);
      if (!payload) return { kind: "indeterminate", error: "Prepared media payload was lost before public dispatch" };
      return toOutcome(await input.dispatch(payload, checkpoint));
    },
  };
}

export function createProductionAdapters(): AdapterRegistry {
  return {
    instagram: phasedAdapter({
      configured: metaIgConfigured,
      prepare: prepareInstagramForPublisher,
      dispatch: (_payload, checkpoint) => dispatchPreparedInstagram(checkpoint),
    }),
    facebook: phasedAdapter({
      configured: metaFbConfigured,
      prepare: async () => ({ kind: "ready" }),
      dispatch: (payload) => publishToFacebook(payload),
    }),
    linkedin: phasedAdapter({
      configured: linkedInConfigured,
      prepare: prepareLinkedInForPublisher,
      dispatch: dispatchPreparedLinkedIn,
    }),
  };
}

export class SyntheticAdapter implements PublisherAdapter {
  prepareCalls: PublishRequest[] = [];
  dispatchCalls: Array<{ request: PublishRequest; checkpoint: ProviderCheckpoint }> = [];
  constructor(
    private readonly preparations: PrepareOutcome[] = [{ kind: "ready" }],
    private readonly outcomes: AdapterOutcome[] = [],
  ) {}
  async prepare(request: PublishRequest): Promise<PrepareOutcome> {
    this.prepareCalls.push(request);
    return this.preparations.shift() ?? { kind: "ready" };
  }
  async dispatch(request: PublishRequest, checkpoint: ProviderCheckpoint): Promise<AdapterOutcome> {
    this.dispatchCalls.push({ request, checkpoint });
    return this.outcomes.shift() ?? { kind: "indeterminate", error: "No synthetic outcome configured" };
  }
}
