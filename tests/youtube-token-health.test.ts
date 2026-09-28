import { describe, expect, it, vi } from "vitest";
import { buildTokenAlert, checkYouTubeToken } from "@/lib/publish/token-health";

const env = {
  YOUTUBE_CLIENT_ID: "client",
  YOUTUBE_CLIENT_SECRET: "client-secret",
  YOUTUBE_REFRESH_TOKEN: "refresh-secret",
  YOUTUBE_CHANNEL_ID: "brand-channel",
};

describe("YouTube proactive token health", () => {
  it("stays quiet when the refresh token resolves to the expected channel", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => String(input).includes("oauth2.googleapis.com")
      ? Response.json({ access_token: "temporary-access", scope: "https://www.googleapis.com/auth/youtube.upload" })
      : Response.json({ items: [{ id: "brand-channel", snippet: { title: "Develop Coaching" } }] }));
    const status = await checkYouTubeToken(env, fetcher);
    expect(status).toMatchObject({ label: "YouTube", configured: true, valid: true, severity: "ok" });
    expect(buildTokenAlert([status])).toBeNull();
  });

  it("alerts when the refresh token is revoked", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: "invalid_grant" }, { status: 400 }));
    const status = await checkYouTubeToken(env, fetcher);
    expect(status).toMatchObject({ valid: false, severity: "expired" });
    expect(buildTokenAlert([status])).toContain("YouTube refresh token was rejected");
  });

  it("alerts when required YouTube configuration is missing", async () => {
    const status = await checkYouTubeToken({}, vi.fn<typeof fetch>());
    expect(status).toMatchObject({ configured: false, severity: "misconfigured" });
    expect(buildTokenAlert([status])).toContain("Publishing credentials need configuration");
  });

  it("alerts when Google rejects the OAuth client credentials", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: "invalid_client" }, { status: 401 }));
    const status = await checkYouTubeToken(env, fetcher);
    expect(status).toMatchObject({ configured: true, severity: "misconfigured" });
    expect(buildTokenAlert([status])).toContain("YouTube OAuth client credentials were rejected");
  });
});
