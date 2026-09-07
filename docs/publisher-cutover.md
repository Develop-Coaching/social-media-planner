# Publisher ownership cutover (human-run only)

This runbook transfers one legacy queue to the replacement publisher. It is not an
authorization to deploy or publish. Chloe must approve the exact release, fresh
export checksum, epoch and cutoff window. A human merges the stacked PRs and performs
every production action. Never use the old cron as rollback after ownership changes.

## Evidence that must exist before scheduling the window

- Reviewed migration, runtime and operator PRs are merged in stack order.
- A production-shaped Docker migration has run from a fresh database through all 170
  pgTAP assertions, concurrent-claim tests and Supabase security/performance advisors.
- Lint, typecheck, tests, production build and dependency audit have no unexplained
  release blockers.
- A signed-in demo tenant has completed create/schedule/cancel and a second-tenant
  denial test in a 390 px browser viewport. Read-only Meta and LinkedIn identity,
  permission and media-readiness checks match the intended accounts. No test post is
  made without explicit approval.
- Vercel configuration has been reviewed by a human. The replacement dispatch flag
  remains false and the legacy owner/epoch are recorded.
- Open PRs #12 and #14 are rebased onto the replacement or retired; #13 is reconciled
  with the replacement health endpoint. Do not merge their old cron/types/UI over the
  stack.

## Fresh export and frozen import

1. Prevent new scheduling in the legacy UI, but leave its claimant running while the
   export is taken. Record UTC and local time, operator, commit SHAs and current epoch.
2. Export **all** `scheduled_posts` rows plus related history/media references into a
   private `0600` directory outside Git. Do not reuse the 2026-09-03 snapshot.
3. Compute SHA-256 checksums, inspect file permissions, and verify every queued asset
   reference is readable. Never paste captions, asset paths, tokens or signed URLs in
   a PR or terminal evidence.
4. Run the import dry-run with the exact checksum, then the atomic `--apply` import.
   It must remain frozen. Re-run it once to prove identical-import idempotency; a
   changed payload must fail.
5. Run `npm run migration:reconcile` against the same export/checksum. Require zero
   differences across IDs, tenant/company, type, caption/payload hash, platform,
   schedule, state, durable provider ID and reconciliation metadata.
6. Resolve every `verification_required` legacy delivery by read-only provider lookup.
   Use only `resolve_legacy_delivery_verification`; never edit imported rows. Record
   safe, URL-free evidence. Re-run reconciliation after each resolution.

## Choose the cutoff from current state

Do this immediately before handoff, not from an earlier report. Choose a quiet window
with enough time before the next publishable job to abort safely. Run:

```sh
npm run migration:cutover-readiness -- \
  --export /absolute/private/export \
  --confirm-sha256 <fresh-scheduled-posts-sha256> \
  --expected-epoch <recorded-epoch> \
  --safety-seconds 1800
```

The command is read-only and executes one service-only database readiness RPC. Require
`ready: true`. The database binds every supplied row/hash to both source and imported
payload, proves the exact item/delivery sets, uses `statement_timestamp()`, compares
both schedulers' due sets and lease shapes, and enforces the safety interval before
the next publishable item. If any check changes, abandon the window and repeat the
export/import/reconciliation; do not force the transfer.

## Atomic handoff

1. With Chloe's explicit approval, disable the legacy Vercel cron trigger. Confirm in
   logs that no old cron request is running or arriving. Do not delete the deployment.
2. Run the readiness command again. Require the same epoch and all checks true.
3. Invoke `npm run migration:transfer-ownership` exactly once with `--apply`, the
   fresh export/checksum, expected project host, epoch and safety interval, with exact
   confirmation `TRANSFER:<host>:<epoch>:<safety-seconds>:<export-sha256>`. The
   database derives the recorded cutoff from its own transaction time. This reruns readiness
   immediately before transfer, locks shared ownership, rejects any lease or
   reconciliation drift, increments the epoch and activates
   only unfinished publishable deliveries. Articles remain planning-only.
4. Record returned epoch and transaction time. Immediately prove: owner is
   `replacement`; old claim with the prior epoch fails/returns no work; replacement
   due set exactly matches the reconciled publishable set; there are no duplicate
   legacy idempotency keys and no unexpected active article deliveries.
5. Enable replacement dispatch with the returned epoch. Observe the first eligible
   delivery on each platform through claim, checkpoint, dispatch and durable provider
   ID. Stop and require human verification on any indeterminate provider response.

## Abort and recovery

Before step 3, abort by leaving ownership with `legacy`, keeping imported rows frozen,
and re-enabling only the unchanged legacy trigger if it was stopped. After step 3,
never restart the old cron: ownership transfer is one-way and the prior epoch is
invalid. Disable replacement dispatch, preserve both databases/deployments read-only,
inspect audit/attempt records and reconcile provider-side before resuming. Rotate
secrets and archive the old deployment only after the observation window is signed
off; do not delete evidence.
