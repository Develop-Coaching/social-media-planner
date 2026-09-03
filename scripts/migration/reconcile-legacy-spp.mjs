import { createClient } from "@supabase/supabase-js";
import { loadExport, manifestFor, parseArgs, sha256, stableJson, summary } from "./legacy-spp-common.mjs";

const args = parseArgs(process.argv.slice(2));
const exportDirectory = args.get("export");
if (!exportDirectory) throw new Error("Usage: --export <directory> --confirm-sha256 <sha256>");

const loaded = await loadExport(exportDirectory);
if (args.get("confirm-sha256") !== loaded.exportSha256) {
  throw new Error("Export checksum does not match --confirm-sha256; refusing to continue");
}

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const expectedIds = loaded.rows.map((row) => row.id);
const { data: items, error: itemError } = await supabase
  .from("publisher_content_items")
  .select("legacy_spp_id,legacy_status,content_type,scheduled_at,legacy_payload,legacy_payload_sha256,migration_state,publishability")
  .in("legacy_spp_id", expectedIds);
if (itemError) throw new Error(`Content reconciliation failed: ${itemError.message}`);

const byId = new Map(items.map((item) => [item.legacy_spp_id, item]));
const differences = [];
for (const source of loaded.rows) {
  const target = byId.get(source.id);
  if (!target) {
    differences.push({ legacy_spp_id: source.id, field: "missing" });
    continue;
  }
  if (stableJson(target.legacy_payload) !== stableJson(source)) {
    differences.push({ legacy_spp_id: source.id, field: "legacy_payload" });
  }
  if (target.legacy_payload_sha256 !== sha256(stableJson(source))) {
    differences.push({ legacy_spp_id: source.id, field: "legacy_payload_sha256" });
  }
  for (const field of ["status", "content_type", "scheduled_at"]) {
    const targetField = field === "status" ? "legacy_status" : field;
    if (target[targetField] !== source[field]) differences.push({ legacy_spp_id: source.id, field });
  }
  const expectedMigrationState = source.status === "queued" ? "migration_frozen" : "historical";
  if (target.migration_state !== expectedMigrationState) {
    differences.push({ legacy_spp_id: source.id, field: "migration_state" });
  }
  const expectedPublishability = source.content_type === "article" ? "planning_only" : "publishable";
  if (target.publishability !== expectedPublishability) {
    differences.push({ legacy_spp_id: source.id, field: "publishability" });
  }
}

const report = {
  ...summary(loaded.rows),
  matched: loaded.rows.length - new Set(differences.map((entry) => entry.legacy_spp_id)).size,
  differenceCount: differences.length,
  reconciliationSha256: sha256(stableJson(manifestFor(loaded.rows))),
};
console.log(JSON.stringify(report, null, 2));
if (differences.length) {
  // IDs/field names are safe evidence; source payloads are intentionally omitted.
  console.error(JSON.stringify({ differences }, null, 2));
  process.exitCode = 1;
}
