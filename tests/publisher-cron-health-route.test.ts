import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ checkPublisherIdentities: vi.fn() }));
vi.mock("@/lib/publisher/identity-health", () => ({ checkPublisherIdentities: mocks.checkPublisherIdentities }));

import { GET } from "@/app/api/health/publisher/route";

afterEach(() => {
  delete process.env.CRON_SECRET;
  vi.clearAllMocks();
});

describe("publisher cron health route", () => {
  it("fails the gate when YouTube resolves to the wrong channel", async () => {
    process.env.CRON_SECRET = "cron-secret";
    mocks.checkPublisherIdentities.mockResolvedValue([
      { platform: "instagram", configured: true, state: "ok" },
      { platform: "facebook", configured: true, state: "ok" },
      { platform: "linkedin", configured: true, state: "ok" },
      { platform: "youtube", configured: true, state: "unhealthy" },
    ]);
    const response = await GET(new NextRequest("https://publisher.example/api/health/publisher", {
      headers: { authorization: "Bearer cron-secret" },
    }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      healthy: false,
      platforms: [{ platform: "instagram" }, { platform: "facebook" }, { platform: "linkedin" }, { platform: "youtube", state: "unhealthy" }],
    });
  });
});
