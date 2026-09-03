import { createClient } from "@supabase/supabase-js";
import { loadExport, parseArgs, sha256, stableJson, summary } from "./legacy-spp-common.mjs";

const args = parseArgs(process.argv.slice(2));
const exportDirectory = args.get("export");
const expectedEpoch = Number(args.get("expected-epoch"));
const safetySeconds = Number(args.get("safety-seconds") ?? "1800");
if (!exportDirectory || !Number.isSafeInteger(expectedEpoch) || expectedEpoch < 0
  || !Number.isSafeInteger(safetySeconds) || safetySeconds < 60 || safetySeconds > 86400) {
  throw new Error("Usage: --export <directory> --confirm-sha256 <sha256> --expected-epoch <integer> [--safety-seconds 1800]");
}
const loaded = await loadExport(exportDirectory);
if (args.get("confirm-sha256") !== loaded.exportSha256) throw new Error("Export checksum mismatch");
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const rows = loaded.rows.map((row) => ({ ...row, __migration_payload_sha256: sha256(stableJson(row)) }));
const { data, error } = await supabase.rpc("publisher_cutover_readiness", {
  p_rows: rows, p_expected_epoch: expectedEpoch, p_safety_seconds: safetySeconds,
});
if (error) throw new Error(`Cutover readiness failed closed: ${error.message}`);
console.log(JSON.stringify({ ...data, exportFileSha256: loaded.exportSha256,
  manifestSha256: summary(loaded.rows).manifestSha256, safetySeconds }, null, 2));
if (data?.ready !== true) process.exitCode = 1;
