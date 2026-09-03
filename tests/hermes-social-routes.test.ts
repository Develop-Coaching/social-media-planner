import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(), preview: vi.fn(), get: vi.fn(), adopt: vi.fn(), cancel: vi.fn(), restore: vi.fn(),
}));

vi.mock("@/lib/hermes-social/auth", () => ({
  verifyHermesRequest: mocks.verify,
  HermesAuthError: class HermesAuthError extends Error { constructor(message: string, public status: number) { super(message); } },
}));
vi.mock("@/lib/hermes-social/repository", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/hermes-social/repository")>("../src/lib/hermes-social/repository");
  return {
    ...actual,
    previewLegacySchedule: mocks.preview,
    getHermesSchedule: mocks.get,
    adoptHermesSchedule: mocks.adopt,
    cancelHermesSchedule: mocks.cancel,
    restoreHermesSchedule: mocks.restore,
  };
});

import { POST as adoptPost } from "../src/app/api/hermes/v1/social-schedules/adopt/route";
import { GET as previewGet } from "../src/app/api/hermes/v1/social-schedules/legacy/[legacySppId]/route";
import { GET as statusGet } from "../src/app/api/hermes/v1/social-schedules/[scheduleId]/route";
import { POST as cancelPost } from "../src/app/api/hermes/v1/social-schedules/[scheduleId]/cancel/route";
import { POST as restorePost } from "../src/app/api/hermes/v1/social-schedules/[scheduleId]/restore/route";

const identity = {
  requestId: "10000000-0000-4000-8000-000000000001",
  requestFingerprintSha256: "a".repeat(64),
  actor: "hermes:synthetic-key-v1",
  rawBody: new Uint8Array(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verify.mockResolvedValue(identity);
});

describe("Hermes social schedule routes", () => {
  it("returns only the tenant-bound legacy preview", async () => {
    mocks.preview.mockResolvedValue({ legacySppId: "legacy-1", safeToAdopt: true });
    const response = await previewGet(
      new NextRequest("https://example.invalid/api/hermes/v1/social-schedules/legacy/legacy-1?companyId=company-1"),
      { params: Promise.resolve({ legacySppId: "legacy-1" }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.preview).toHaveBeenCalledWith("company-1", "legacy-1");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("passes the signed request identity into adoption and never accepts platform input", async () => {
    const body = {
      expectedEpoch: 2, companyId: "company-1",
      legacySppId: "10000000-0000-4000-8000-000000000002",
      scheduledAt: "2099-01-01T00:00:00Z", approvalReference: "approval-1",
      expectedContentSha256: "b".repeat(64),
    };
    mocks.verify.mockResolvedValue({ ...identity, rawBody: Buffer.from(JSON.stringify(body)) });
    mocks.adopt.mockResolvedValue({ scheduleId: "schedule-1", replayed: false });
    const response = await adoptPost(new NextRequest("https://example.invalid/adopt", { method: "POST" }));
    expect(response.status).toBe(201);
    expect(mocks.adopt).toHaveBeenCalledWith(expect.objectContaining({ requestId: identity.requestId }), body);

    mocks.verify.mockResolvedValue({ ...identity, rawBody: Buffer.from(JSON.stringify({ ...body, platforms: ["instagram"] })) });
    expect((await adoptPost(new NextRequest("https://example.invalid/adopt", { method: "POST" }))).status).toBe(400);
    expect(mocks.adopt).toHaveBeenCalledTimes(1);
  });

  it("returns 200 for an exact idempotent adoption replay", async () => {
    const body = {
      expectedEpoch: 2, companyId: "company-1",
      legacySppId: "10000000-0000-4000-8000-000000000002",
      scheduledAt: "2099-01-01T00:00:00Z", approvalReference: "approval-1",
      expectedContentSha256: "b".repeat(64),
    };
    mocks.verify.mockResolvedValue({ ...identity, rawBody: Buffer.from(JSON.stringify(body)) });
    mocks.adopt.mockResolvedValue({ scheduleId: "schedule-1", replayed: true });
    expect((await adoptPost(new NextRequest("https://example.invalid/adopt", { method: "POST" }))).status).toBe(200);
  });

  it("tenant-binds status, cancellation and restore", async () => {
    mocks.get.mockResolvedValue({ scheduleId: "schedule-1" });
    await statusGet(
      new NextRequest("https://example.invalid/api/hermes/v1/social-schedules/schedule-1?companyId=company-1"),
      { params: Promise.resolve({ scheduleId: "schedule-1" }) },
    );
    expect(mocks.get).toHaveBeenCalledWith("company-1", "schedule-1");

    const cancelBody = { expectedEpoch: 2, companyId: "company-1", reason: "operator requested" };
    mocks.verify.mockResolvedValue({ ...identity, rawBody: Buffer.from(JSON.stringify(cancelBody)) });
    mocks.cancel.mockResolvedValue({ scheduleId: "schedule-1" });
    expect((await cancelPost(new NextRequest("https://example.invalid/cancel", { method: "POST" }),
      { params: Promise.resolve({ scheduleId: "schedule-1" }) })).status).toBe(200);
    expect(mocks.cancel).toHaveBeenCalledWith(expect.anything(), "schedule-1", cancelBody);

    const restoreBody = { expectedEpoch: 2, companyId: "company-1", scheduledAt: "2099-01-02T00:00:00Z" };
    mocks.verify.mockResolvedValue({ ...identity, rawBody: Buffer.from(JSON.stringify(restoreBody)) });
    mocks.restore.mockResolvedValue({ scheduleId: "schedule-1" });
    expect((await restorePost(new NextRequest("https://example.invalid/restore", { method: "POST" }),
      { params: Promise.resolve({ scheduleId: "schedule-1" }) })).status).toBe(200);
    expect(mocks.restore).toHaveBeenCalledWith(expect.anything(), "schedule-1", restoreBody);
  });
});
