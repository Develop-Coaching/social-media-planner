import { createHash } from "node:crypto";
import type { ClaimedPublisherDelivery } from "./queue-types";

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function requestFingerprint(delivery: ClaimedPublisherDelivery): string {
  return createHash("sha256")
    .update(stable({
      content_item_id: delivery.content_item_id,
      platform: delivery.platform,
      idempotency_key: delivery.idempotency_key,
      content_type: delivery.content_type,
      caption: delivery.caption,
      media: delivery.media,
    }))
    .digest("hex");
}
