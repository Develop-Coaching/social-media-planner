# Controlled YouTube backfill

This runbook is for issue #37. It never discovers or replays blanket history. The operator supplies an exact reviewed manifest of `publisher_content_items.id` values, a tenant, and a future quota-paced release schedule. The database rejects any list containing an item that is cross-tenant, cancelled, blocked, not a reel/video, missing video, already represented on YouTube, or lacking a successful active-social delivery. The manifest's audit evidence records the 2026-09-28 read-only production mapping; it is documentation only and is never trusted by the RPC.

## Safety sequence

1. Review the JSON manifest and compute its exact-list checksum locally:
   `node -e "const fs=require('fs'),c=require('crypto'),m=JSON.parse(fs.readFileSync('docs/runbooks/youtube-backfill-2026-09-28.json')); console.log(c.createHash('sha256').update(JSON.stringify(m.contentItemIds)).digest('hex'))"`
2. Run preview with the production tenant supplied at execution time. Do not put tenant IDs or credentials in this repository. Use a future release time and at least 1440 minutes between uploads:
   `npm run migration:youtube-backfill -- --manifest docs/runbooks/youtube-backfill-2026-09-28.json --user-id '<owner>' --company-id '<company>' --release-at '<ISO timestamp>' --spacing-minutes 1440 --actor '<operator>' --confirm-list-sha256 '<checksum>'`
3. Before apply, inspect the exact candidates and scan the channel's uploads with `playlistItems.list` plus `videos.list`. Compare every emitted `expectedDcsrcTag` against video snippet tags. Also review rewritten titles and the video itself, because old uploads may predate `dcsrc`. If any match is found, do not apply; replace the reviewed manifest and preview again.
4. Apply only the unexpired approval returned by preview:
   `npm run migration:youtube-backfill -- --apply --approval-id '<approval UUID>' --approval-sha256 '<approval SHA-256>' --user-id '<owner>' --company-id '<company>' --actor '<operator>'`
5. Confirm one pending YouTube delivery per approved item, spaced by at least one day. The worker checkpoints `youtube_media_kind=short` and the deterministic `dcsrc` tag before `videos.insert`. After each upload, reconcile the public video ID and tag before the next scheduled release.

Preview and apply are both audited. Approvals expire after 30 minutes, cannot be replayed, and become stale if any candidate evidence changes. Planned YouTube slots are transactionally kept at least 24 hours apart across backfills and ordinary scheduling. Residual: standard worker retry backoff is intentionally not rewritten; a delayed or retried dispatch can compress wall-clock publication times even though the approved plan is one per day. Pause subsequent releases manually if reconciliation shows that happened. Never edit the migration to embed a production list and never use this workflow for unreviewed history.
