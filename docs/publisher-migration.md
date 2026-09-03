# Publisher queue migration

Issue #16 introduces a forward-only replacement queue without changing or deleting
legacy `scheduled_posts` data. The first migration is a snapshot of the repository's
existing SQL schema because this project previously had no Supabase CLI migration
history. Before any remote migration, compare that baseline with production and mark
it applied; do not execute the baseline over the existing database blindly.

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

## Atomic ownership contract

Both schedulers must claim through the database RPCs and pass the current epoch:

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
