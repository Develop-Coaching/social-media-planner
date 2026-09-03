import type { PublisherDeliveryState } from "./queue-types";

export interface PublisherContentRow {
  id: string;
  legacy_spp_id: string | null;
  content_type: string;
  caption: string;
  scheduled_at: string | null;
  approval_state: "draft" | "approved";
  publishability: "publishable" | "planning_only";
  migration_state: "native" | "migration_frozen" | "active" | "historical";
  legacy_status: string | null;
}

export interface PublisherDeliveryRow {
  id: string;
  content_item_id: string;
  platform: "instagram" | "facebook" | "linkedin";
  state: PublisherDeliveryState;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string | null;
  live_url: string | null;
  last_error: string | null;
  published_at: string | null;
}

export interface OperatorDelivery {
  id: string;
  platform: PublisherDeliveryRow["platform"];
  state: PublisherDeliveryState;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  liveUrl: string | null;
  error: string | null;
  errorCode: "verification_required" | "delivery_failed" | null;
  publishedAt: string | null;
}

export type OperatorQueueState =
  | "scheduled"
  | "frozen"
  | "planning_only"
  | "publishing"
  | "verification_required"
  | "published"
  | "dead_letter"
  | "cancelled"
  | "historical"
  | "blocked";

export interface OperatorQueueItem {
  id: string;
  legacySppId: string | null;
  contentType: string;
  captionPreview: string;
  scheduledAt: string | null;
  approvalState: PublisherContentRow["approval_state"];
  publishability: PublisherContentRow["publishability"];
  migrationState: PublisherContentRow["migration_state"];
  legacyStatus: string | null;
  state: OperatorQueueState;
  nextAction: string;
  deliveries: OperatorDelivery[];
}

const LIVE_HOSTS: Record<PublisherDeliveryRow["platform"], Set<string>> = {
  instagram: new Set(["instagram.com", "www.instagram.com"]),
  facebook: new Set(["facebook.com", "www.facebook.com"]),
  linkedin: new Set(["linkedin.com", "www.linkedin.com"]),
};

export function safeLiveUrl(platform: PublisherDeliveryRow["platform"], value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !LIVE_HOSTS[platform].has(url.hostname.toLowerCase())) return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function sanitizeOperatorText(value: string | null, limit = 300): string | null {
  if (!value) return null;
  const sanitized = value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\bhttps?:\/\/[^\s<>'\"]+/gi, (candidate) => {
      try {
        const url = new URL(candidate);
        url.search = "";
        url.hash = "";
        return url.toString();
      } catch {
        return "[redacted-url]";
      }
    })
    .replace(/\b(?:AWSAccessKeyId|X-Amz-Credential|X-Amz-Signature|GoogleAccessId|Signature|token|apikey|api_key)\s*[=:]\s*[^\s&,;]+/gi, "[redacted-secret]")
    .replace(/\b(?:eyJ[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{48,})\b/g, "[redacted]")
    .trim();
  return sanitized ? sanitized.slice(0, limit) : null;
}

function aggregateState(item: PublisherContentRow, deliveries: PublisherDeliveryRow[]): OperatorQueueState {
  if (item.approval_state !== "approved") return "blocked";
  if (item.publishability === "planning_only") return "planning_only";
  if (item.migration_state === "migration_frozen" || deliveries.some((delivery) => delivery.state === "migration_frozen")) return "frozen";
  if (deliveries.some((delivery) => delivery.state === "verification_required")) return "verification_required";
  if (deliveries.some((delivery) => delivery.state === "dead_letter")) return "dead_letter";
  if (deliveries.some((delivery) => delivery.state === "leased")) return "publishing";
  if (deliveries.length > 0 && deliveries.every((delivery) => delivery.state === "succeeded")) return "published";
  if (deliveries.length > 0 && deliveries.every((delivery) => delivery.state === "cancelled")) return "cancelled";
  if (deliveries.some((delivery) => delivery.state === "pending" || delivery.state === "retryable")) return "scheduled";
  if (deliveries.length > 0 && deliveries.every((delivery) => delivery.state === "historical")) return "historical";
  return "blocked";
}

function nextAction(state: OperatorQueueState, item: PublisherContentRow): string {
  if (item.approval_state !== "approved") return "Approval is required. This item is blocked and cannot dispatch.";
  switch (state) {
    case "scheduled": return "No action needed. The publisher will process this when due.";
    case "frozen": return "Migration safeguard is active. This item cannot publish before the signed-off ownership handoff.";
    case "planning_only": return "Planning reminder only. Publish the LinkedIn article manually; this queue will never dispatch it.";
    case "publishing": return "Publishing is in progress. Do not retry or duplicate it manually.";
    case "verification_required": return "Verify the provider account before deciding whether any retry is safe.";
    case "dead_letter": return "Publishing stopped after a terminal failure. Review the platform error and escalate for a guarded retry.";
    case "published": return "Published. Use the platform links below to verify the live posts.";
    case "cancelled": return "Cancelled. No publisher action will occur.";
    case "historical": return "Historical evidence only. No publisher action will occur.";
    default: return "Unknown state. Publishing is blocked until an operator investigates.";
  }
}

export function toOperatorQueueItems(
  content: PublisherContentRow[],
  deliveryRows: PublisherDeliveryRow[],
): OperatorQueueItem[] {
  const byContent = new Map<string, PublisherDeliveryRow[]>();
  for (const delivery of deliveryRows) {
    const rows = byContent.get(delivery.content_item_id) ?? [];
    rows.push(delivery);
    byContent.set(delivery.content_item_id, rows);
  }

  return content.map((item) => {
    const deliveries = (byContent.get(item.id) ?? []).sort((a, b) => a.platform.localeCompare(b.platform));
    const state = aggregateState(item, deliveries);
    return {
      id: item.id,
      legacySppId: item.legacy_spp_id,
      contentType: item.content_type,
      captionPreview: sanitizeOperatorText(item.caption, 220) ?? `(${item.content_type})`,
      scheduledAt: item.scheduled_at,
      approvalState: item.approval_state,
      publishability: item.publishability,
      migrationState: item.migration_state,
      legacyStatus: sanitizeOperatorText(item.legacy_status, 80),
      state,
      nextAction: nextAction(state, item),
      deliveries: deliveries.map((delivery) => ({
        id: delivery.id,
        platform: delivery.platform,
        state: delivery.state,
        attemptCount: delivery.attempt_count,
        maxAttempts: delivery.max_attempts,
        nextAttemptAt: delivery.next_attempt_at,
        liveUrl: safeLiveUrl(delivery.platform, delivery.live_url),
        error: delivery.last_error
          ? delivery.state === "verification_required"
            ? "Provider verification is required before any retry."
            : "Delivery failed. Review restricted server logs for diagnostic detail."
          : null,
        errorCode: delivery.last_error
          ? delivery.state === "verification_required" ? "verification_required" : "delivery_failed"
          : null,
        publishedAt: delivery.published_at,
      })),
    };
  });
}
