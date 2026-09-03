import { describe, expect, it } from "vitest";
import { requestFingerprint } from "@/lib/publisher/fingerprint";
import { SyntheticAdapter } from "@/lib/publisher/adapters";
import { runPublisherTick } from "@/lib/publisher/worker";
import type { ClaimedPublisherDelivery } from "@/lib/publisher/queue-types";
import type { PublisherRepository } from "@/lib/publisher/runtime-types";

function delivery(overrides: Partial<ClaimedPublisherDelivery> = {}): ClaimedPublisherDelivery {
  return {
    delivery_id: "00000000-0000-4000-8000-000000000001",
    content_item_id: "00000000-0000-4000-8000-000000000002",
    platform: "instagram",
    idempotency_key: "legacy-spp:one:instagram",
    attempt_number: 1,
    lease_token: "00000000-0000-4000-8000-000000000003",
    lease_expires_at: "2026-09-03T00:07:00.000Z",
    user_id: "tenant-user",
    company_id: "tenant-company",
    content_type: "reel",
    caption: "A deterministic post",
    media: { video_url: "https://media.invalid/reel.mp4" },
    scheduled_at: "2026-09-03T00:00:00.000Z",
    legacy_spp_id: "00000000-0000-4000-8000-000000000004",
    provider_reconciliation_metadata: {},
    ...overrides,
  };
}

function fakeRepository(claims: ClaimedPublisherDelivery[], reaped: Array<{ delivery_id: string; new_state: string }> = []) {
  const calls: Array<{ operation: string; args: unknown[] }> = [];
  let returnedClaims = false;
  const repository: PublisherRepository = {
    async reap(...args) { calls.push({ operation: "reap", args }); return reaped; },
    async claim(...args) {
      calls.push({ operation: "claim", args });
      if (returnedClaims) return [];
      returnedClaims = true;
      return claims;
    },
    async markDispatchStarted(...args) { calls.push({ operation: "mark", args }); return true; },
    async checkpoint(...args) { calls.push({ operation: "checkpoint", args }); return true; },
    async complete(...args) { calls.push({ operation: "complete", args }); return true; },
    async retry(...args) { calls.push({ operation: "retry", args }); return "retryable"; },
    async deadLetter(...args) { calls.push({ operation: "deadLetter", args }); return true; },
    async verificationRequired(...args) { calls.push({ operation: "verification", args }); return true; },
  };
  return { repository, calls };
}

function adapters(overrides: Partial<Record<ClaimedPublisherDelivery["platform"], SyntheticAdapter>> = {}) {
  const delivered = () => new SyntheticAdapter([{ kind: "ready" }], [{ kind: "delivered", platformPostId: "provider-id", liveUrl: "https://provider.invalid/post" }]);
  return { instagram: delivered(), facebook: delivered(), linkedin: delivered(), ...overrides };
}

describe("publisher worker safety", () => {
  it("does no database or provider work while dispatch is disabled", async () => {
    const { repository, calls } = fakeRepository([delivery()]);
    const registry = adapters();
    const result = await runPublisherTick({ expectedEpoch: 2, dispatchEnabled: false, repository, adapters: registry });
    expect(result).toMatchObject({ dispatchEnabled: false, claimed: 0 });
    expect(calls).toEqual([]);
    expect(registry.instagram.dispatchCalls).toEqual([]);
  });

  it("reaps first, dispatch-marks before a provider call, and a repeat tick is empty", async () => {
    const stale = [{ delivery_id: "stale", new_state: "retryable" }];
    const item = delivery();
    const { repository, calls } = fakeRepository([item], stale);
    const registry = adapters();
    const first = await runPublisherTick({ expectedEpoch: 2, dispatchEnabled: true, repository, adapters: registry, now: new Date("2026-09-03T00:00:00Z") });
    const second = await runPublisherTick({ expectedEpoch: 2, dispatchEnabled: true, repository, adapters: registry, now: new Date("2026-09-03T00:05:00Z") });
    expect(first.reaped).toEqual(stale);
    expect(first.succeeded).toEqual([item.delivery_id]);
    expect(second.claimed).toBe(0);
    expect(calls.map((call) => call.operation).slice(0, 4)).toEqual(["reap", "claim", "mark", "complete"]);
    expect(registry.instagram.dispatchCalls).toHaveLength(1);
  });

  it("records partial platform outcomes independently", async () => {
    const instagram = delivery({ delivery_id: "ig", platform: "instagram", idempotency_key: "content:instagram" });
    const linkedin = delivery({ delivery_id: "li", platform: "linkedin", idempotency_key: "content:linkedin" });
    const retryAdapter = new SyntheticAdapter([{ kind: "safe_retry", error: "source unavailable" }]);
    const { repository, calls } = fakeRepository([instagram, linkedin]);
    const result = await runPublisherTick({
      expectedEpoch: 2, dispatchEnabled: true, repository,
      adapters: adapters({ linkedin: retryAdapter }), now: new Date("2026-09-03T00:00:00Z"),
    });
    expect(result.succeeded).toEqual(["ig"]);
    expect(result.retryable).toEqual(["li"]);
    expect(calls.filter((call) => call.operation === "mark").map((call) => call.args[0])).toEqual(["ig"]);
  });

  it("never retries automatically after a possible remote success", async () => {
    const throwing = new SyntheticAdapter([{ kind: "ready" }], []);
    throwing.dispatch = async () => { throw new Error("connection lost after response"); };
    const { repository, calls } = fakeRepository([delivery()]);
    const result = await runPublisherTick({ expectedEpoch: 2, dispatchEnabled: true, repository, adapters: adapters({ instagram: throwing }) });
    expect(result.verificationRequired).toEqual([delivery().delivery_id]);
    expect(calls.some((call) => call.operation === "retry")).toBe(false);
    expect(calls.some((call) => call.operation === "verification")).toBe(true);
  });

  it("dead-letters the last bounded attempt before dispatch", async () => {
    const exhausted = delivery({ attempt_number: 3 });
    const retryAdapter = new SyntheticAdapter([{ kind: "safe_retry", error: "still unavailable" }]);
    const { repository, calls } = fakeRepository([exhausted]);
    const result = await runPublisherTick({ expectedEpoch: 2, dispatchEnabled: true, repository, adapters: adapters({ instagram: retryAdapter }) });
    expect(result.deadLetter).toEqual([exhausted.delivery_id]);
    expect(calls.some((call) => call.operation === "mark")).toBe(false);
  });

  it("checkpoints a provider handle before scheduling a safe retry", async () => {
    const prepared = new SyntheticAdapter([{ kind: "safe_retry", error: "processing", checkpoint: { instagram_creation_id: "container-1", instagram_media_kind: "reel" } }]);
    const { repository, calls } = fakeRepository([delivery()]);
    const result = await runPublisherTick({ expectedEpoch: 2, dispatchEnabled: true, repository, adapters: adapters({ instagram: prepared }) });
    expect(result.retryable).toEqual([delivery().delivery_id]);
    expect(calls.map((call) => call.operation)).toEqual(["reap", "claim", "checkpoint", "retry"]);
    expect(prepared.dispatchCalls).toHaveLength(0);
  });

  it("never dispatches when checkpoint CAS loses the lease", async () => {
    const prepared = new SyntheticAdapter([{ kind: "ready", checkpoint: { instagram_creation_id: "container-1", instagram_media_kind: "image" } }]);
    const { repository, calls } = fakeRepository([delivery()]);
    repository.checkpoint = async (...args) => { calls.push({ operation: "checkpoint", args }); return false; };
    await runPublisherTick({ expectedEpoch: 2, dispatchEnabled: true, repository, adapters: adapters({ instagram: prepared }) });
    expect(calls.some((call) => call.operation === "mark")).toBe(false);
    expect(prepared.dispatchCalls).toHaveLength(0);
  });

  it("quarantines a safe-retry result returned after dispatch started", async () => {
    const adapter = new SyntheticAdapter([{ kind: "ready" }], [{ kind: "safe_retry", error: "ambiguous public response" }]);
    const { repository, calls } = fakeRepository([delivery()]);
    const result = await runPublisherTick({ expectedEpoch: 2, dispatchEnabled: true, repository, adapters: adapters({ instagram: adapter }) });
    expect(result.verificationRequired).toEqual([delivery().delivery_id]);
    expect(calls.some((call) => call.operation === "retry")).toBe(false);
  });

  it("leaves a dispatch-started lease for reaping when completion RPC fails", async () => {
    const { repository, calls } = fakeRepository([delivery()]);
    repository.complete = async (...args) => { calls.push({ operation: "complete", args }); throw new Error("database unavailable"); };
    await expect(runPublisherTick({ expectedEpoch: 2, dispatchEnabled: true, repository, adapters: adapters() })).rejects.toThrow("database unavailable");
    expect(calls.some((call) => call.operation === "retry")).toBe(false);
  });

  it("defensively dead-letters an article without touching an adapter", async () => {
    const article = delivery({ content_type: "article", platform: "linkedin" });
    const registry = adapters();
    const { repository, calls } = fakeRepository([article]);
    const result = await runPublisherTick({ expectedEpoch: 2, dispatchEnabled: true, repository, adapters: registry });
    expect(result.deadLetter).toEqual([article.delivery_id]);
    expect(registry.linkedin.dispatchCalls).toHaveLength(0);
    expect(calls.some((call) => call.operation === "mark")).toBe(false);
  });

  it("propagates an ownership epoch mismatch and never calls a provider", async () => {
    const { repository } = fakeRepository([delivery()]);
    repository.claim = async () => { throw new Error("replacement ownership mismatch"); };
    const registry = adapters();
    await expect(runPublisherTick({ expectedEpoch: 1, dispatchEnabled: true, repository, adapters: registry })).rejects.toThrow("ownership mismatch");
    expect(registry.instagram.dispatchCalls).toEqual([]);
  });
});

describe("request fingerprints", () => {
  it("is stable for the same idempotency key and payload regardless of JSON key order", () => {
    const one = delivery({ media: { video_url: "x", cover_path: "y" } });
    const two = delivery({ media: { cover_path: "y", video_url: "x" } });
    expect(requestFingerprint(one)).toBe(requestFingerprint(two));
    expect(requestFingerprint(one)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes across platform deliveries even when content is shared", () => {
    expect(requestFingerprint(delivery())).not.toBe(requestFingerprint(delivery({ platform: "facebook", idempotency_key: "legacy-spp:one:facebook" })));
  });
});
