import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createToken, sessionCookieOptions } from "../src/lib/auth";
import { proxy } from "../src/proxy";
import { GET as hermesPreviewGet } from "../src/app/api/hermes/v1/social-schedules/legacy/[legacySppId]/route";

const originalAdminPassword = process.env.ADMIN_PASSWORD;
const originalAuthSecret = process.env.AUTH_SECRET;
const strongAdminPassword = "Setup-Access-2026!Strong";
const strongAuthSecret = "f8M!2qZ#7vL@9xR$4nT%6kP&3sW*5yC+";
const hermesSecret = "synthetic-hermes-proxy-secret-at-least-32-bytes";

beforeEach(() => {
  process.env.ADMIN_PASSWORD = strongAdminPassword;
  process.env.AUTH_SECRET = strongAuthSecret;
  process.env.HERMES_SOCIAL_BRIDGE_KEY_ID = "synthetic-key-v1";
  process.env.HERMES_SOCIAL_BRIDGE_HMAC_SECRET = hermesSecret;
  process.env.HERMES_SOCIAL_BRIDGE_USER_ID = "synthetic-user";
  process.env.HERMES_SOCIAL_BRIDGE_COMPANY_ID = "shared-company-slug";
});

afterEach(() => {
  if (originalAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
  else process.env.ADMIN_PASSWORD = originalAdminPassword;
  if (originalAuthSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = originalAuthSecret;
  delete process.env.HERMES_SOCIAL_BRIDGE_KEY_ID;
  delete process.env.HERMES_SOCIAL_BRIDGE_HMAC_SECRET;
  delete process.env.HERMES_SOCIAL_BRIDGE_USER_ID;
  delete process.env.HERMES_SOCIAL_BRIDGE_COMPANY_ID;
});

function request(path: string, token?: string) {
  return new NextRequest(`https://publisher.example${path}`, {
    headers: token ? { cookie: `pc_session=${token}` } : undefined,
  });
}

describe("publisher proxy authentication", () => {
  it("fails closed when credentials are missing or weak", async () => {
    delete process.env.AUTH_SECRET;
    expect((await proxy(request("/api/publisher/queue"))).status).toBe(503);
    process.env.AUTH_SECRET = "postpilot-default-secret-change-me";
    expect((await proxy(request("/api/publisher/queue"))).status).toBe(503);
  });

  it("rejects missing and invalid sessions for APIs", async () => {
    expect((await proxy(request("/api/publisher/queue"))).status).toBe(401);
    expect((await proxy(request("/api/publisher/queue", "invalid.jwt"))).status).toBe(401);
  });

  it("exempts only the Hermes schedule subtree and leaves HMAC rejection to its route", async () => {
    const unsigned = request("/api/hermes/v1/social-schedules/legacy/10000000-0000-4000-8000-000000000001");
    expect((await proxy(unsigned)).status).toBe(200);
    expect((await proxy(request("/api/hermes/v1/social-schedules-evil"))).status).toBe(401);
    expect((await proxy(request("/api/publisher/queue"))).status).toBe(401);

    const routeResponse = await hermesPreviewGet(unsigned, {
      params: Promise.resolve({ legacySppId: "10000000-0000-4000-8000-000000000001" }),
    });
    expect(routeResponse.status).toBe(401);

    const badHmac = request("/api/hermes/v1/social-schedules/legacy/10000000-0000-4000-8000-000000000001");
    badHmac.headers.set("x-hermes-key-id", "synthetic-key-v1");
    badHmac.headers.set("x-hermes-timestamp", String(Math.floor(Date.now() / 1000)));
    badHmac.headers.set("x-hermes-request-id", "20000000-0000-4000-8000-000000000001");
    badHmac.headers.set("x-hermes-signature", "0".repeat(64));
    expect((await proxy(badHmac)).status).toBe(200);
    expect((await hermesPreviewGet(badHmac, {
      params: Promise.resolve({ legacySppId: "10000000-0000-4000-8000-000000000001" }),
    })).status).toBe(401);
  });

  it("restores the incomplete-onboarding guard", async () => {
    const token = await createToken("user-1", "client", false);
    const response = await proxy(request("/", token));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://publisher.example/onboarding");
    expect((await proxy(request("/onboarding", token))).status).toBe(200);
  });

  it("uses hardened session cookie attributes", () => {
    expect(sessionCookieOptions(true)).toMatchObject({
      httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 604800,
    });
  });
});
