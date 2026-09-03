import { createClient } from "@supabase/supabase-js";
import { loadExport, parseArgs, sha256, stableJson } from "./legacy-spp-common.mjs";
import { executeOwnershipTransfer, expectedTransferConfirmation } from "./cutover-cli-common.mjs";

const args = parseArgs(process.argv.slice(2));
const exportDirectory = args.get("export");
const expectedEpoch = Number(args.get("expected-epoch"));
const safetySeconds = Number(args.get("safety-seconds") ?? "1800");
if (!args.get("apply") || !exportDirectory
  || !Number.isSafeInteger(expectedEpoch) || expectedEpoch < 0
  || !Number.isSafeInteger(safetySeconds) || safetySeconds < 60 || safetySeconds > 86400) {
  throw new Error("Usage: --apply --export <directory> --confirm-sha256 <sha256> --expected-epoch <integer> --expected-project-host <host> --confirm-transfer <value> [--safety-seconds 1800]");
}
const loaded = await loadExport(exportDirectory);
if (args.get("confirm-sha256") !== loaded.exportSha256) throw new Error("Export checksum mismatch");
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");
const projectHost = new URL(url).host;
if (!args.get("expected-project-host") || args.get("expected-project-host") !== projectHost) throw new Error("SUPABASE_URL host does not match --expected-project-host");
const confirmation = expectedTransferConfirmation({ projectHost, expectedEpoch, safetySeconds, exportSha256: loaded.exportSha256 });
if (args.get("confirm-transfer") !== confirmation) throw new Error(`Explicit confirmation mismatch; expected ${confirmation}`);
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const rows = loaded.rows.map((row) => ({ ...row, __migration_payload_sha256: sha256(stableJson(row)) }));
const { readiness, ownership, replacementEpoch } = await executeOwnershipTransfer({ supabase, rows, expectedEpoch, safetySeconds });
console.log(JSON.stringify({ transferred: true, projectHost, priorEpoch: expectedEpoch,
  replacementEpoch, cutoffAt: ownership.cutoff_at,
  databaseAttestationSha256: ownership.reconciliation_sha256,
  exportBindingSha256: readiness.export_binding_sha256 }, null, 2));
