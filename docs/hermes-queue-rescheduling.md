# Hermes queue lookup and atomic date moves

Implements #35. This is a reviewed-code release contract, not a statement that a
production migration or deployment has happened. Existing adoption/cancel/restore
remain separate actions. Moving a queued post never calls them.

## Signed API

Use the identity-bound HMAC headers and seven-line signature in
`hermes-social-bridge.md`. Tenant identity and audit actor are injected by the
verified server configuration; callers cannot supply them.

- `GET /api/hermes/v1/social-schedules/queue`: optional `limit` (1–100, default 50),
  `cursor` (last returned content item UUID), `from` and `to` (explicitly zoned ISO
  timestamps). Results are UUID ordered, not date ordered. `from` is inclusive;
  `to` is exclusive. Follow `nextCursor` until null for the complete queue.
  Returns `{ownershipEpoch,items,nextCursor}`. Includes native and migrated
  content without requiring prior Hermes adoption, excluding retired historical
  source copies. Membership may change during pagination: resolve selected IDs
  again before presenting a move.
- `GET /api/hermes/v1/social-schedules/resolve`: exactly one of `contentItemId`,
  `legacySppId`, or `scheduleId`. A legacy ID resolves to the adopted target when
  one exists, otherwise the imported content item. Returns a queue item or 404.
- `POST /api/hermes/v1/social-schedules/reschedule`: JSON
  `{expectedEpoch,approvalReference,changes}`. `changes` has 1–20 unique items,
  each `{contentItemId,expectedScheduledAt,scheduledAt,expectedContentSha256}`.
  Both times require an explicit timezone; the new time must be in the future.
  Returns `{ownershipEpoch,approvalReference,changes,replayed}` with
  `{contentItemId,previousScheduledAt,scheduledAt}` in each result change.
  HTTP 200 means the entire batch committed (or exactly replayed); there is no
  partial-success response. A conflict returns 409; missing tenant-bound IDs
  return 404. Unsupported/repeated query fields and extra body fields return 400.

Queue items contain `contentItemId`, nullable `legacySppId` and
`hermesScheduleId`, nullable `sourceSystem`/`sourceId`, `companyId`, `caption`,
`contentType`, `scheduledAt`, `approvalState`, `contentFingerprintSha256`,
`platforms` (safe delivery outcomes) and `safeToReschedule`. Responses use
`Cache-Control: private, no-store`. Provider credentials, media storage keys,
raw source metadata and raw provider errors are never included.

## Gamora's move workflow

1. List the queue and follow pagination. Match the intended post by caption,
   platform list and current date. Never infer IDs from conversation memory or
   select an arbitrary three records just because three new dates were supplied.
2. Resolve each selected stable ID. Require `safeToReschedule: true` and retain
   its exact `scheduledAt` and `contentFingerprintSha256` plus the current epoch.
3. Present the exact mapping: caption/ID, existing date, proposed date, timezone
   and platforms. Obtain Chloe's approval for this mapping before applying it.
   If the requested dates were 25, 27 and 29 September 2026 at 11:00 UTC, show
   21:00 Australia/Sydney on those dates; do not silently interpret 11:00 as local.
4. Submit all three changes in one request. Use one new request UUID and retain
   it with the exact body. Keep approvalReference a short opaque approval record
   reference, not free-form sensitive notes.
5. A timeout does not prove failure. Retry the exact body with the same UUID
   (a fresh HMAC timestamp/signature is allowed). Never generate a new UUID to
   retry an uncertain operation. A changed request with a used UUID is rejected.
6. Resolve the items again and show the verified new dates. A 409 requires a fresh
   queue/resolve preview and reconsideration; do not automatically approve a
   changed mapping. If delivery started or any platform succeeded, stop the move
   and report the actual per-platform status.

## Database guarantees

The batch reserves its request identity, locks the ownership row shared with
publisher claims, locks content, Hermes links, deliveries and applicable legacy
source rows, validates every entry, and then updates dates. Worker claims cannot
race a move. All deliveries must be pending, unleased, with zero attempts and no
provider output/reconciliation or attempt history. Draft, blocked, planning-only,
frozen, historical, cancelled, succeeded, ambiguous and partially published items
fail closed. An adopted source's delivery history is also checked, preventing a
partially published adoption from being presented as a fresh movable post.

The preview fingerprint binds current caption/media/type, approval/readiness,
platforms, immutable source hash and lifecycle version. Expected current date and
ownership epoch are checked separately. Lifecycle version increments on moves,
so an old preview cannot silently succeed after dates have moved away and back.
IDs, source provenance, approval, deliveries, idempotency keys and attempt history
remain intact. Only effective date, due times, lifecycle version, timestamps and
an existing Hermes link date change, with one audit event per item.

The legacy payload retains its original date and hash. The migration removes only
the effective-date equality from its projection constraint; a trigger still
rejects changes to legacy dates unless the private atomic RPC enables its scoped
transaction guard. Service_role has no direct table UPDATE grant. The guard is
restored before return; errors roll the transaction back. Legacy `scheduled_posts`
remain untouched because replacement ownership is required.

## Local proof and release

Run `npm run test:db` with the sanitized local fixture wrapper, `npm test`,
`npm run lint`, `npm run typecheck` and `npm run build`. The pgTAP suite covers
mixed native/imported batches, adopted ID resolution, stable IDs, immutable source
payload, request replay/conflict, tenant scoping, stale snapshots, attempts,
partial success, ambiguity, leases, dates, atomic rollback and worker due times.

For browser/HTTP proof use only a synthetic tenant on local Supabase, synthetic
HMAC keys, and `PUBLISHER_DISPATCH_ENABLED=false`; do not configure provider
credentials. A production release requires reviewed migration and app deployment
before enabling the matching Hermes tools. Humans merge and authorize release.

The local HTTP proof fixture is `supabase/fixtures/hermes_queue_demo.sql`; apply it
once after a reset, then run `node scripts/test/hermes-queue-http-proof.mjs` against
port 3117 with the synthetic configuration declared in that script. It verifies
signed pagination, an atomic three-post move, exact retry, changed-request and
stale-preview conflicts, cross-tenant 404, legacy resolution and final dates.
`node scripts/test/hermes-queue-lock-proof.mjs` uses two actual local PostgreSQL
sessions: move-first blocks the worker until its old-due claim returns zero;
claim-first blocks the move until it rejects the now-leased post. Its fixture is
isolated from the HTTP demo tenant. Run each fixture proof once per local reset.
