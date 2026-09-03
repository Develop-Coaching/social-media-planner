import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { bodySha256, canonicalHermesRequest, verifyHermesRequest } from "../src/lib/hermes-social/auth";

const SECRET = "synthetic-hermes-test-secret-with-32-bytes-minimum";
const KEY_ID = "synthetic-key-v1";
const USER_ID = "synthetic-user";
const COMPANY_ID = "develop-coaching";

beforeEach(() => {
  process.env.HERMES_SOCIAL_BRIDGE_KEY_ID = KEY_ID;
  process.env.HERMES_SOCIAL_BRIDGE_HMAC_SECRET = SECRET;
  process.env.HERMES_SOCIAL_BRIDGE_USER_ID = USER_ID;
  process.env.HERMES_SOCIAL_BRIDGE_COMPANY_ID = COMPANY_ID;
});

function signedRequest(url: string, init: {
  method?: string; body?: string; timestamp?: number; requestId?: string;
  userId?: string; companyId?: string;
} = {}) {
  const method = init.method ?? "GET";
  const body = Buffer.from(init.body ?? "");
  const timestamp = String(init.timestamp ?? 1_800_000_000);
  const requestId = init.requestId ?? randomUUID();
  const parsed = new URL(url);
  const canonical = canonicalHermesRequest(
    method, parsed, timestamp, requestId,
    init.userId ?? USER_ID, init.companyId ?? COMPANY_ID, body,
  );
  const signature = createHmac("sha256", SECRET).update(canonical).digest("hex");
  return new NextRequest(url, {
    method,
    body: method === "GET" ? undefined : body,
    headers: {
      "content-type": "application/json",
      "x-hermes-key-id": KEY_ID,
      "x-hermes-timestamp": timestamp,
      "x-hermes-request-id": requestId,
      "x-hermes-signature": signature,
    },
  });
}

afterEach(() => {
  delete process.env.HERMES_SOCIAL_BRIDGE_KEY_ID;
  delete process.env.HERMES_SOCIAL_BRIDGE_HMAC_SECRET;
  delete process.env.HERMES_SOCIAL_BRIDGE_USER_ID;
  delete process.env.HERMES_SOCIAL_BRIDGE_COMPANY_ID;
});

describe("Hermes v1 HMAC authentication", () => {
  it("uses decoded code-point sorting and URLSearchParams query rendering", () => {
    const canonical = canonicalHermesRequest(
      "get",
      new URL("https://example.invalid/path?z=hello%20world&a=~&a=!"),
      "1800000000",
      "10000000-0000-4000-8000-000000000001",
      USER_ID,
      COMPANY_ID,
      new Uint8Array(),
    );
    expect(canonical.split("\n")[1]).toBe("/path?a=%21&a=%7E&z=hello+world");
  });

  it("binds method, sorted canonical query, timestamp, request ID and raw body", async () => {
    process.env.HERMES_SOCIAL_BRIDGE_KEY_ID = KEY_ID;
    process.env.HERMES_SOCIAL_BRIDGE_HMAC_SECRET = SECRET;
    const requestId = randomUUID();
    const raw = '{"expectedEpoch":2}';
    const request = signedRequest("https://example.invalid/api/hermes/v1/social-schedules/adopt?z=2&a=1", {
      method: "POST", body: raw, requestId,
    });
    const verified = await verifyHermesRequest(request, 1_800_000_000);
    expect(verified.requestId).toBe(requestId);
    expect(verified.actor).toBe(`hermes:${KEY_ID}`);
    expect(verified.userId).toBe(USER_ID);
    expect(verified.companyId).toBe(COMPANY_ID);
    expect(Buffer.from(verified.rawBody).toString()).toBe(raw);
    expect(verified.requestFingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(bodySha256(Buffer.from(raw))).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the database idempotency digest stable when an exact retry is re-signed", async () => {
    process.env.HERMES_SOCIAL_BRIDGE_KEY_ID = KEY_ID;
    process.env.HERMES_SOCIAL_BRIDGE_HMAC_SECRET = SECRET;
    const requestId = randomUUID();
    const first = await verifyHermesRequest(signedRequest("https://example.invalid/adopt", {
      method: "POST", body: "{}", requestId, timestamp: 1_800_000_000,
    }), 1_800_000_000);
    const retry = await verifyHermesRequest(signedRequest("https://example.invalid/adopt", {
      method: "POST", body: "{}", requestId, timestamp: 1_800_000_200,
    }), 1_800_000_200);
    expect(retry.requestFingerprintSha256).toBe(first.requestFingerprintSha256);
  });

  it("binds the database replay identity to the canonical method and target", async () => {
    process.env.HERMES_SOCIAL_BRIDGE_KEY_ID = KEY_ID;
    process.env.HERMES_SOCIAL_BRIDGE_HMAC_SECRET = SECRET;
    const requestId = randomUUID();
    const first = await verifyHermesRequest(signedRequest("https://example.invalid/schedule-a/cancel", {
      method: "POST", body: "{}", requestId,
    }), 1_800_000_000);
    const otherTarget = await verifyHermesRequest(signedRequest("https://example.invalid/schedule-b/cancel", {
      method: "POST", body: "{}", requestId,
    }), 1_800_000_000);
    expect(otherTarget.requestFingerprintSha256).not.toBe(first.requestFingerprintSha256);
  });

  it("rejects stale and future signatures outside the symmetric five-minute window", async () => {
    process.env.HERMES_SOCIAL_BRIDGE_KEY_ID = KEY_ID;
    process.env.HERMES_SOCIAL_BRIDGE_HMAC_SECRET = SECRET;
    await expect(verifyHermesRequest(signedRequest("https://example.invalid/test", { timestamp: 1_799_999_699 }), 1_800_000_000))
      .rejects.toMatchObject({ status: 401 });
    await expect(verifyHermesRequest(signedRequest("https://example.invalid/test", { timestamp: 1_800_000_301 }), 1_800_000_000))
      .rejects.toMatchObject({ status: 401 });
  });

  it("rejects a signature produced for a different configured tenant", async () => {
    const wrongUser = signedRequest("https://example.invalid/test", { userId: "other-user" });
    await expect(verifyHermesRequest(wrongUser, 1_800_000_000)).rejects.toMatchObject({ status: 401 });
    const wrongCompany = signedRequest("https://example.invalid/test", { companyId: "other-company" });
    await expect(verifyHermesRequest(wrongCompany, 1_800_000_000)).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a changed body, query, key ID or malformed request ID", async () => {
    process.env.HERMES_SOCIAL_BRIDGE_KEY_ID = KEY_ID;
    process.env.HERMES_SOCIAL_BRIDGE_HMAC_SECRET = SECRET;
    const changedBody = signedRequest("https://example.invalid/test", { method: "POST", body: "{}" });
    Object.defineProperty(changedBody, "nextUrl", { value: new URL("https://example.invalid/test?changed=1") });
    await expect(verifyHermesRequest(changedBody, 1_800_000_000)).rejects.toMatchObject({ status: 401 });

    const malformed = signedRequest("https://example.invalid/test");
    malformed.headers.set("x-hermes-request-id", "not-a-uuid");
    await expect(verifyHermesRequest(malformed, 1_800_000_000)).rejects.toMatchObject({ status: 401 });
  });

  it("fails closed for missing or short server secrets", async () => {
    process.env.HERMES_SOCIAL_BRIDGE_KEY_ID = KEY_ID;
    process.env.HERMES_SOCIAL_BRIDGE_HMAC_SECRET = "short";
    await expect(verifyHermesRequest(signedRequest("https://example.invalid/test"), 1_800_000_000))
      .rejects.toMatchObject({ status: 503 });
  });

  it("fails closed when the key has no bounded server-side tenant binding", async () => {
    delete process.env.HERMES_SOCIAL_BRIDGE_USER_ID;
    await expect(verifyHermesRequest(signedRequest("https://example.invalid/test"), 1_800_000_000))
      .rejects.toMatchObject({ status: 503 });
    process.env.HERMES_SOCIAL_BRIDGE_USER_ID = USER_ID;
    process.env.HERMES_SOCIAL_BRIDGE_COMPANY_ID = "x".repeat(257);
    await expect(verifyHermesRequest(signedRequest("https://example.invalid/test"), 1_800_000_000))
      .rejects.toMatchObject({ status: 503 });
  });

  it("rejects an oversized declared Content-Length before reading the body", async () => {
    const request = signedRequest("https://example.invalid/adopt", { method: "POST", body: "{}" });
    request.headers.set("content-length", "16385");
    await expect(verifyHermesRequest(request, 1_800_000_000)).rejects.toMatchObject({ status: 413 });
  });

  it("bounds chunked bodies while streaming even without Content-Length", async () => {
    const base = signedRequest("https://example.invalid/adopt", { method: "POST", body: "{}" });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(9_000));
        controller.enqueue(new Uint8Array(9_000));
        controller.close();
      },
    });
    const request = new NextRequest("https://example.invalid/adopt", {
      method: "POST", headers: base.headers, body: stream,
    });
    request.headers.delete("content-length");
    await expect(verifyHermesRequest(request, 1_800_000_000)).rejects.toMatchObject({ status: 413 });
  });
});
