import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth-helpers", async () => ({
  ...await vi.importActual<typeof import("../src/lib/auth-helpers")>("../src/lib/auth-helpers"),
  requireAgentOrAdmin: mocks.auth,
}));
vi.mock("@/lib/company-access", async () => ({
  ...await vi.importActual<typeof import("../src/lib/company-access")>("../src/lib/company-access"),
  resolveCompanyAccess: mocks.access,
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: mocks.rpc } }));
import { AuthError } from "../src/lib/auth-helpers";
import { CompanyAccessError } from "../src/lib/company-access";
import { parseNativeRevisionBody } from "../src/lib/publisher/native-revision";
import { POST } from "../src/app/api/publisher/revise/route";
const body = {
  requestId: "10000000-0000-4000-8000-000000000001", companyId: "demo-company",
  contentItemId: "20000000-0000-4000-8000-000000000001", expectedEpoch: 2, expectedLifecycleVersion: 0,
  caption: "We've just released an app", media: { upload_paths: ["demo-owner/demo-company/final.mp4"] },
  scheduledAt: "2099-10-31T19:30:00+11:00", approvalReference: "demo-approved-revision",
};
const request = (value: unknown = body) => new NextRequest("https://publisher.example/api/publisher/revise", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value),
});
beforeEach(() => {
  vi.resetAllMocks(); mocks.auth.mockResolvedValue({ userId: "demo-agent", role: "agent" });
  mocks.access.mockResolvedValue({ effectiveUserId: "demo-owner", isAssigned: true });
  mocks.rpc.mockResolvedValue({ data: { content_item_id: body.contentItemId, revised: true, replayed: false }, error: null });
});
describe("guarded native revision", () => {
  it("derives owner and actor from authentication, ignoring forged body identities", async () => {
    const response = await POST(request({ ...body, userId: "victim", actor: "forged" }));
    expect(response.status).toBe(200);
    expect(mocks.access).toHaveBeenCalledWith("demo-agent", "agent", "demo-company");
    expect(mocks.rpc).toHaveBeenCalledWith("revise_native_publisher_content", expect.objectContaining({
      p_user_id: "demo-owner", p_actor: "publisher-api:demo-agent", p_scheduled_at: "2099-10-31T08:30:00.000Z",
      p_request_id: body.requestId, p_expected_lifecycle_version: 0, p_expected_epoch: 2,
    }));
  });
  it("requires the operator role before any tenant or database read", async () => {
    mocks.auth.mockRejectedValue(new AuthError("Agent or admin access required", 403));
    expect((await POST(request())).status).toBe(403);
    expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not mutate a denied tenant", async () => {
    mocks.access.mockRejectedValue(new CompanyAccessError("Company not found", 404));
    expect((await POST(request())).status).toBe(404); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    ["request UUID", { requestId: "invalid" }], ["item UUID", { contentItemId: "invalid" }],
    ["approval", { approvalReference: "" }], ["approval controls", { approvalReference: "approve\nall" }],
    ["version", { expectedLifecycleVersion: -1 }], ["unsafe version", { expectedLifecycleVersion: 2 ** 53 }],
    ["epoch", { expectedEpoch: 0 }], ["media array", { media: [] }], ["null media", { media: null }],
    ["large UTF8 media", { media: { data: "😀".repeat(17_000) } }],
    ["caption", { caption: " " }], ["schedule", { scheduledAt: "infinity" }],
  ])("rejects invalid %s before RPC", async (_name, change) => {
    expect((await POST(request({ ...body, ...change }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["40001", "23505", "55000"])("reports database conflict %s without retry", async (code) => {
    mocks.rpc.mockResolvedValue({ error: { code, message: "Revision conflict" }, data: null });
    expect((await POST(request())).status).toBe(409); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("passes past times through for durable exact replay detection in the database", () => {
    expect(parseNativeRevisionBody({ ...body, scheduledAt: "2000-01-01T00:00:00Z" }).scheduledAt).toBe("2000-01-01T00:00:00.000Z");
  });
  it("returns the persisted replay snapshot without creating new work", async () => {
    const receipt = { content_item_id: body.contentItemId, revised: true, replayed: true, lifecycle_version: 1 };
    mocks.rpc.mockResolvedValue({ data: receipt, error: null });
    expect(await (await POST(request())).json()).toEqual(receipt);
  });
});
