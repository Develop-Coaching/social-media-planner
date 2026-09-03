import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createToken, sessionCookieOptions } from "../src/lib/auth";
import { proxy } from "../src/proxy";

const originalAdminPassword = process.env.ADMIN_PASSWORD;
const originalAuthSecret = process.env.AUTH_SECRET;
const strongAdminPassword = "Setup-Access-2026!Strong";
const strongAuthSecret = "f8M!2qZ#7vL@9xR$4nT%6kP&3sW*5yC+";

beforeEach(() => {
  process.env.ADMIN_PASSWORD = strongAdminPassword;
  process.env.AUTH_SECRET = strongAuthSecret;
});

afterEach(() => {
  if (originalAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
  else process.env.ADMIN_PASSWORD = originalAdminPassword;
  if (originalAuthSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = originalAuthSecret;
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
