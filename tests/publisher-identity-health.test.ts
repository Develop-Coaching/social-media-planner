import { afterEach, describe, expect, it, vi } from "vitest";
import { checkPublisherIdentities } from "@/lib/publisher/identity-health";

afterEach(() => vi.restoreAllMocks());

describe("read-only publisher identity health", () => {
  it("matches configured Meta and LinkedIn person identities and permissions using GET only", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      expect(init?.method ?? "GET").toBe("GET");
      if (url.includes("/ig-1?")) return Response.json({ id: "ig-1", username: "publisher" });
      if (url.includes("/page-1?")) return Response.json({ id: "page-1", name: "Page" });
      if (url.includes("/me/permissions")) return Response.json({ data: [
        { permission: "instagram_basic", status: "granted" },
        { permission: "instagram_content_publish", status: "granted" },
        { permission: "pages_read_engagement", status: "granted" },
        { permission: "pages_manage_posts", status: "granted" },
      ] });
      if (url === "https://api.linkedin.com/v2/userinfo") return Response.json({ sub: "member-1", name: "Publisher" });
      throw new Error(`unexpected URL ${url}`);
    });
    const result = await checkPublisherIdentities({
      META_ACCESS_TOKEN: "meta-secret", META_PAGE_ACCESS_TOKEN: "page-secret", META_IG_USER_ID: "ig-1", META_FB_PAGE_ID: "page-1",
      LINKEDIN_ACCESS_TOKEN: "linkedin-secret", LINKEDIN_AUTHOR_URN: "urn:li:person:member-1",
    }, fetcher);
    expect(result.map((item) => item.state)).toEqual(["ok", "ok", "ok"]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("reports identity mismatch without returning credentials", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/me/permissions")) return Response.json({ data: [] });
      if (url.includes("graph.facebook.com")) return Response.json({ id: "wrong" });
      return Response.json({ sub: "wrong-member" });
    });
    const result = await checkPublisherIdentities({
      META_ACCESS_TOKEN: "meta-secret", META_IG_USER_ID: "ig-1", META_FB_PAGE_ID: "page-1",
      LINKEDIN_ACCESS_TOKEN: "linkedin-secret", LINKEDIN_AUTHOR_URN: "urn:li:person:member-1",
    }, fetcher);
    expect(result.every((item) => item.state === "unhealthy")).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/meta-secret|linkedin-secret/);
  });

  it("uses the read-only organization authorization finder for organization authors", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      expect(init?.method ?? "GET").toBe("GET");
      expect(String(input)).toContain("organizationAcls?q=roleAssignee&state=APPROVED");
      return Response.json({ elements: [{ organizationTarget: "urn:li:organization:42", state: "APPROVED" }] });
    });
    const [instagram, facebook, linkedin] = await checkPublisherIdentities({
      LINKEDIN_ACCESS_TOKEN: "secret", LINKEDIN_AUTHOR_URN: "urn:li:organization:42",
    }, fetcher);
    expect(instagram.configured).toBe(false);
    expect(facebook.configured).toBe(false);
    expect(linkedin).toMatchObject({ state: "ok", identity: "urn:li:organization:42" });
  });
});
