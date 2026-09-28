import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

function argsFor(values) {
  const result = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    if (key === "--apply") result.set("apply", "true");
    else {
      const value = values[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${key} requires a value`);
      result.set(key.slice(2), value);
      index += 1;
    }
  }
  return result;
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const args = argsFor(process.argv.slice(2));
const actor = args.get("actor");
if (!actor) throw new Error("--actor is required");

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

if (args.get("apply")) {
  const approvalId = args.get("approval-id");
  const manifestSha256 = args.get("approval-sha256");
  const userId = args.get("user-id");
  const companyId = args.get("company-id");
  if (!approvalId || !manifestSha256 || !userId || !companyId) {
    throw new Error("--apply requires --approval-id and --approval-sha256 from preview plus --user-id and --company-id");
  }
  const { data, error } = await supabase.rpc("apply_youtube_backfill", {
    p_approval_id: approvalId,
    p_manifest_sha256: manifestSha256,
    p_user_id: userId,
    p_company_id: companyId,
    p_actor: actor,
  });
  if (error) throw new Error(`Backfill apply refused: ${error.message}`);
  console.log(JSON.stringify({ mode: "applied", approvalId: data.approval_id, manifestSha256: data.manifest_sha256,
    deliveryCount: data.deliveries.length }, null, 2));
  process.exit(0);
}

const manifestPath = args.get("manifest");
const userId = args.get("user-id");
const companyId = args.get("company-id");
const releaseAt = args.get("release-at");
const confirmation = args.get("confirm-list-sha256");
if (!manifestPath || !userId || !companyId || !releaseAt || !confirmation) {
  throw new Error("Preview requires --manifest, --user-id, --company-id, --release-at, --confirm-list-sha256, and --actor");
}
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (!Array.isArray(manifest.contentItemIds) || manifest.contentItemIds.length < 1
  || manifest.contentItemIds.some((id) => typeof id !== "string" || !uuid.test(id))
  || new Set(manifest.contentItemIds).size !== manifest.contentItemIds.length) {
  throw new Error("Manifest must contain a non-empty unique contentItemIds UUID list");
}
const listSha256 = sha256(JSON.stringify(manifest.contentItemIds));
if (confirmation !== listSha256) throw new Error(`Exact-list confirmation mismatch; reviewed SHA-256 is ${listSha256}`);
const spacingMinutes = Number(args.get("spacing-minutes") ?? "1440");
if (!Number.isSafeInteger(spacingMinutes) || spacingMinutes < 1440) throw new Error("Spacing must be at least 1440 minutes");

const { data, error } = await supabase.rpc("preview_youtube_backfill", {
  p_user_id: userId,
  p_company_id: companyId,
  p_content_item_ids: manifest.contentItemIds,
  p_release_at: new Date(releaseAt).toISOString(),
  p_spacing_minutes: spacingMinutes,
  p_actor: actor,
  p_valid_for_minutes: 30,
});
if (error) throw new Error(`Backfill preview refused: ${error.message}`);
console.log(JSON.stringify({
  mode: "previewed",
  exactListSha256: listSha256,
  approvalId: data.approval_id,
  approvalSha256: data.manifest_sha256,
  expiresAt: data.expires_at,
  candidateCount: data.candidates.length,
  releaseAt: data.release_at,
  spacingMinutes: data.spacing_minutes,
  expectedDcsrcTags: manifest.contentItemIds.map((id) => `dcsrc_${sha256(`youtube-backfill:${id}`).slice(0, 24)}`),
}, null, 2));
