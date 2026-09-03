import { createClient } from "@supabase/supabase-js";
import { loadExport, parseArgs, sha256, stableJson, summary } from "./legacy-spp-common.mjs";

const args = parseArgs(process.argv.slice(2));
const exportDirectory = args.get("export");
if (!exportDirectory) throw new Error("Usage: --export <directory> --confirm-sha256 <sha256> [--apply]");

const loaded = await loadExport(exportDirectory);
const exportSummary = summary(loaded.rows);
const expectedSha = args.get("confirm-sha256");
if (expectedSha !== loaded.exportSha256) {
  throw new Error("Export checksum does not match --confirm-sha256; refusing to continue");
}

// Deliberately emit counts and hashes only. Captions and media references must
// never be copied into logs, commits, issue comments, or PR evidence.
console.log(JSON.stringify({ mode: args.get("apply") ? "apply" : "dry-run", ...exportSummary }, null, 2));
if (!args.get("apply")) process.exit(0);

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required for --apply");

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let inserted = 0;
let unchanged = 0;
let deliveries = 0;
for (let offset = 0; offset < loaded.rows.length; offset += 20) {
  const { data, error } = await supabase.rpc("import_legacy_spp_rows", {
    p_rows: loaded.rows.slice(offset, offset + 20).map((row) => ({
      ...row,
      __migration_payload_sha256: sha256(stableJson(row)),
    })),
  });
  if (error) throw new Error(`Import failed at row ${offset}: ${error.message}`);
  inserted += data.inserted_content_items;
  unchanged += data.unchanged_content_items;
  deliveries += data.inserted_deliveries;
}

console.log(JSON.stringify({ inserted, unchanged, deliveries, manifestSha256: exportSummary.manifestSha256 }, null, 2));
