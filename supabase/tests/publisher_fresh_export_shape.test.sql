begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into public.companies (user_id, id, name)
values ('fresh-user', 'fresh-company', 'Sanitized Fresh Export Fixture');

create temporary table fresh_export as
select jsonb_build_object(
  'id', '30000000-0000-0000-0000-' || lpad(i::text, 12, '0'),
  'user_id', 'fresh-user',
  'company_id', 'fresh-company',
  'saved_content_id', null,
  'item_id', 'fresh-' || i,
  'content_type', case when i <= 14 then 'article' when i <= 19 then 'reel' else 'post' end,
  'caption', 'Sanitized fresh caption ' || i,
  'image_keys', '[]'::jsonb,
  'media_urls', '[]'::jsonb,
  'upload_paths', '[]'::jsonb,
  'video_url', null,
  'cover_path', null,
  'platforms', jsonb_build_array('linkedin'),
  'platform_post_ids', '{}'::jsonb,
  'scheduled_at', to_jsonb(statement_timestamp() + interval '4 hours' + i * interval '1 minute'),
  'status', case when i <= 19 then 'queued' when i <= 50 then 'published' else 'cancelled' end,
  'error', null,
  'retry_count', 0,
  'created_at', to_jsonb('2026-08-01'::timestamptz),
  'updated_at', to_jsonb('2026-08-02'::timestamptz),
  'published_at', case when i between 20 and 50 then to_jsonb('2026-08-02'::timestamptz) else 'null'::jsonb end
) payload
from generate_series(1, 67) generated(i);

create temporary table first_import as
select public.import_legacy_spp_rows(jsonb_agg(payload order by payload->>'id')) result
from fresh_export;

select is((select count(*)::integer from public.publisher_content_items), 67, 'fresh complete export imports all content');
select is((select count(*)::integer from public.publisher_content_items where migration_state='migration_frozen'), 19, 'current queued count is derived from the fresh export');
select is((select count(*)::integer from public.publisher_content_items where migration_state='historical'), 48, 'current historical count is derived from the fresh export');
select is((select (result->>'inserted_content_items')::integer from first_import), 67, 'first fresh import reports all inserts');

select is(
  (public.import_legacy_spp_rows((select jsonb_agg(payload order by payload->>'id') from fresh_export))->>'unchanged_content_items')::integer,
  67,
  'identical fresh import is idempotent'
);

select throws_ok(
  $$select public.import_legacy_spp_rows((select jsonb_agg(payload order by payload->>'id') from fresh_export where payload->>'id' <> '30000000-0000-0000-0000-000000000067'))$$,
  '22023',
  'legacy import must contain all 67 unique rows for one tenant with valid statuses and platforms',
  'incomplete fresh export fails closed'
);

insert into public.scheduled_posts (
  id, user_id, company_id, saved_content_id, item_id, content_type, caption,
  image_keys, media_urls, video_url, platforms, scheduled_at, status,
  platform_post_ids, error, retry_count, created_at, updated_at, published_at,
  upload_paths, cover_path
)
select r.id, r.user_id, r.company_id, r.saved_content_id, r.item_id,
       r.content_type, r.caption, r.image_keys, r.media_urls, r.video_url,
       r.platforms, r.scheduled_at, r.status, r.platform_post_ids, r.error,
       r.retry_count, r.created_at, r.updated_at, r.published_at,
       r.upload_paths, r.cover_path
from fresh_export s
cross join lateral jsonb_populate_record(null::public.scheduled_posts, s.payload) r;

create temporary table fresh_readiness_rows as
select ci.legacy_payload || jsonb_build_object('__migration_payload_sha256', ci.legacy_payload_sha256) payload
from public.publisher_content_items ci
where ci.legacy_spp_id is not null;

create temporary table fresh_readiness as
select public.publisher_cutover_readiness(
  (select jsonb_agg(payload order by payload->>'id') from fresh_readiness_rows),
  1,
  3600
) result;

select ok((select (result->>'ready')::boolean from fresh_readiness), 'readiness accepts the fresh status distribution');
select is((select (result->'counts'->>'queued')::integer from fresh_readiness), 19, 'readiness reports dynamic queued count');
select is(
  public.transfer_publisher_queue_ownership(
    (select jsonb_agg(payload order by payload->>'id') from fresh_readiness_rows),
    1,
    3600
  ),
  2::bigint,
  'transfer accepts the reconciled fresh status distribution'
);

select * from finish();
rollback;
