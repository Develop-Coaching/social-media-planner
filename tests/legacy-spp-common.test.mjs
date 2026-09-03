import assert from "node:assert/strict";
import test from "node:test";
import { classifyAuditedLegacyResolution, classifyLegacyPlatformOutcome, manifestFor, sha256, stableJson, summary, validateRows } from "../scripts/migration/legacy-spp-common.mjs";

function fixtureRow(index) {
  const queued = index <= 21;
  const article = index <= 14;
  return {
    id: `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
    user_id: "sanitized-user",
    company_id: "sanitized-company",
    content_type: article ? "article" : "reel",
    caption: `Sanitized caption ${index}`,
    platforms: article ? ["linkedin"] : ["instagram", "facebook", "linkedin"],
    scheduled_at: new Date(Date.UTC(2026, 8, 1, index)).toISOString(),
    status: queued ? "queued" : index <= 50 ? "published" : "cancelled",
    media_urls: [],
  };
}

test("sanitized 67-row fixture has the required migration shape", () => {
  const rows = validateRows(Array.from({ length: 67 }, (_, index) => fixtureRow(index + 1)));
  assert.deepEqual(summary(rows), {
    total: 67,
    historical: 46,
    queued: 21,
    queuedArticles: 14,
    queuedPublishable: 7,
    tenants: 1,
    manifestSha256: sha256(stableJson(manifestFor(rows))),
  });
});

test("manifest hashing is deterministic across object key order", () => {
  const row = fixtureRow(1);
  const reordered = Object.fromEntries(Object.entries(row).reverse());
  assert.equal(stableJson(row), stableJson(reordered));
  assert.equal(manifestFor([row])[0].payload_sha256, manifestFor([reordered])[0].payload_sha256);
});

test("validation rejects duplicate IDs and unsupported platforms", () => {
  assert.throws(() => validateRows([fixtureRow(1), fixtureRow(1)]), /Duplicate legacy ID/);
  assert.throws(() => validateRows([{ ...fixtureRow(1), platforms: ["x"] }]), /Unsupported platform/);
});

test("Instagram auxiliary container keys require verification and are preserved", () => {
  const row = {
    ...fixtureRow(15),
    platform_post_ids: {
      instagram_container: "ig-container-sanitized",
      instagram_container_since: "2026-09-03T01:02:03.000Z",
    },
  };
  assert.deepEqual(classifyLegacyPlatformOutcome(row, "instagram"), {
    rawId: "",
    durable: false,
    ambiguous: true,
    reconciliationMetadata: {
      instagram_container: "ig-container-sanitized",
      instagram_container_since: "2026-09-03T01:02:03.000Z",
    },
  });
  assert.equal(classifyLegacyPlatformOutcome({
    ...fixtureRow(15), platform_post_ids: { instagram_container: "container-only" },
  }, "instagram").ambiguous, true);
  assert.equal(classifyLegacyPlatformOutcome({
    ...fixtureRow(15), platform_post_ids: { instagram_container_since: "2026-09-03T01:02:03.000Z" },
  }, "instagram").ambiguous, true);
});

test("only complete immutable audit evidence resolves an ambiguous legacy outcome", () => {
  const outcome = classifyLegacyPlatformOutcome({
    ...fixtureRow(15), platform_post_ids: { instagram_container: "container-only" },
  }, "instagram");
  const before = {
    state: "verification_required",
    provider_reconciliation_metadata: outcome.reconciliationMetadata,
  };
  const confirmedPublished = {
    event_type: "legacy_verification_resolved",
    actor: "sanitized-reviewer",
    details: {
      resolution: "confirmed_published",
      before,
      after: {
        state: "succeeded",
        platform_post_id: "durable-provider-id",
        published_at: "2026-09-03T03:04:05+00:00",
      },
      provider_post_id: "durable-provider-id",
      published_at: "2026-09-03T03:04:05+00:00",
      provider_evidence: { lookup: "published" },
    },
  };
  assert.deepEqual(classifyAuditedLegacyResolution(outcome, confirmedPublished), {
    state: "succeeded",
    platformPostId: "durable-provider-id",
    publishedAt: "2026-09-03T03:04:05+00:00",
  });

  const confirmedAbsent = {
    ...confirmedPublished,
    details: {
      resolution: "confirmed_absent",
      before,
      after: { state: "migration_frozen", platform_post_id: null, published_at: null },
      provider_post_id: null,
      published_at: null,
      provider_evidence: { lookup: "not_found" },
    },
  };
  assert.deepEqual(classifyAuditedLegacyResolution(outcome, confirmedAbsent), {
    state: "migration_frozen", platformPostId: null, publishedAt: null,
  });
  assert.equal(classifyAuditedLegacyResolution(outcome, {
    ...confirmedAbsent, details: { ...confirmedAbsent.details, provider_evidence: {} },
  }), null);
});
