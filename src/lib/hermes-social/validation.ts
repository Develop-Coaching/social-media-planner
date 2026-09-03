import { HermesRepositoryError } from "./repository";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HermesRepositoryError("Request body must be a JSON object", 400);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new HermesRepositoryError("Request body contains missing or unsupported fields", 400);
  }
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new HermesRepositoryError(`${label} is invalid`, 400);
  }
  return value.trim();
}

function epoch(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new HermesRepositoryError("expectedEpoch is invalid", 400);
  }
  return value as number;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || !Number.isFinite(Date.parse(value))) {
    throw new HermesRepositoryError("scheduledAt is invalid", 400);
  }
  return value;
}

export function validateAdoptBody(value: unknown) {
  const body = record(value);
  exactKeys(body, ["expectedEpoch", "companyId", "legacySppId", "scheduledAt", "approvalReference", "expectedContentSha256"]);
  const legacySppId = text(body.legacySppId, "legacySppId", 36);
  const expectedContentSha256 = text(body.expectedContentSha256, "expectedContentSha256", 64);
  if (!UUID_RE.test(legacySppId) || !SHA256_RE.test(expectedContentSha256)) {
    throw new HermesRepositoryError("Request identity is invalid", 400);
  }
  return {
    expectedEpoch: epoch(body.expectedEpoch),
    companyId: text(body.companyId, "companyId", 256),
    legacySppId,
    scheduledAt: timestamp(body.scheduledAt),
    approvalReference: text(body.approvalReference, "approvalReference", 256),
    expectedContentSha256,
  };
}

export function validateCancelBody(value: unknown) {
  const body = record(value);
  exactKeys(body, ["expectedEpoch", "companyId", "reason"]);
  return {
    expectedEpoch: epoch(body.expectedEpoch),
    companyId: text(body.companyId, "companyId", 256),
    reason: text(body.reason, "reason", 512),
  };
}

export function validateRestoreBody(value: unknown) {
  const body = record(value);
  exactKeys(body, ["expectedEpoch", "companyId", "scheduledAt"]);
  return {
    expectedEpoch: epoch(body.expectedEpoch),
    companyId: text(body.companyId, "companyId", 256),
    scheduledAt: timestamp(body.scheduledAt),
  };
}
