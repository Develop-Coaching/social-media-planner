import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const REQUIRED_KEYS = [
  "id", "user_id", "company_id", "content_type", "platforms",
  "scheduled_at", "status",
];
const STATUSES = new Set(["queued", "publishing", "published", "failed", "cancelled"]);
const PLATFORMS = new Set(["instagram", "facebook", "linkedin"]);
const AMBIGUOUS_PROVIDER_ID = /^(pending|unknown|failed|error|processing|publishing|queued|n\/a|null|none|sent)$/i;

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function manifestFor(rows) {
  return rows
    .map((row) => ({
      legacy_spp_id: row.id,
      status: row.status,
      content_type: row.content_type,
      platforms: [...row.platforms].sort(),
      scheduled_at: row.scheduled_at,
      payload_sha256: sha256(stableJson(row)),
    }))
    .sort((a, b) => a.legacy_spp_id.localeCompare(b.legacy_spp_id));
}

export function classifyLegacyPlatformOutcome(row, platform) {
  const rawId = typeof row.platform_post_ids?.[platform] === "string"
    ? row.platform_post_ids[platform].trim()
    : "";
  const directAmbiguous = AMBIGUOUS_PROVIDER_ID.test(rawId);
  const containerId = platform === "instagram" && typeof row.platform_post_ids?.instagram_container === "string"
    ? row.platform_post_ids.instagram_container.trim()
    : "";
  const containerSince = platform === "instagram" && typeof row.platform_post_ids?.instagram_container_since === "string"
    ? row.platform_post_ids.instagram_container_since.trim()
    : "";
  const hasContainerMetadata = containerId.length > 0 || containerSince.length > 0;
  const durable = rawId.length > 0 && !directAmbiguous && !hasContainerMetadata;
  return {
    rawId,
    durable,
    ambiguous: !durable && (directAmbiguous || hasContainerMetadata),
    reconciliationMetadata: platform === "instagram" && (containerId || containerSince)
      ? { instagram_container: containerId || null, instagram_container_since: containerSince || null }
      : {},
  };
}

export function classifyAuditedLegacyResolution(outcome, audit) {
  if (!outcome?.ambiguous || audit?.event_type !== "legacy_verification_resolved" || !audit.actor?.trim()) return null;
  const details = audit.details;
  const evidence = details?.provider_evidence;
  if (!evidence || Array.isArray(evidence) || typeof evidence !== "object" || Object.keys(evidence).length === 0) return null;
  if (details.before?.state !== "verification_required"
    || stableJson(details.before?.provider_reconciliation_metadata ?? {}) !== stableJson(outcome.reconciliationMetadata ?? {})) return null;

  if (details.resolution === "confirmed_published") {
    const providerPostId = typeof details.provider_post_id === "string" ? details.provider_post_id.trim() : "";
    const publishedAt = details.published_at;
    if (!providerPostId || AMBIGUOUS_PROVIDER_ID.test(providerPostId) || !publishedAt
      || details.after?.state !== "succeeded"
      || details.after?.platform_post_id !== providerPostId
      || details.after?.published_at !== publishedAt) return null;
    return { state: "succeeded", platformPostId: providerPostId, publishedAt };
  }
  if (details.resolution === "confirmed_absent"
    && details.after?.state === "migration_frozen"
    && details.provider_post_id == null && details.published_at == null
    && details.after?.platform_post_id == null && details.after?.published_at == null) {
    return { state: "migration_frozen", platformPostId: null, publishedAt: null };
  }
  return null;
}

export function validateRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("Export must be a non-empty JSON array");
  const ids = new Set();
  for (const [index, row] of rows.entries()) {
    for (const key of REQUIRED_KEYS) {
      if (!(key in row)) throw new Error(`Row ${index} is missing ${key}`);
    }
    if (ids.has(row.id)) throw new Error(`Duplicate legacy ID at row ${index}`);
    ids.add(row.id);
    if (!STATUSES.has(row.status)) throw new Error(`Unsupported status at row ${index}`);
    if (!Array.isArray(row.platforms) || row.platforms.length === 0) {
      throw new Error(`Row ${index} has no platforms`);
    }
    for (const platform of row.platforms) {
      if (!PLATFORMS.has(platform)) throw new Error(`Unsupported platform at row ${index}`);
    }
  }
  return rows;
}

export async function loadExport(exportDirectory) {
  const exportPath = path.resolve(exportDirectory, "scheduled_posts.json");
  const raw = await readFile(exportPath, "utf8");
  const rows = validateRows(JSON.parse(raw));
  return { exportPath, exportSha256: sha256(raw), rows };
}

export function summary(rows) {
  const queued = rows.filter((row) => row.status === "queued");
  return {
    total: rows.length,
    historical: rows.length - queued.length,
    queued: queued.length,
    queuedArticles: queued.filter((row) => row.content_type === "article").length,
    queuedPublishable: queued.filter((row) => row.content_type !== "article").length,
    tenants: new Set(rows.map((row) => `${row.user_id}\u0000${row.company_id}`)).size,
    manifestSha256: sha256(stableJson(manifestFor(rows))),
  };
}

export function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    if (token === "--apply") {
      args.set("apply", true);
      continue;
    }
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    args.set(token.slice(2), value);
    i += 1;
  }
  return args;
}
