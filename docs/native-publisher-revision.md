# Replace an unattempted native scheduled post

`POST /api/publisher/revise` atomically replaces the caption, video/image paths,
cover path and publish time on an existing approved native booking. It preserves
content/delivery IDs and platform selection, so the superseded assets cannot remain
in a second pending booking. The existing ingestion envelope stays immutable.
Blocked-content release and legacy/adopted work keep their existing contracts.

This endpoint requires an authenticated agent/admin session and company access.
The server derives the owner and audit actor; body fields cannot choose either.
The database wrapper is service-role-only; direct table writes remain revoked.

```json
{
  "requestId": "10000000-0000-4000-8000-000000000001",
  "companyId": "demo-company",
  "contentItemId": "20000000-0000-4000-8000-000000000001",
  "expectedEpoch": 2,
  "expectedLifecycleVersion": 0,
  "caption": "Approved replacement copy",
  "media": {
    "upload_paths": ["demo-owner/demo-company/revised.mp4"],
    "cover_path": "demo-owner/demo-company/revised-cover.png"
  },
  "scheduledAt": "2099-10-31T08:30:00Z",
  "approvalReference": "human-approved-revision-reference"
}
```

Use a fresh queue read for the stable content ID and lifecycle version, and a fresh
ownership read for the epoch. Obtain approval for the exact new copy, assets,
platforms and time. Verify uploaded objects and SHA-256 hashes before submitting.
Use a fresh request UUID for each distinct operation and retain it with the exact
body. The SQL RPC uses the same fields with `p_` snake-case names plus derived
`p_user_id` and `p_actor`.

Success includes `content_item_id`, `revised`, `replayed`, `scheduled_at`,
`lifecycle_version`, and the unchanged delivery IDs/platforms. An uncertain request
must be retried with the identical body and UUID. The database computes the payload
fingerprint itself. An exact replay returns the original receipt even after the
schedule passes or downstream delivery advances; it never rewrites that later work.
A UUID reused with different arguments fails with 409. Fresh operations require a
future finite time, the replacement ownership epoch and the expected version.

Only ready native publishable content with source provenance and exclusively
unattempted pending deliveries is eligible. Leases, attempt history, provider IDs,
reconciliation handles, any succeeded/ambiguous/nonpending delivery, imported rows
and Hermes source/target links prevent revision. An ownership lock serializes this
operation against claims; item/delivery locks and the version guard prevent stale
or partial edits. The transaction updates every next-attempt time together and
writes an immutable before/after audit and durable receipt. A failure commits none
of these changes.

## Rollout

A human must merge the reviewed PR and approve the additive migration/deployment.
Apply the migration before deploying the endpoint. No ownership transfer, cron
change, legacy scheduling write, test post or provider dispatch is part of rollout.
Do not run a database test reset against production or another developer's local
stack. Use an isolated local project for Docker migrations and synthetic tenant
browser checks, with dispatch disabled and no provider credentials.

After deployment, refresh the exact booking, submit the approved revision once,
then verify the same content/delivery IDs, new caption/asset paths, future schedule,
approval/media/content readiness and pending next-attempt times. Verify that the old
assets and old timestamp are absent from all active bookings for this content.
Keep the replaced files for recovery; do not delete them from storage or bypass
leases if a delivery has begun. In a conflict, re-read and obtain approval for the
changed state instead of silently changing the expected version.

## Local validation for issue #41

App lint, typecheck, 137 tests and production build pass. The SQL suite adds 65
assertions, including replay across database session time zones. A separate local
two-session worker/revision proof exercises both lock orders.

The browser used a synthetic admin and tenant against an isolated Docker database
with provider dispatch disabled. Replacement returned HTTP 200 with both original
Facebook/Instagram delivery IDs; identical retry returned the same receipt with
`replayed: true`; conflicting retry returned HTTP 409. The temporary HTML harness
is test scaffolding, not a product UI.

The clean migration baseline lacks existing application auth prerequisites:
`users.onboarding_completed`, `users.email` and service-role SELECT grants on
`users`, `companies`, `company_assignments`. Those were supplied only to the local
synthetic browser environment; this migration does not expand those grants or alter
the existing authentication schema. A clean database still needs the application's
normal auth/bootstrap provisioning.

On this macOS host, CLI pgTAP discovery in the temporary workdir reported NOTESTS
because Docker mounts `/tmp` through `/private/tmp`. Each test file was instead
streamed to isolated-container `psql` with ON_ERROR_STOP and TAP failure detection.
