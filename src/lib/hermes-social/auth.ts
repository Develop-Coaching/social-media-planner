import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

const MAX_CLOCK_SKEW_SECONDS = 300;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const KEY_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;

export class HermesAuthError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

function canonicalQuery(url: URL): string {
  const sorted = [...url.searchParams.entries()]
    .sort(([aKey, aValue], [bKey, bValue]) => {
      if (aKey < bKey) return -1;
      if (aKey > bKey) return 1;
      return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
    });
  return new URLSearchParams(sorted).toString();
}

export function bodySha256(rawBody: Uint8Array): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

export function canonicalHermesRequest(
  method: string,
  url: URL,
  timestamp: string,
  requestId: string,
  rawBody: Uint8Array,
): string {
  const pathAndQuery = `${url.pathname}${url.searchParams.size ? `?${canonicalQuery(url)}` : ""}`;
  return [method.toUpperCase(), pathAndQuery, timestamp, requestId, bodySha256(rawBody)].join("\n");
}

export interface VerifiedHermesRequest {
  requestId: string;
  requestFingerprintSha256: string;
  actor: string;
  rawBody: Uint8Array;
}

export async function verifyHermesRequest(
  request: NextRequest,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<VerifiedHermesRequest> {
  const configuredKeyId = process.env.HERMES_SOCIAL_BRIDGE_KEY_ID;
  const secret = process.env.HERMES_SOCIAL_BRIDGE_HMAC_SECRET;
  if (!configuredKeyId || !KEY_ID_RE.test(configuredKeyId) || !secret || Buffer.byteLength(secret) < 32) {
    throw new HermesAuthError("Hermes bridge is not configured", 503);
  }

  const keyId = request.headers.get("x-hermes-key-id") ?? "";
  const timestamp = request.headers.get("x-hermes-timestamp") ?? "";
  const requestId = request.headers.get("x-hermes-request-id") ?? "";
  const signature = request.headers.get("x-hermes-signature") ?? "";
  if (keyId !== configuredKeyId || !/^\d{10}$/.test(timestamp)
    || !UUID_RE.test(requestId) || !SHA256_RE.test(signature)) {
    throw new HermesAuthError("Invalid Hermes signature", 401);
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds)
    || Math.abs(nowSeconds - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS) {
    throw new HermesAuthError("Hermes request timestamp is outside the allowed window", 401);
  }

  const rawBody = new Uint8Array(await request.arrayBuffer());
  if (rawBody.byteLength > 16_384) throw new HermesAuthError("Hermes request body is too large", 413);
  const canonical = canonicalHermesRequest(
    request.method, request.nextUrl, timestamp, requestId, rawBody,
  );
  const expected = createHmac("sha256", secret).update(canonical).digest();
  const supplied = Buffer.from(signature, "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new HermesAuthError("Invalid Hermes signature", 401);
  }

  return {
    requestId: requestId.toLowerCase(),
    // Exclude timestamp/signature so an exact retry can be re-signed, while
    // binding the UUID to its method and canonical target as well as its body.
    requestFingerprintSha256: bodySha256(Buffer.from([
      request.method.toUpperCase(),
      `${request.nextUrl.pathname}${request.nextUrl.searchParams.size ? `?${canonicalQuery(request.nextUrl)}` : ""}`,
      bodySha256(rawBody),
    ].join("\n"))),
    actor: `hermes:${keyId}`,
    rawBody,
  };
}
