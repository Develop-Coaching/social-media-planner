# Native publisher ingestion

Approved content from another Develop Coaching system enters the replacement publisher through one idempotent server boundary. Browser clients never receive the Supabase service role and cannot call the database RPC directly.

## HTTP contract

`POST /api/publisher/ingest` requires an authenticated agent or administrator with access to `companyId`. The server derives the owning `userId`; a caller cannot choose another tenant.

```json
{
  "companyId": "develop-coaching",
  "sourceSystem": "greg_brain",
  "sourceId": "stable-source-record-id",
  "contentType": "post",
  "caption": "Approved caption",
  "media": {},
  "scheduledAt": "2026-09-10T23:00:00.000Z",
  "platforms": ["instagram", "facebook", "linkedin"],
  "mediaState": "blocked",
  "mediaBlockReason": "Graphic not attached",
  "contentState": "ready",
  "sourceMetadata": {
    "graphic_prompt": "Create the approved visual brief",
    "audit": "posts.json",
    "audit_index": 12,
    "originally_scheduled_for": "2026-08-01T00:00:00Z",
    "content_fingerprint_sha256": "64-lowercase-hex-characters"
  }
}
```

The response is `201` for a new item and `200` for an exact replay. It contains `content_item_id`, `created`, the derived `publishability` and `media_state`, plus each delivery's ID, platform, and state.

Source identity is unique within `(user_id, company_id, source_system, source_id)`. The database persists an immutable normalized ingestion envelope and SHA-256 fingerprint. An exact replay returns the original IDs even after media attachment or guarded release changes the current row. A different envelope fails with HTTP `409`; it never overwrites queued content. Invalid database payloads return HTTP `400`.

## Guarded release contract

`POST /api/publisher/release` requires the same agent/admin authentication and company access. It is the only HTTP action that edits and re-approves blocked copy, attaches blocked media, or reschedules stale native work.

```json
{
  "companyId": "develop-coaching",
  "sourceSystem": "greg_brain",
  "sourceId": "stable-source-record-id",
  "scheduledAt": "2026-09-12T23:00:00.000Z",
  "expectedLifecycleVersion": 3,
  "caption": "Corrected caption when content was blocked",
  "media": { "upload_paths": ["owner-id/develop-coaching/generated/graphic.png"] }
}
```

`expectedLifecycleVersion` is required and must come from a fresh `GET /api/publisher/queue` item. The database locks the tenant-scoped item and its deliveries and compares this revision before any mutation; a stale revision returns HTTP `409`. `caption` is required only to clear `blocked_content`; `media` is required only to clear `blocked_media`; stale ready work needs only a new future schedule.

The response contains `content_item_id`, `released`, `scheduled_at`, the resulting `lifecycle_version`, and pending deliveries. A successful mutation advances the version and stores its bounded response fingerprint. An exact retry of that completed release is recognized before the version comparison and returns `released=false` with the original resulting version and identical item/schedule/pending-delivery snapshot, even if downstream delivery has since progressed. This lets a client safely recover after losing the first response. A different release after any delivery attempt still fails closed.

## Guarded states

- Ingestion always writes `approval_state=approved` and `migration_state=native`; callers cannot supply those fields.
- Ordinary `post`, `carousel`, `reel`, `video`, and `quote` items are publishable. Blocked media creates every requested delivery in `blocked_media`, which the claim RPC excludes.
- Content that is approved inventory but cannot be published unchanged uses `contentState=blocked`, a required `contentBlockReason`, and `blocked_content` deliveries. This is separate from missing media. LinkedIn captions over 3,000 characters are rejected unless explicitly represented in this blocked state.
- A ready Instagram post needs an image/video asset, a carousel needs at least two assets, and a reel/video needs uploaded media. Native ingestion rejects all external `media_urls` and `video_url` values. Storage paths and covers must begin with the exact owning tenant prefix (`user_id/company_id/…` or `uploads/user_id/company_id/…`), contain no traversal, and are signed only at dispatch. Facebook/LinkedIn ordinary posts may be text-only.
- `article` is accepted only for LinkedIn, becomes `planning_only`, and is never API-publishable; its planning copy is not constrained by the API post-caption limit.
- `sourceMetadata` is non-dispatch metadata. Only the five documented keys are accepted, and publisher workers never receive it. The operator queue exposes only a sanitized graphic prompt.
- Media is resolved through the guarded release or service-role-only `attach_native_publisher_media` RPC. It works only before any delivery attempt. Media-only blockers become `pending`; independently content-blocked items remain `blocked_content` until corrected through release.
- New publishable inventory must be scheduled in the future. Native pending/retryable deliveries that miss their schedule by more than 15 minutes become `stale_schedule` instead of being dispatched as a catch-up burst.
- The operator queue exposes `lifecycleVersion`. Media attachment, release, and stale quarantine advance it, preventing an operator from releasing a row whose eligible pre-state changed after it was read.

The database wrappers are executable only by `service_role`. That role retains SELECT-only table grants, so ingestion and media release cannot be bypassed with direct writes.

## Verification

Run `npm run test:db` with a Docker-compatible runtime available. The pgTAP suite covers exact/conflicting and post-mutation replay, tenant isolation, tenant-bound media, blocked claims, planning-only articles, stale quarantine, audited release, and attempted-delivery rejection. The application gate is `npm run lint && npm run typecheck && npm test && npm run build`.
