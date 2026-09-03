import { describe, expect, it } from "vitest";
import {
  safeLiveUrl,
  sanitizeOperatorText,
  toOperatorQueueItems,
  type PublisherContentRow,
  type PublisherDeliveryRow,
} from "../src/lib/publisher/operator";

const content: PublisherContentRow = {
  id: "content-1",
  legacy_spp_id: "legacy-1",
  content_type: "post",
  caption: "An operator-safe preview",
  scheduled_at: "2026-09-03T01:00:00.000Z",
  approval_state: "approved",
  publishability: "publishable",
  migration_state: "active",
  legacy_status: "queued",
};

function delivery(overrides: Partial<PublisherDeliveryRow> = {}): PublisherDeliveryRow {
  return {
    id: "delivery-1",
    content_item_id: content.id,
    platform: "linkedin",
    state: "pending",
    attempt_count: 0,
    max_attempts: 5,
    next_attempt_at: content.scheduled_at,
    live_url: null,
    last_error: null,
    published_at: null,
    ...overrides,
  };
}

describe("operator queue projection", () => {
  it("makes planning-only content non-dispatchable regardless of delivery state", () => {
    const [item] = toOperatorQueueItems(
      [{ ...content, content_type: "article", publishability: "planning_only" }],
      [delivery({ state: "pending" })],
    );
    expect(item.state).toBe("planning_only");
    expect(item.nextAction).toContain("never dispatch");
  });

  it("surfaces migration freezes before runnable delivery states", () => {
    const [item] = toOperatorQueueItems(
      [{ ...content, migration_state: "migration_frozen" }],
      [delivery({ state: "pending" })],
    );
    expect(item.state).toBe("frozen");
  });

  it("keeps per-platform success, verification, URLs, and sanitized errors", () => {
    const [item] = toOperatorQueueItems([content], [
      delivery({ platform: "facebook", state: "succeeded", live_url: "https://www.facebook.com/posts/123" }),
      delivery({
        id: "delivery-2",
        platform: "linkedin",
        state: "verification_required",
        last_error: "Bearer very-secret-token access_token=also-secret",
      }),
    ]);
    expect(item.state).toBe("verification_required");
    expect(item.deliveries[0].liveUrl).toBe("https://www.facebook.com/posts/123");
    expect(item.deliveries[1].error).not.toContain("very-secret-token");
  });

  it("blocks content with no known delivery transition", () => {
    expect(toOperatorQueueItems([content], [])[0].state).toBe("blocked");
  });

  it("blocks draft content even when a delivery appears runnable", () => {
    const [item] = toOperatorQueueItems([{ ...content, approval_state: "draft" }], [delivery()]);
    expect(item.state).toBe("blocked");
    expect(item.nextAction).toContain("Approval is required");
  });
});

describe("operator output safety", () => {
  it("allows only HTTPS links on the expected platform host", () => {
    expect(safeLiveUrl("instagram", "https://www.instagram.com/p/abc")).toContain("instagram.com");
    expect(safeLiveUrl("instagram", "http://www.instagram.com/p/abc")).toBeNull();
    expect(safeLiveUrl("instagram", "https://instagram.com.evil.test/p/abc")).toBeNull();
    expect(safeLiveUrl("instagram", "javascript:alert(1)")).toBeNull();
    expect(safeLiveUrl("instagram", "https://instagram.com/p/abc?token=secret#fragment")).toBe("https://instagram.com/p/abc");
  });

  it("removes query strings and fragments from cloud signed URLs", () => {
    for (const signedUrl of [
      "https://bucket.s3.amazonaws.com/media.png?X-Amz-Credential=AKIA_TEST&X-Amz-Signature=secret",
      "https://storage.googleapis.com/bucket/media.png?GoogleAccessId=user%40example.com&Signature=secret",
      "https://project.supabase.co/storage/v1/object/sign/media.png?token=secret#private",
    ]) {
      const result = sanitizeOperatorText(`Upload failed at ${signedUrl}`);
      expect(result).not.toMatch(/[?#]/);
      expect(result).not.toMatch(/secret|Credential|Signature|token/i);
    }
  });

  it("redacts common token shapes and caps output", () => {
    const result = sanitizeOperatorText(
      `Provider failed Bearer abc.def.ghi https://api.test/path?access_token=secret&key=private ${"x".repeat(60)}`,
      120,
    );
    expect(result).not.toContain("abc.def.ghi");
    expect(result).not.toContain("secret");
    expect(result?.length).toBeLessThanOrEqual(120);
  });
});
