import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

const MAX_CLOCK_SKEW_SECONDS = 300;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const KEY_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const MAX_BODY_BYTES = 16_384;
const TENANT_ID_RE = /^[\x21-\x7e]{1,256}$/;

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
  userId: string,
  companyId: string,
  rawBody: Uint8Array,
): string {
  const pathAndQuery = `${url.pathname}${url.searchParams.size ? `?${canonicalQuery(url)}` : ""}`;
  return [method.toUpperCase(), pathAndQuery, timestamp, requestId, userId, companyId, bodySha256(rawBody)].join("\n");
}

export interface VerifiedHermesRequest {
  requestId: string;
  requestFingerprintSha256: string;
  actor: string;
  userId: string;
  companyId: string;
  rawBody: Uint8Array;
}

async function readBoundedBody(request: NextRequest): Promise<Uint8Array> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) throw new HermesAuthError("Invalid Content-Length", 400);
    if (Number(contentLength) > MAX_BODY_BYTES) {
      throw new HermesAuthError("Hermes request body is too large", 413);
    }
  }
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel("Hermes request body is too large");
      throw new HermesAuthError("Hermes request body is too large", 413);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function verifyHermesRequest(
  request: NextRequest,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<VerifiedHermesRequest> {
  const configuredKeyId = process.env.HERMES_SOCIAL_BRIDGE_KEY_ID;
  const secret = process.env.HERMES_SOCIAL_BRIDGE_HMAC_SECRET;
  const userId = process.env.HERMES_SOCIAL_BRIDGE_USER_ID;
  const companyId = process.env.HERMES_SOCIAL_BRIDGE_COMPANY_ID;
  if (!configuredKeyId || !KEY_ID_RE.test(configuredKeyId) || !secret || Buffer.byteLength(secret) < 32
    || !userId || userId !== userId.trim() || !TENANT_ID_RE.test(userId)
    || !companyId || companyId !== companyId.trim() || !TENANT_ID_RE.test(companyId)) {
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

  const rawBody = await readBoundedBody(request);
  const canonical = canonicalHermesRequest(
    request.method, request.nextUrl, timestamp, requestId, userId, companyId, rawBody,
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
    userId,
    companyId,
    rawBody,
  };
}
