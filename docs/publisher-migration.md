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
