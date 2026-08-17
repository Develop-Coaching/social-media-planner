#!/usr/bin/env npx tsx
// Queue the promo posts that carry a published LinkedIn article into
// Social Post Pro's `scheduled_posts`, so the Vercel publish-tick cron fires
// them on schedule.
//
// The article itself is NOT published here. LinkedIn's API cannot create native
// articles, so the article goes out through the supervised browser session in
// the linkedin-article-post skill. This queues the text posts pointing at it.
//
// Reads <article-dir>/promo.md, written by the linkedin-article skill:
//
//   ---
//   article_url: https://www.linkedin.com/pulse/...
//   promo_1_time: 2026-09-15T06:45:00.000Z
//   promo_2_time: 2026-09-18T06:45:00.000Z
//   ---
//   ## Promo 1
//   <caption>
//   ## Promo 2
//   <caption>
//
// This table is shared with LIVE production, which publishes within ~5 minutes
// of a row's scheduled time. So a dry run is the default and inserting needs
// an explicit --live.
//
// Usage:
//   npx tsx scripts/enqueue-article-promo.ts --article-dir "<path>"
//   npx tsx scripts/enqueue-article-promo.ts --article-dir "<path>" --live

import { readFileSync, existsSync, statSync } from "fs";
import { basename, extname, join } from "path";
import { createClient } from "@supabase/supabase-js";

const LIVE = process.argv.includes("--live");
const BUCKET = "content-images";

// Chloe's live Develop Coaching account in Social Post Pro. Overridable, but
// these are the ids every real scheduled post in this table uses.
const DEFAULT_USER_ID = "47989f27-0109-4cdf-9608-e182af9c6f3e";
const DEFAULT_COMPANY_ID = "develop-coaching";

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function loadEnv(): { url: string; key: string } {
  // .env.local is the app's own config; it holds the service role key.
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) throw new Error("Run this from the Post Creator Software root (.env.local not found)");
  const env: Record<string, string> = {};
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  return { url, key };
}

interface Promo {
  key: string;
  scheduled: string;
  caption: string;
}

function parsePromoFile(fp: string): { articleUrl: string; promos: Promo[] } {
  const raw = readFileSync(fp, "utf8");
  if (!raw.startsWith("---")) throw new Error(`${fp} has no front matter`);
  const [, front, body] = raw.split("---", 3);

  const meta: Record<string, string> = {};
  for (const line of front.trim().split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }

  const articleUrl = meta.article_url || "";
  if (!articleUrl || articleUrl.startsWith("<")) {
    throw new Error("promo.md needs a real article_url. Publish the article first, then paste its URL.");
  }

  const promos: Promo[] = [];
  for (const section of body.split(/^##\s+/m).slice(1)) {
    const newline = section.indexOf("\n");
    const heading = section.slice(0, newline).trim();
    const caption = section.slice(newline + 1).trim();
    const n = heading.match(/(\d+)/)?.[1];
    if (!n) continue;
    const scheduled = meta[`promo_${n}_time`];
    if (!scheduled) throw new Error(`No promo_${n}_time in the front matter for "${heading}"`);
    if (!caption) throw new Error(`"${heading}" has no caption`);
    promos.push({ key: `promo-${n}`, scheduled, caption });
  }
  if (!promos.length) throw new Error('No "## Promo N" sections found in promo.md');

  return { articleUrl, promos };
}

async function main() {
  const articleDir = argValue("--article-dir");
  if (!articleDir) throw new Error('Pass --article-dir "<path to the month folder>"');

  const userId = argValue("--user-id") || DEFAULT_USER_ID;
  const companyId = argValue("--company-id") || DEFAULT_COMPANY_ID;

  const promoFile = join(articleDir, "promo.md");
  if (!existsSync(promoFile)) throw new Error(`No promo.md in ${articleDir}`);
  const cover = join(articleDir, "images", "cover.png");
  if (!existsSync(cover)) throw new Error(`No cover image at ${cover}`);

  const { articleUrl, promos } = parsePromoFile(promoFile);

  // Greg's LinkedIn rule: the link goes in the first comment, never the body,
  // because body links carry negative algorithm weight. The publisher cannot
  // post comments, so this has to stay a manual step after each post lands.
  for (const p of promos) {
    if (/https?:\/\//.test(p.caption)) {
      console.error(
        `\nREFUSING: ${p.key} has a link in the post body. On LinkedIn the link goes in ` +
        `the first comment. Remove it from the caption, then post the article URL as a ` +
        `comment once the post is live.`,
      );
      process.exit(1);
    }
  }

  // The app's uploader 413s over ~4 MB, and oversized media has broken publishes
  // before, so check the cover here rather than at publish time.
  const coverMb = statSync(cover).size / 1024 / 1024;
  if (coverMb > 4) {
    console.error(
      `\nREFUSING: cover.png is ${coverMb.toFixed(1)} MB. Resize to a web copy first ` +
      `(~1600px long edge, JPEG q85).`,
    );
    process.exit(1);
  }

  console.log(`\n${LIVE ? "LIVE" : "DRY RUN"}: article promo posts -> Social Post Pro scheduled_posts`);
  console.log(`Article:  ${articleUrl}`);
  console.log(`Cover:    ${basename(cover)} (${coverMb.toFixed(2)} MB)`);
  console.log(`Account:  user ${userId.slice(0, 8)}, company ${companyId}\n`);

  for (const p of promos) {
    console.log(`${p.key} -> ${p.scheduled}  [linkedin]`);
    console.log(`   ${p.caption.split("\n")[0].slice(0, 70)}...`);
    console.log(`   ${p.caption.split(/\s+/).length} words\n`);
  }

  console.log("After each promo post goes live, add this as the FIRST COMMENT:");
  console.log(`   ${articleUrl}\n`);

  if (!LIVE) {
    console.log("Dry run. Nothing uploaded, nothing inserted. Re-run with --live to queue.");
    return;
  }

  const { url, key } = loadEnv();
  const supabase = createClient(url, key);

  const ext = extname(cover).slice(1) || "png";
  const path = `uploads/${companyId}/${Date.now()}-article-cover.${ext}`;
  console.log(`Uploading cover to ${BUCKET}/${path}`);
  const up = await supabase.storage.from(BUCKET).upload(path, readFileSync(cover), {
    contentType: ext === "png" ? "image/png" : "image/jpeg",
    upsert: false,
  });
  if (up.error) throw new Error(`cover upload failed: ${up.error.message}`);

  const rows = promos.map((p) => ({
    user_id: userId,
    company_id: companyId,
    content_type: "post",
    caption: p.caption,
    // upload_paths are signed into fresh 1h URLs at publish time, so the media
    // never goes stale the way a pre-signed URL would.
    upload_paths: [path],
    image_keys: [] as string[],
    media_urls: [] as string[],
    platforms: ["linkedin"],
    scheduled_at: p.scheduled,
    status: "queued",
  }));

  const { data, error } = await supabase.from("scheduled_posts").insert(rows).select("id, scheduled_at, status");
  if (error) throw new Error(`insert failed: ${error.message}`);
  console.log(`\nQueued ${data?.length ?? 0} posts:`);
  for (const r of data ?? []) console.log(`  ${(r as any).id}  ${(r as any).scheduled_at}  ${(r as any).status}`);
  console.log("\nThese are LIVE. They will publish at their scheduled time.");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
