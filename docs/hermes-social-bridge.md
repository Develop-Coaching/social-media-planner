# Hermes social scheduling bridge

This bridge lets Hermes move one already-approved imported Social Post Pro item
onto the deterministic replacement publisher. It does not give Hermes Meta or
LinkedIn credentials. Hermes can preview, adopt, inspect, soft-cancel, and
restore a schedule; only the existing publisher worker can call the platforms.

The bridge is inactive until all of these are true:

1. the additive migration has been reviewed and applied;
2. `publisher_queue_ownership.source = legacy_spp` has `owner = replacement`;
3. Hermes has the current ownership epoch and a separately provisioned HMAC key;
4. the replacement publisher deployment is active and its dispatch gate has
   been deliberately enabled by an operator.

Production is currently rolled back to Vercel deployment
`AB86c2PELMezMDjGJjqGo3W8YbLn`. Do not migrate, deploy, change cron/ownership,
or enable dispatch as part of reviewing this PR.

## Wire contract

Base path: `/api/hermes/v1/social-schedules`.

Every request must include:

- `X-Hermes-Key-Id`: the configured non-secret key identifier;
- `X-Hermes-Timestamp`: Unix seconds, within 300 seconds of server time;
- `X-Hermes-Request-Id`: a UUID (new for each mutation; retries reuse it);
- `X-Hermes-Signature`: lowercase hexadecimal HMAC-SHA256.

The signature input is five newline-separated values:

```text
METHOD
PATH?CANONICAL_QUERY
UNIX_TIMESTAMP
REQUEST_UUID
LOWERCASE_SHA256_OF_EXACT_RAW_BODY_BYTES
```

`METHOD` is uppercase. Decoded query pairs are sorted by key and then value
using code-point order, then rendered with JavaScript `URLSearchParams`. The
`?` is omitted when there is no query. JSON request bodies use recursively
key-sorted compact JSON; the verifier hashes the exact bytes sent over HTTP.
Requests over 16 KiB fail closed. Mutation UUIDs are stored in the database: an exact retry
returns the stored result with `replayed: true`; reuse with a different signed
request digest returns `409`.

Endpoints:

- `GET /legacy/{legacySppId}?companyId=...` previews the imported candidate and
  returns its approval state, immutable content fingerprint, inherited platform
  states, and `safeToAdopt`.
- `POST /adopt` accepts
  `{expectedEpoch,companyId,legacySppId,scheduledAt,approvalReference,expectedContentSha256}`.
- `GET /{scheduleId}?companyId=...` returns the safe per-platform outcome.
- `POST /{scheduleId}/cancel` accepts
  `{expectedEpoch,companyId,reason}`.
- `POST /{scheduleId}/restore` accepts
  `{expectedEpoch,companyId,scheduledAt}`.

The audit actor is not caller-supplied. After HMAC verification the server
derives it as `hermes:{validated-key-id}`.

Platforms are never accepted from Hermes. They are inherited from the approved
source. The protected live schedule ID
`367259e6-69af-461d-8510-09bd7eb6aea7` is hard-denied by the adoption RPC.

## How Chloe schedules through Hermes

1. Ask Hermes to preview the approved Social Post Pro item, supplying its ID and
   company ID. Confirm `safeToAdopt: true`, the platforms, and current schedule.
2. Keep the returned `contentFingerprintSha256`. Record the human approval in an
   opaque reference such as an internal approval record ID; do not put tokens,
   passwords, post copy, or personal notes in `approvalReference`.
3. Ask Hermes to adopt the item at an ISO-8601 future time using the previewed
   fingerprint and current replacement ownership epoch. Hermes must generate one
   mutation UUID and retain it for transport retries.
4. Keep the returned `scheduleId`. Poll its signed status endpoint for the
   per-platform states. `succeeded` platforms have terminal provider IDs and are
   never re-created by cancel or restore.
5. To withdraw a future schedule, use signed `cancel`. This is recoverable while
   no provider dispatch is leased or ambiguous. Use `restore` with a new future
   time to reactivate only cancelled, unfinished platforms.

Adoption is one database transaction. It checks replacement ownership/epoch,
tenant, approval, immutable content fingerprint, the legacy source row, leases,
and ambiguity; soft-cancels the legacy schedule; preserves terminal successes;
and creates one native delivery per unfinished inherited platform. Any failed
check rolls the entire transaction back.

An exact retry may be re-signed with a fresh timestamp after the original
five-minute signature window. Database idempotency compares a digest binding the
method, canonical path/query, and exact raw-body SHA-256 plus the mutation
operation and tenant; changing the body/target or using the UUID for a different
operation returns `409`.

## Safe end-to-end test (no public platform writes)

Use only a local Supabase stack, synthetic UUIDs, and injected synthetic
publisher adapters. Never use production exports, real access tokens, real page
IDs, or the protected schedule ID.

1. Start Docker, run `npx supabase@2.116.0 start`, then
   `npx supabase@2.116.0 db reset` and
   `npx supabase@2.116.0 test db`.
2. Set local-only HMAC values and leave `PUBLISHER_DISPATCH_ENABLED=false`.
   Run the app on a non-production port.
3. Insert the synthetic tenant/import/schedule fixture used by
   `supabase/tests/hermes_social_bridge.test.sql`. Do not import a production
   manifest.
4. Sign a preview and adoption request with the local HMAC secret. Verify the
   old synthetic schedule becomes `cancelled`, one Hermes link exists, and only
   unfinished inherited platforms have one pending native delivery.
5. Repeat the identical request UUID/body and verify `replayed: true` and no new
   rows. Reuse the UUID with a changed body and verify `409`. Exercise wrong
   tenant, epoch, fingerprint, live lease, and ambiguous state failures.
6. Exercise cancel and restore. Verify succeeded/verification-required outcomes
   never change and audit rows contain only IDs, references, fingerprints,
   timestamps, and state—not credentials.
7. Run the publisher worker only with synthetic adapters that return fixed
   provider IDs. Confirm the status endpoint records one outcome per platform.
   Do not configure `META_*` or `LINKEDIN_*` credentials.
8. Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.

## Human-controlled release sequence

After PR approval, and only in a maintenance window:

1. Confirm the deployed code contains the replacement publisher and matches the
   reviewed commit. The rolled-back deployment does not satisfy this gate.
2. Back up the database and record current ownership, epoch, queue counts, live
   leases, verification-required rows, and the reconciliation attestation.
3. Apply `20260903061000_create_hermes_social_bridge.sql` once. Run database
   advisors and verify the service-role-only grants before adding secrets.
4. Deploy with a newly generated 32-byte-or-longer
   `HERMES_SOCIAL_BRIDGE_HMAC_SECRET` and a versioned
   `HERMES_SOCIAL_BRIDGE_KEY_ID`. Provision the same secret only to the
   deterministic Hermes caller, never to a free-form agent prompt or log sink.
5. Keep publisher dispatch disabled. Run signed GET smoke tests and a synthetic
   or non-publishing mutation test approved for the environment.
6. Separately approve and execute the existing replacement ownership transfer
   runbook. Update the configured epoch to the returned epoch.
7. Enable the replacement dispatch gate only after queue reconciliation and
   operator sign-off. Observe claims and per-platform outcomes before scheduling
   a real item through Hermes.

Rollback is operational, not destructive: disable Hermes ingress by removing or
rotating its key, leave dispatch gated, and soft-cancel affected Hermes schedules
where safe. Do not reverse the additive migration or delete audit/history rows.
