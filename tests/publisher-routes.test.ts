import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAgentOrAdmin: vi.fn(),
  requireAuth: vi.fn(),
  resolveCompanyAccess: vi.fn(),
  listOperatorQueue: vi.fn(),
  readPublisherOwnership: vi.fn(),
  checkPublisherIdentities: vi.fn(),
  ingestNativePublisherContent: vi.fn(),
  releaseNativePublisherContent: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/auth-helpers")>("../src/lib/auth-helpers");
  return { ...actual, requireAgentOrAdmin: mocks.requireAgentOrAdmin, requireAuth: mocks.requireAuth };
});
vi.mock("@/lib/company-access", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/company-access")>("../src/lib/company-access");
  return { ...actual, resolveCompanyAccess: mocks.resolveCompanyAccess };
});
vi.mock("@/lib/publisher/operator-repository", () => ({
  listOperatorQueue: mocks.listOperatorQueue,
  readPublisherOwnership: mocks.readPublisherOwnership,
}));
vi.mock("@/lib/publisher/identity-health", () => ({ checkPublisherIdentities: mocks.checkPublisherIdentities }));
vi.mock("@/lib/publisher/native-ingestion", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/publisher/native-ingestion")>("../src/lib/publisher/native-ingestion");
  return { ...actual, ingestNativePublisherContent: mocks.ingestNativePublisherContent,
    releaseNativePublisherContent: mocks.releaseNativePublisherContent };
});

import { AuthError } from "../src/lib/auth-helpers";
import { CompanyAccessError } from "../src/lib/company-access";
import { GET as queueGet } from "../src/app/api/publisher/queue/route";
import { GET as healthGet } from "../src/app/api/publisher/health/route";
import { POST as retiredPost } from "../src/app/api/scheduled-posts/route";
import { POST as ingestPost } from "../src/app/api/publisher/ingest/route";
import { POST as releasePost } from "../src/app/api/publisher/release/route";
import { PublisherRpcError } from "../src/lib/publisher/native-ingestion";
import { NextRequest } from "next/server";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue({ userId: "user-1", role: "client", onboardingCompleted: true });
});

describe("publisher request boundaries", () => {
  it("does not query a denied second tenant", async () => {
    mocks.resolveCompanyAccess.mockRejectedValue(new CompanyAccessError("Company not found", 404));
    const response = await queueGet(new NextRequest("https://publisher.example/api/publisher/queue?companyId=tenant-2"));
    expect(response.status).toBe(404);
    expect(mocks.listOperatorQueue).not.toHaveBeenCalled();
  });

  it("restricts provider health to operator/admin roles", async () => {
    mocks.requireAgentOrAdmin.mockRejectedValue(new AuthError("Agent or admin access required", 403));
    const response = await healthGet();
    expect(response.status).toBe(403);
    expect(mocks.checkPublisherIdentities).not.toHaveBeenCalled();
  });

  it("coalesces provider health reads and returns only minimal state", async () => {
    mocks.requireAgentOrAdmin.mockResolvedValue({ userId: "operator-1", role: "agent" });
    mocks.readPublisherOwnership.mockResolvedValue({
      source: "legacy_spp", owner: "legacy", epoch: 1, cutoff_at: null, reconciliation_sha256: null,
    });
    mocks.checkPublisherIdentities.mockResolvedValue([{
      platform: "linkedin", configured: true, state: "ok", identity: "secret identity",
      missingPermissions: [], detail: "sensitive provider detail",
    }]);
    const first = await healthGet();
    const second = await healthGet();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mocks.checkPublisherIdentities).toHaveBeenCalledTimes(1);
    expect(await first.json()).toMatchObject({ platforms: [{ platform: "linkedin", configured: true, state: "ok" }] });
    expect(JSON.stringify(await second.json())).not.toMatch(/identity|detail|missingPermissions/);
  });

  it("returns 410 for authenticated legacy mutations", async () => {
    expect((await retiredPost()).status).toBe(410);
  });

  it("derives the ingestion tenant from authenticated company access", async () => {
    mocks.requireAgentOrAdmin.mockResolvedValue({ userId: "agent-1", role: "agent" });
    mocks.resolveCompanyAccess.mockResolvedValue({ effectiveUserId: "owner-1", isAssigned: true });
    mocks.ingestNativePublisherContent.mockResolvedValue({
      content_item_id: "content-1", created: true, publishability: "publishable", media_state: "ready", deliveries: [],
    });
    const response = await ingestPost(new NextRequest("https://publisher.example/api/publisher/ingest", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyId: "company-1", sourceSystem: "greg_brain", sourceId: "post-1",
        contentType: "post", caption: "Text", media: {}, scheduledAt: "2026-09-10T00:00:00Z",
        platforms: ["facebook", "linkedin"], mediaState: "ready" }),
    }));
    expect(response.status).toBe(201);
    expect(mocks.ingestNativePublisherContent).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner-1", companyId: "company-1" }));
  });

  it("rejects native articles that could become API-publishable", async () => {
    mocks.requireAgentOrAdmin.mockResolvedValue({ userId: "admin-1", role: "admin" });
    const response = await ingestPost(new NextRequest("https://publisher.example/api/publisher/ingest", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyId: "company-1", sourceSystem: "greg_brain", sourceId: "article-1",
        contentType: "article", caption: "Article", media: {}, scheduledAt: "2026-09-10T00:00:00Z",
        platforms: ["facebook", "linkedin"], mediaState: "ready" }),
    }));
    expect(response.status).toBe(400);
    expect(mocks.resolveCompanyAccess).not.toHaveBeenCalled();
    expect(mocks.ingestNativePublisherContent).not.toHaveBeenCalled();
  });

  it("maps conflicting ingestion replays to HTTP 409", async () => {
    mocks.requireAgentOrAdmin.mockResolvedValue({ userId: "admin-1", role: "admin" });
    mocks.resolveCompanyAccess.mockResolvedValue({ effectiveUserId: "owner-1", isAssigned: false });
    mocks.ingestNativePublisherContent.mockRejectedValue(new PublisherRpcError("23505", "source conflict"));
    const response = await ingestPost(new NextRequest("https://publisher.example/api/publisher/ingest", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyId: "company-1", sourceSystem: "greg_brain", sourceId: "post-1",
        contentType: "post", caption: "Text", media: {}, scheduledAt: "2099-09-10T00:00:00Z",
        platforms: ["facebook"], mediaState: "ready" }),
    }));
    expect(response.status).toBe(409);
  });

  it("maps database validation failures to HTTP 400", async () => {
    mocks.requireAgentOrAdmin.mockResolvedValue({ userId: "admin-1", role: "admin" });
    mocks.resolveCompanyAccess.mockResolvedValue({ effectiveUserId: "owner-1", isAssigned: false });
    mocks.ingestNativePublisherContent.mockRejectedValue(new PublisherRpcError("22023", "invalid payload"));
    const response = await ingestPost(new NextRequest("https://publisher.example/api/publisher/ingest", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyId: "company-1", sourceSystem: "greg_brain", sourceId: "post-1",
        contentType: "post", caption: "Text", media: {}, scheduledAt: "2099-09-10T00:00:00Z",
        platforms: ["facebook"], mediaState: "ready" }),
    }));
    expect(response.status).toBe(400);
  });

  it("tenant-binds and audits the guarded release action", async () => {
    mocks.requireAgentOrAdmin.mockResolvedValue({ userId: "agent-1", role: "agent" });
    mocks.resolveCompanyAccess.mockResolvedValue({ effectiveUserId: "owner-1", isAssigned: true });
    mocks.releaseNativePublisherContent.mockResolvedValue({ content_item_id: "content-1", released: true,
      scheduled_at: "2099-10-01T00:00:00Z", lifecycle_version: 4, deliveries: [] });
    const response = await releasePost(new NextRequest("https://publisher.example/api/publisher/release", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyId: "company-1", sourceSystem: "greg_brain", sourceId: "post-1",
        scheduledAt: "2099-10-01T00:00:00Z", expectedLifecycleVersion: 3, caption: "Corrected" }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.releaseNativePublisherContent).toHaveBeenCalledWith(expect.objectContaining({
      userId: "owner-1", actor: "publisher-api:agent-1",
      expectedLifecycleVersion: 3,
    }));
  });

  it("maps an atomic release version mismatch to HTTP 409", async () => {
    mocks.requireAgentOrAdmin.mockResolvedValue({ userId: "agent-1", role: "agent" });
    mocks.resolveCompanyAccess.mockResolvedValue({ effectiveUserId: "owner-1", isAssigned: true });
    mocks.releaseNativePublisherContent.mockRejectedValue(new PublisherRpcError("40001", "publisher lifecycle version conflict"));
    const response = await releasePost(new NextRequest("https://publisher.example/api/publisher/release", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyId: "company-1", sourceSystem: "greg_brain", sourceId: "post-1",
        scheduledAt: "2099-10-01T00:00:00Z", expectedLifecycleVersion: 2 }),
    }));
    expect(response.status).toBe(409);
  });
});
