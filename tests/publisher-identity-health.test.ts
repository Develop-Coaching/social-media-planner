import { afterEach, describe, expect, it, vi } from "vitest";
import { checkPublisherIdentities } from "@/lib/publisher/identity-health";

afterEach(() => vi.restoreAllMocks());

describe("read-only publisher identity health", () => {
  it("matches configured publisher identities using read-only provider calls", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      expect(init?.method ?? "GET").toBe(url === "https://oauth2.googleapis.com/token" ? "POST" : "GET");
      if (url.includes("/ig-1?")) return Response.json({ id: "ig-1", username: "publisher" });
      if (url.includes("/page-1?")) return Response.json({ id: "page-1", name: "Page" });
      if (url.includes("/me/permissions")) return Response.json({ data: [
        { permission: "instagram_basic", status: "granted" },
        { permission: "instagram_content_publish", status: "granted" },
        { permission: "pages_read_engagement", status: "granted" },
        { permission: "pages_manage_posts", status: "granted" },
      ] });
      if (url === "https://api.linkedin.com/v2/userinfo") return Response.json({ sub: "member-1", name: "Publisher" });
      if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "short-lived-access", scope: "https://www.googleapis.com/auth/youtube.upload" });
      if (url.includes("youtube/v3/channels")) return Response.json({ items: [{ id: "channel-1", snippet: { title: "Develop Coaching" } }] });
      throw new Error(`unexpected URL ${url}`);
    });
    const result = await checkPublisherIdentities({
      META_ACCESS_TOKEN: "meta-secret", META_PAGE_ACCESS_TOKEN: "page-secret", META_IG_USER_ID: "ig-1", META_FB_PAGE_ID: "page-1",
      LINKEDIN_ACCESS_TOKEN: "linkedin-secret", LINKEDIN_AUTHOR_URN: "urn:li:person:member-1",
      YOUTUBE_CLIENT_ID: "youtube-client", YOUTUBE_CLIENT_SECRET: "youtube-secret",
      YOUTUBE_REFRESH_TOKEN: "youtube-refresh", YOUTUBE_CHANNEL_ID: "channel-1",
    }, fetcher);
    expect(result.map((item) => item.state)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(JSON.stringify(result)).not.toMatch(/secret|short-lived-access|youtube-refresh/);
  });

  it("reports identity mismatch without returning credentials", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/me/permissions")) return Response.json({ data: [] });
      if (url.includes("graph.facebook.com")) return Response.json({ id: "wrong" });
      if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "youtube-access", scope: "https://www.googleapis.com/auth/youtube.upload" });
      if (url.includes("youtube/v3/channels")) return Response.json({ items: [{ id: "wrong-channel" }] });
      return Response.json({ sub: "wrong-member" });
    });
    const result = await checkPublisherIdentities({
      META_ACCESS_TOKEN: "meta-secret", META_IG_USER_ID: "ig-1", META_FB_PAGE_ID: "page-1",
      LINKEDIN_ACCESS_TOKEN: "linkedin-secret", LINKEDIN_AUTHOR_URN: "urn:li:person:member-1",
      YOUTUBE_CLIENT_ID: "youtube-client", YOUTUBE_CLIENT_SECRET: "youtube-secret",
      YOUTUBE_REFRESH_TOKEN: "youtube-refresh", YOUTUBE_CHANNEL_ID: "channel-1",
    }, fetcher);
    expect(result.every((item) => item.state === "unhealthy")).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/meta-secret|linkedin-secret|youtube-secret|youtube-refresh|youtube-access/);
  });

  it("uses the read-only organization authorization finder for organization authors", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      expect(init?.method ?? "GET").toBe("GET");
      expect(String(input)).toContain("organizationAcls?q=roleAssignee&state=APPROVED");
      return Response.json({ elements: [{ organizationTarget: "urn:li:organization:42", state: "APPROVED" }] });
    });
    const [instagram, facebook, linkedin, youtube] = await checkPublisherIdentities({
      LINKEDIN_ACCESS_TOKEN: "secret", LINKEDIN_AUTHOR_URN: "urn:li:organization:42",
    }, fetcher);
    expect(instagram.configured).toBe(false);
    expect(facebook.configured).toBe(false);
    expect(linkedin).toMatchObject({ state: "ok", identity: "urn:li:organization:42" });
    expect(youtube).toMatchObject({ configured: false, state: "misconfigured" });
  });

  it("rejects a valid Google credential for the wrong YouTube channel", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        expect(init?.method).toBe("POST");
        expect(String(init?.body)).toContain("grant_type=refresh_token");
        return Response.json({ access_token: "temporary-access", scope: "https://www.googleapis.com/auth/youtube.upload" });
      }
      if (url.includes("youtube/v3/channels")) {
        expect(init?.headers).toEqual({ Authorization: "Bearer temporary-access" });
        return Response.json({ items: [{ id: "personal-channel", snippet: { title: "Personal" } }] });
      }
      throw new Error(`unexpected URL ${url}`);
    });
    const result = await checkPublisherIdentities({
      YOUTUBE_CLIENT_ID: "client", YOUTUBE_CLIENT_SECRET: "client-secret",
      YOUTUBE_REFRESH_TOKEN: "refresh-secret", YOUTUBE_CHANNEL_ID: "brand-channel",
    }, fetcher);
    expect(result[3]).toMatchObject({ platform: "youtube", configured: true, state: "unhealthy", identity: "personal-channel" });
    expect(JSON.stringify(result)).not.toMatch(/client-secret|refresh-secret|temporary-access/);
  });

  it("classifies invalid_grant as unhealthy without exposing the provider response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(
      { error: "invalid_grant", error_description: "refresh-secret was revoked" },
      { status: 400 },
    ));
    const result = await checkPublisherIdentities({
      YOUTUBE_CLIENT_ID: "client", YOUTUBE_CLIENT_SECRET: "client-secret",
      YOUTUBE_REFRESH_TOKEN: "refresh-secret", YOUTUBE_CHANNEL_ID: "brand-channel",
    }, fetcher);
    expect(result[3]).toMatchObject({ state: "unhealthy", detail: "YouTube refresh token was rejected; reconnect the channel" });
    expect(JSON.stringify(result[3])).not.toContain("refresh-secret");
  });

  it("classifies transient Google failures as unknown", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(
      { error: "temporarily_unavailable" }, { status: 503 },
    ));
    const result = await checkPublisherIdentities({
      YOUTUBE_CLIENT_ID: "client", YOUTUBE_CLIENT_SECRET: "client-secret",
      YOUTUBE_REFRESH_TOKEN: "refresh-secret", YOUTUBE_CHANNEL_ID: "brand-channel",
    }, fetcher);
    expect(result[3]).toMatchObject({ configured: true, state: "unknown", detail: "YouTube token exchange was unavailable (503)" });
  });

  it("rejects a read-only credential that cannot upload video", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      access_token: "temporary-access", scope: "https://www.googleapis.com/auth/youtube.readonly",
    }));
    const result = await checkPublisherIdentities({
      YOUTUBE_CLIENT_ID: "client", YOUTUBE_CLIENT_SECRET: "client-secret",
      YOUTUBE_REFRESH_TOKEN: "refresh-secret", YOUTUBE_CHANNEL_ID: "brand-channel",
    }, fetcher);
    expect(result[3]).toMatchObject({
      state: "unhealthy", missingPermissions: ["youtube.upload"],
      detail: "YouTube credential does not grant video upload access",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("treats quota-related channel lookup failures as transient", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => String(input).includes("oauth2.googleapis.com")
      ? Response.json({ access_token: "temporary-access", scope: "https://www.googleapis.com/auth/youtube.upload" })
      : Response.json({ error: { errors: [{ reason: "quotaExceeded" }] } }, { status: 403 }));
    const result = await checkPublisherIdentities({
      YOUTUBE_CLIENT_ID: "client", YOUTUBE_CLIENT_SECRET: "client-secret",
      YOUTUBE_REFRESH_TOKEN: "refresh-secret", YOUTUBE_CHANNEL_ID: "brand-channel",
    }, fetcher);
    expect(result[3]).toMatchObject({ state: "unknown", detail: "YouTube channel identity read was unavailable (403)" });
  });

  it("treats insufficient YouTube permission as unhealthy", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => String(input).includes("oauth2.googleapis.com")
      ? Response.json({ access_token: "temporary-access", scope: "https://www.googleapis.com/auth/youtube.upload" })
      : Response.json({ error: { errors: [{ reason: "insufficientPermissions" }] } }, { status: 403 }));
    const result = await checkPublisherIdentities({
      YOUTUBE_CLIENT_ID: "client", YOUTUBE_CLIENT_SECRET: "client-secret",
      YOUTUBE_REFRESH_TOKEN: "refresh-secret", YOUTUBE_CHANNEL_ID: "brand-channel",
    }, fetcher);
    expect(result[3]).toMatchObject({ state: "unhealthy", detail: "YouTube channel identity read was rejected (403)" });
  });

  it("reports missing YouTube environment variables without making a request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const result = await checkPublisherIdentities({}, fetcher);
    expect(result[3]).toMatchObject({ platform: "youtube", configured: false, state: "misconfigured" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
