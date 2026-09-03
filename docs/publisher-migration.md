# Publisher queue migration

Issue #16 introduces one forward-only additive migration without changing or deleting
legacy `scheduled_posts` data. The repository previously had no Supabase CLI migration
history, so the checked-in legacy schema is test-only under `supabase/tests/setup/` and
is never part of `db push`. The additive migration performs a catalog preflight and
fails closed unless the required production-shaped legacy tables and columns exist.

Before remote migration, dump the live schema, compare the preflight contract and the
test fixture against that fresh dump, then use `supabase migration repair --status
applied <version>` only for migrations independently proven to exist. Never mark the
new additive migration applied until it has actually run, and never apply the test
fixture to production.

## Private export handling

Never copy queue payloads, captions, asset paths, or media references into Git,
terminal evidence, issues, or pull requests. The import and reconciliation scripts
print only counts and SHA-256 manifests. Each row is stored with the SHA-256 of
its deterministic canonical JSON representation; reconciliation checks both the
full parsed payload and that hash.

Dry-run validation is the default:

```sh
npm run migration:import -- \
  --export /absolute/path/to/private-export \
  --confirm-sha256 <scheduled_posts.json-sha256>
```

Adding `--apply` requires `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (the legacy
`SUPABASE_SERVICE_ROLE_KEY` name is accepted during transition). Re-running an
identical import is safe. A changed payload for an existing `legacy_spp_id` aborts
the transaction instead of overwriting history.

Run read-only reconciliation after import with the same export and checksum:

```sh
npm run migration:reconcile -- \
  --export /absolute/path/to/private-export \
  --confirm-sha256 <scheduled_posts.json-sha256>
```

All 21 queued content items remain `migration_frozen`. Article deliveries remain
`planning_only` permanently unless a separate, proven article publisher is built.
An Instagram delivery carrying either legacy `instagram_container` or
`instagram_container_since` metadata is imported as `verification_required`, with
both values preserved in `provider_reconciliation_metadata`; ownership transfer is
blocked until that provider-side container is reconciled. The frozen 2026-09-03
67-row export (21 queued, 46 historical) contains zero queued direct platform-result
IDs, sentinel values, `instagram_container` keys, or `instagram_container_since`
keys. This is a point-in-time observation only: a fresh cutoff export must still be
classified and reconciled by the same safeguards.

Resolve an ambiguous imported delivery only through the service-role-only
`resolve_legacy_delivery_verification` RPC. A provider-confirmed publication requires
a durable provider post ID and publication time and becomes terminal `succeeded`;
provider-confirmed absence returns to `migration_frozen`. Both outcomes require a
named actor and non-empty provider evidence. The RPC writes an append-only before/
after audit and refreshes the database-derived attestation in the same transaction.
The transfer RPC rejects an otherwise edited outcome unless that exact resolution is
backed by the matching immutable audit record. Provider evidence is a flat, URL-free,
maximum-4-KiB object containing only `verification_method` (`api_lookup` or
`manual_provider_check`), `verification_result` (`published` or `not_found`),
`checked_at`, and optional non-secret `provider_reference` / `reviewer_note` strings.

## Atomic ownership contract

Both schedulers must claim through the public, service-role-only database wrappers
and pass the current epoch. Privileged implementations live in the unexposed
`publisher_private` schema; the runtime has read-only table grants and cannot raw-
update ownership or delivery state:

- legacy: `claim_legacy_spp_posts`
- replacement: `claim_publisher_deliveries`

Both lock the same `publisher_queue_ownership` row. The one-way transfer RPC refuses
to run while either scheduler has a live lease, records the reconciled manifest and
cutoff, increments the epoch, and activates only publishable frozen deliveries.
Never update the ownership row directly and never call the transfer before the human
cutover sign-off.

Call `mark_publisher_dispatch_started` immediately before a provider POST. An expired
lease before that point may retry; an expired lease afterwards becomes
`verification_required`, because provider APIs do not supply a dependable request
idempotency key and an automatic retry could duplicate a live post.

If provider preparation creates a reconciliation handle before the public POST, call
`checkpoint_publisher_delivery(delivery_id, lease_token, metadata)` first. It accepts
only a non-empty JSON object, merges it into the delivery metadata only for the
replacement owner with the matching live pre-dispatch lease, and records the before/
after metadata in append-only audit history. A stale token returns `false`; a caller
must never continue to dispatch after that result. Every subsequent
`claim_publisher_deliveries` result includes `provider_reconciliation_metadata`, so a
retry can resume the persisted provider preparation instead of creating a duplicate.
Checkpoint payloads are URL-free and capped at 4 KiB; the only permitted keys are
`instagram_creation_id`, `instagram_media_kind`, `linkedin_video_urn`,
`linkedin_image_urns` (at most nine strings), and `linkedin_media_kind`. Tokens,
credentials, arbitrary URLs, and nested unapproved data are rejected.
