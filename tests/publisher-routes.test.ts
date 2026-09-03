import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAgentOrAdmin: vi.fn(),
  requireAuth: vi.fn(),
  resolveCompanyAccess: vi.fn(),
  listOperatorQueue: vi.fn(),
  readPublisherOwnership: vi.fn(),
  checkPublisherIdentities: vi.fn(),
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

import { AuthError } from "../src/lib/auth-helpers";
import { CompanyAccessError } from "../src/lib/company-access";
import { GET as queueGet } from "../src/app/api/publisher/queue/route";
import { GET as healthGet } from "../src/app/api/publisher/health/route";
import { POST as retiredPost } from "../src/app/api/scheduled-posts/route";
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
});
