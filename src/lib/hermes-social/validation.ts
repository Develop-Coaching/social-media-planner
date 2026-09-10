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
  exactKeys(body, ["expectedEpoch", "legacySppId", "scheduledAt", "approvalReference", "expectedContentSha256"]);
  const legacySppId = text(body.legacySppId, "legacySppId", 36);
  const expectedContentSha256 = text(body.expectedContentSha256, "expectedContentSha256", 64);
  if (!UUID_RE.test(legacySppId) || !SHA256_RE.test(expectedContentSha256)) {
    throw new HermesRepositoryError("Request identity is invalid", 400);
  }
  return {
    expectedEpoch: epoch(body.expectedEpoch),
    legacySppId,
    scheduledAt: timestamp(body.scheduledAt),
    approvalReference: text(body.approvalReference, "approvalReference", 256),
    expectedContentSha256,
  };
}

export function validateCancelBody(value: unknown) {
  const body = record(value);
  exactKeys(body, ["expectedEpoch", "reason"]);
  return {
    expectedEpoch: epoch(body.expectedEpoch),
    reason: text(body.reason, "reason", 512),
  };
}

export function validateRestoreBody(value: unknown) {
  const body = record(value);
  exactKeys(body, ["expectedEpoch", "scheduledAt"]);
  return {
    expectedEpoch: epoch(body.expectedEpoch),
    scheduledAt: timestamp(body.scheduledAt),
  };
}

function uuid(value: unknown, label: string): string {
  const result = text(value, label, 36);
  if (!UUID_RE.test(result)) throw new HermesRepositoryError(`${label} is invalid`, 400);
  return result.toLowerCase();
}

function zonedTimestamp(value: unknown): string {
  const result = timestamp(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(result)) {
    throw new HermesRepositoryError("Timestamp must include an explicit timezone", 400);
  }
  return result;
}

export function validateRescheduleBody(value: unknown) {
  const body = record(value);
  exactKeys(body, ["expectedEpoch", "changes", "approvalReference"]);
  if (!Array.isArray(body.changes) || body.changes.length < 1 || body.changes.length > 20) {
    throw new HermesRepositoryError("changes must contain 1–20 items", 400);
  }
  const changes = body.changes.map((value) => {
    const change = record(value);
    exactKeys(change, ["contentItemId", "expectedScheduledAt", "scheduledAt", "expectedContentSha256"]);
    const expectedContentSha256 = text(change.expectedContentSha256, "expectedContentSha256", 64);
    if (!SHA256_RE.test(expectedContentSha256)) throw new HermesRepositoryError("Content fingerprint is invalid", 400);
    return { contentItemId: uuid(change.contentItemId, "contentItemId"),
      expectedScheduledAt: zonedTimestamp(change.expectedScheduledAt), scheduledAt: zonedTimestamp(change.scheduledAt), expectedContentSha256 };
  });
  if (new Set(changes.map((change) => change.contentItemId)).size !== changes.length) {
    throw new HermesRepositoryError("Duplicate content item in batch", 400);
  }
  return { expectedEpoch: epoch(body.expectedEpoch), changes, approvalReference: text(body.approvalReference, "approvalReference", 256) };
}

function queryKeys(query: URLSearchParams, allowed: string[]) {
  for (const key of query.keys()) {
    if (!allowed.includes(key) || query.getAll(key).length !== 1) {
      throw new HermesRepositoryError("Unsupported or repeated query field", 400);
    }
  }
}

export function validateQueueQuery(query: URLSearchParams) {
  queryKeys(query, ["limit", "cursor", "from", "to"]);
  const limitText = query.get("limit") ?? "50";
  const limit = Number(limitText);
  if (!/^\d{1,3}$/.test(limitText) || limit < 1 || limit > 100) throw new HermesRepositoryError("limit must be 1–100", 400);
  const from = query.has("from") ? zonedTimestamp(query.get("from")) : null;
  const to = query.has("to") ? zonedTimestamp(query.get("to")) : null;
  if (from && to && Date.parse(from) >= Date.parse(to)) throw new HermesRepositoryError("from must be before to", 400);
  return { limit, cursor: query.has("cursor") ? uuid(query.get("cursor"), "cursor") : null, from, to };
}

export function validateResolveQuery(query: URLSearchParams) {
  queryKeys(query, ["contentItemId", "legacySppId", "scheduleId"]);
  if ([...query.keys()].length !== 1) throw new HermesRepositoryError("Exactly one schedule identifier is required", 400);
  return { contentItemId: query.has("contentItemId") ? uuid(query.get("contentItemId"), "contentItemId") : null,
    legacySppId: query.has("legacySppId") ? uuid(query.get("legacySppId"), "legacySppId") : null,
    scheduleId: query.has("scheduleId") ? uuid(query.get("scheduleId"), "scheduleId") : null };
}
