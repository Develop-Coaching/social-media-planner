begin;
create extension if not exists pgtap with schema extensions;
select plan(82);

select has_table('public', 'publisher_queue_ownership', 'ownership controller exists');
select has_table('public', 'publisher_content_items', 'content items exist');
select has_table('public', 'publisher_deliveries', 'deliveries exist');
select has_table('public', 'publisher_delivery_attempts', 'attempts exist');
select has_table('public', 'publisher_audit_log', 'audit log exists');

select ok(
  (select bool_and(c.relrowsecurity)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in (
     'publisher_queue_ownership', 'publisher_content_items', 'publisher_deliveries',
     'publisher_delivery_attempts', 'publisher_audit_log'
   )),
  'RLS is enabled on every publisher table'
);
select ok(not has_table_privilege('anon', 'public.publisher_content_items', 'select'), 'anon has no content grant');
select ok(not has_table_privilege('authenticated', 'public.publisher_content_items', 'select'), 'authenticated has no content grant');
select ok(has_table_privilege('service_role', 'public.publisher_content_items', 'select'), 'service role can read content');
select ok(not has_table_privilege('service_role', 'public.publisher_queue_ownership', 'delete'), 'service role cannot delete ownership controller');
select ok(not has_table_privilege('service_role', 'public.publisher_content_items', 'delete'), 'service role cannot delete content');
select ok(not has_table_privilege('service_role', 'public.publisher_deliveries', 'delete'), 'service role cannot delete deliveries');
select ok(not has_table_privilege('service_role', 'public.publisher_delivery_attempts', 'delete'), 'service role cannot delete attempts');
select ok(not has_table_privilege('service_role', 'public.publisher_audit_log', 'update'), 'service role cannot update audit history');
select ok(not has_table_privilege('service_role', 'public.publisher_audit_log', 'delete'), 'service role cannot delete audit history');
select ok(not has_table_privilege('service_role', 'public.publisher_content_items', 'insert'), 'service role cannot bypass content import RPC');
select ok(not has_table_privilege('service_role', 'public.publisher_content_items', 'update'), 'service role cannot mutate legacy content directly');
select ok(not has_table_privilege('service_role', 'public.publisher_deliveries', 'update'), 'service role cannot mutate delivery state directly');
select ok(not has_table_privilege('service_role', 'public.publisher_audit_log', 'insert'), 'service role cannot forge audit history directly');
select ok(not has_function_privilege('anon', 'public.claim_publisher_deliveries(bigint,integer,integer,timestamptz)', 'execute'), 'anon cannot claim');
select ok(not has_function_privilege('authenticated', 'public.claim_publisher_deliveries(bigint,integer,integer,timestamptz)', 'execute'), 'authenticated cannot claim');
select ok(has_function_privilege('service_role', 'public.claim_publisher_deliveries(bigint,integer,integer,timestamptz)', 'execute'), 'service role can claim');
select ok(not has_function_privilege('anon', 'public.resolve_legacy_delivery_verification(uuid,text,text,timestamptz,text,jsonb)', 'execute'), 'anon cannot resolve legacy verification');
select ok(not has_function_privilege('authenticated', 'public.resolve_legacy_delivery_verification(uuid,text,text,timestamptz,text,jsonb)', 'execute'), 'authenticated cannot resolve legacy verification');
select ok(has_function_privilege('service_role', 'public.resolve_legacy_delivery_verification(uuid,text,text,timestamptz,text,jsonb)', 'execute'), 'service role can resolve legacy verification');
select ok(not has_function_privilege('anon', 'public.checkpoint_publisher_delivery(uuid,uuid,jsonb)', 'execute'), 'anon cannot checkpoint provider metadata');
select ok(not has_function_privilege('authenticated', 'public.checkpoint_publisher_delivery(uuid,uuid,jsonb)', 'execute'), 'authenticated cannot checkpoint provider metadata');
select ok(has_function_privilege('service_role', 'public.checkpoint_publisher_delivery(uuid,uuid,jsonb)', 'execute'), 'service role can checkpoint provider metadata');

set local role authenticated;
select throws_ok(
  $$select * from public.publisher_content_items$$,
  '42501',
  'permission denied for table publisher_content_items',
  'authenticated caller cannot read another tenant'
);
select throws_ok(
  $$insert into public.publisher_content_items (user_id, company_id, content_type) values ('other', 'tenant', 'post')$$,
  '42501',
  'permission denied for table publisher_content_items',
  'authenticated caller cannot write another tenant'
);
reset role;

insert into public.companies (user_id, id, name)
values ('fixture-user', 'fixture-company', 'Sanitized Fixture');

create temporary table sanitized_export (payload jsonb not null);
insert into sanitized_export (payload)
select jsonb_build_object(
  'id', '00000000-0000-0000-0000-' || lpad(i::text, 12, '0'),
  'user_id', 'fixture-user',
  'company_id', 'fixture-company',
  'saved_content_id', null,
  'item_id', 'sanitized-' || i,
  'content_type', case when i <= 14 then 'article' else 'reel' end,
  'caption', 'Sanitized fixture caption ' || i,
  'image_keys', '[]'::jsonb,
  'media_urls', case when i between 15 and 21 then jsonb_build_array('https://example.invalid/media-' || i) else '[]'::jsonb end,
  'upload_paths', '[]'::jsonb,
  'video_url', null,
  'cover_path', null,
  'platforms', case when i <= 14 then jsonb_build_array('linkedin')
                    when i <= 21 then jsonb_build_array('instagram', 'facebook', 'linkedin')
                    else jsonb_build_array('linkedin') end,
  'scheduled_at', to_jsonb('2026-09-01 00:00:00+00'::timestamptz + i * interval '1 hour'),
  'status', case when i <= 21 then 'queued' when i <= 50 then 'published' else 'cancelled' end,
  'platform_post_ids', '{}'::jsonb,
  'error', null,
  'retry_count', 0,
  'created_at', to_jsonb('2026-08-01 00:00:00+00'::timestamptz),
  'updated_at', to_jsonb('2026-08-01 00:00:00+00'::timestamptz),
  'published_at', case when i between 22 and 50 then to_jsonb('2026-08-02 00:00:00+00'::timestamptz) else 'null'::jsonb end
)
from generate_series(1, 67) as generated(i);

select is(
  (public.import_legacy_spp_rows((select jsonb_agg(payload order by payload->>'id') from sanitized_export))->>'inserted_content_items')::integer,
  67,
  'all 67 legacy records import'
);
select is((select count(*)::integer from public.publisher_content_items where legacy_spp_id is not null), 67, '67 legacy IDs preserved');
select is((select count(*)::integer from public.publisher_content_items where migration_state = 'migration_frozen'), 21, '21 queued jobs import frozen');
select is((select count(*)::integer from public.publisher_content_items where migration_state = 'historical'), 46, '46 historical rows preserved');
select is((select count(*)::integer from public.publisher_content_items where publishability = 'planning_only'), 14, '14 article reminders are planning only');
select is((select count(*)::integer from public.publisher_content_items where migration_state = 'migration_frozen' and content_type = 'reel'), 7, '7 queued reels preserved');
select throws_ok(
  format(
    'select public.checkpoint_publisher_delivery(%L, %L, %L::jsonb)',
    (select id from public.publisher_deliveries limit 1), gen_random_uuid(), '{"prepare_handle":"sanitized"}'
  ),
  '40001',
  'replacement publisher does not own the queue',
  'provider checkpoint is denied before replacement ownership'
);
select is((select count(distinct user_id || chr(0) || company_id)::integer from public.publisher_content_items), 1, 'fixture has one tenant');
select is((select count(*)::integer from public.publisher_deliveries where state = 'migration_frozen'), 21, 'three frozen platform deliveries created for each reel');
select is((select count(*)::integer from public.publisher_deliveries where state = 'planning_only'), 14, 'article delivery records cannot publish');
select is(
  (select legacy_payload from public.publisher_content_items where legacy_spp_id = '00000000-0000-0000-0000-000000000001'),
  (select payload from sanitized_export where payload->>'id' = '00000000-0000-0000-0000-000000000001'),
  'complete legacy payload is preserved exactly as JSON'
);
select is(
  (public.import_legacy_spp_rows((select jsonb_agg(payload order by payload->>'id') from sanitized_export))->>'unchanged_content_items')::integer,
  67,
  'identical re-import is idempotent'
);

-- Recreate the legacy source-side queued set so the transfer RPC can prove an
-- exact database reconciliation before changing ownership.
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
from sanitized_export s
cross join lateral jsonb_populate_record(null::public.scheduled_posts, s.payload) r
;

select throws_ok(
  $$select public.import_legacy_spp_rows(jsonb_build_array((select payload || '{"caption":"changed"}'::jsonb from sanitized_export limit 1)))$$,
  '23505',
  'legacy row 00000000-0000-0000-0000-000000000001 differs from its previous import',
  'changed legacy payload is rejected'
);
select throws_ok(
  $$update public.publisher_content_items set legacy_spp_id = gen_random_uuid() where legacy_spp_id is not null$$,
  '23514',
  'legacy SPP identity, payload, and publish projection are immutable',
  'legacy ID is immutable'
);
select throws_ok(
  $$update public.publisher_content_items set caption = 'changed' where legacy_spp_id = '00000000-0000-0000-0000-000000000001'$$,
  '23514',
  'legacy SPP identity, payload, and publish projection are immutable',
  'legacy publish projection cannot drift from preserved payload'
);
select throws_ok(
  $$update public.publisher_deliveries set state = 'pending'
    where content_item_id = (select id from public.publisher_content_items where legacy_spp_id = '00000000-0000-0000-0000-000000000001')$$,
  '23514',
  'planning-only content cannot enter the publisher queue',
  'legacy LinkedIn article delivery cannot become claimable'
);
select throws_ok(
  $$update public.publisher_audit_log set actor = 'changed'$$,
  '55000',
  'publisher_audit_log is append-only',
  'audit history cannot be updated'
);
select throws_ok(
  $$delete from public.publisher_audit_log$$,
  '55000',
  'publisher_audit_log is append-only',
  'audit history cannot be deleted'
);
select throws_ok(
  $$insert into public.publisher_deliveries (content_item_id, platform, state, idempotency_key)
    select id, 'instagram', 'historical', 'legacy-spp:00000000-0000-0000-0000-000000000015:instagram'
    from public.publisher_content_items where legacy_spp_id = '00000000-0000-0000-0000-000000000001'$$,
  '23505',
  'duplicate key value violates unique constraint "publisher_deliveries_idempotency_key_key"',
  'duplicate platform idempotency key is rejected'
);

insert into public.scheduled_posts (
  id, user_id, company_id, item_id, content_type, caption, platforms, scheduled_at, status
) values
  ('10000000-0000-0000-0000-000000000001', 'fixture-user', 'fixture-company', 'old-reel', 'reel', 'sanitized', array['linkedin'], '2026-08-01', 'queued'),
  ('10000000-0000-0000-0000-000000000002', 'fixture-user', 'fixture-company', 'old-article', 'article', 'sanitized', array['linkedin'], '2026-08-01', 'queued');

select throws_ok(
  $$update public.scheduled_posts set status = 'publishing' where id = '10000000-0000-0000-0000-000000000001'$$,
  '42501',
  'legacy queued posts must be claimed through claim_legacy_spp_posts',
  'direct legacy queued-to-publishing transition is blocked'
);

select is(
  (select count(*)::integer from public.claim_legacy_spp_posts(1, 5, 300, '2026-08-02 00:00:00+00')),
  1,
  'legacy claim is epoch-gated and excludes articles'
);
select is((select status from public.scheduled_posts where id = '10000000-0000-0000-0000-000000000002'), 'queued', 'article remains unclaimed');
select ok(
  public.mark_legacy_spp_dispatch_started(
    '10000000-0000-0000-0000-000000000001',
    (select publisher_lease_token from public.scheduled_posts where id = '10000000-0000-0000-0000-000000000001'),
    1
  ),
  'legacy dispatch start uses lease token and ownership epoch CAS'
);
select throws_ok(
  $$select public.transfer_publisher_queue_ownership(1, '2026-09-03')$$,
  '55000',
  'ownership transfer requires zero live leases',
  'cutover refuses a live legacy lease'
);

select ok(
  public.complete_legacy_spp_claim(
    '10000000-0000-0000-0000-000000000001',
    (select publisher_lease_token from public.scheduled_posts where id = '10000000-0000-0000-0000-000000000001'),
    1, 'queued', '{}'::jsonb, 'sanitized retry', 1, null
  ),
  'legacy completion clears its lease through token and epoch CAS'
);

delete from public.scheduled_posts
where id in ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002');

select is(public.transfer_publisher_queue_ownership(1, '2026-09-03'), 2::bigint, 'atomic transfer increments epoch');
select is((select owner from public.publisher_queue_ownership where source = 'legacy_spp'), 'replacement', 'replacement owns queue after transfer');
select is((select epoch from public.publisher_queue_ownership where source = 'legacy_spp'), 2::bigint, 'ownership epoch is durable');
select is((select count(*)::integer from public.publisher_deliveries where state = 'pending'), 21, 'transfer activates only publishable frozen deliveries');
select is((select count(*)::integer from public.publisher_deliveries where state = 'planning_only'), 14, 'articles stay planning only after transfer');
select throws_ok(
  $$select public.claim_legacy_spp_posts(1, 5, 300, '2026-09-03')$$,
  '40001',
  'legacy ownership mismatch: owner replacement, epoch 2',
  'legacy scheduler cannot claim after transfer'
);
select throws_ok(
  $$select public.complete_legacy_spp_claim('10000000-0000-0000-0000-000000000001', gen_random_uuid(), 1, 'failed')$$,
  '40001',
  'legacy ownership mismatch: owner replacement, epoch 2',
  'late legacy completion cannot cross ownership handoff'
);

create temporary table first_claim as
select * from public.claim_publisher_deliveries(2, 1, 30, '2026-09-03 00:00:00+00');
select is((select count(*)::integer from first_claim), 1, 'replacement claims one delivery with shared epoch');
select is((select state from public.publisher_deliveries where id = (select delivery_id from first_claim)), 'leased', 'claimed delivery has a lease');
select is((select count(*)::integer from public.publisher_delivery_attempts where delivery_id = (select delivery_id from first_claim)), 1, 'claim creates a unique attempt record');
select is(
  (select new_state from public.reap_expired_publisher_leases('2026-09-03 00:01:00+00') where delivery_id = (select delivery_id from first_claim)),
  'retryable',
  'expired pre-dispatch lease retries safely'
);

create temporary table second_claim as
select * from public.claim_publisher_deliveries(2, 1, 30, '2026-09-03 00:02:00+00');
select ok(
  public.checkpoint_publisher_delivery(
    (select delivery_id from second_claim), (select lease_token from second_claim),
    '{"prepare_handle":"sanitized-handle","prepare_phase":"uploaded"}'::jsonb
  ),
  'live pre-dispatch lease checkpoints provider reconciliation handles'
);
select is(
  (select provider_reconciliation_metadata->>'prepare_handle' from public.publisher_deliveries where id = (select delivery_id from second_claim)),
  'sanitized-handle',
  'checkpoint merges structured provider reconciliation metadata'
);
select ok(
  exists(
    select 1 from public.publisher_audit_log
    where delivery_id = (select delivery_id from second_claim)
      and event_type = 'delivery_checkpointed'
      and details->'provider_reconciliation_metadata_after'->>'prepare_handle' = 'sanitized-handle'
  ),
  'checkpoint transition records before and after metadata in append-only audit'
);
select ok(
  not public.checkpoint_publisher_delivery(
    (select delivery_id from second_claim), gen_random_uuid(), '{"prepare_handle":"stale"}'::jsonb
  ),
  'stale lease token cannot overwrite provider reconciliation metadata'
);
select ok(
  public.mark_publisher_dispatch_started(
    (select delivery_id from second_claim), (select lease_token from second_claim), repeat('b', 64)
  ),
  'attempt records dispatch start before provider POST'
);
select is(
  (select state from public.publisher_delivery_attempts where delivery_id = (select delivery_id from second_claim) order by attempt_number desc limit 1),
  'dispatch_started',
  'attempt persists indeterminate dispatch phase'
);
select is(
  (select new_state from public.reap_expired_publisher_leases('2026-09-03 00:03:00+00') where delivery_id = (select delivery_id from second_claim)),
  'verification_required',
  'expired post-dispatch lease never auto-retries'
);

create temporary table retry_claim as
select * from public.claim_publisher_deliveries(2, 1, 30, '2026-09-03 00:04:00+00');
select is(
  public.retry_publisher_delivery(
    (select delivery_id from retry_claim), (select lease_token from retry_claim),
    'sanitized transient failure', '2026-09-03 00:05:00+00'
  ),
  'retryable',
  'explicit safe failure schedules a retry through CAS'
);

create temporary table dead_claim as
select * from public.claim_publisher_deliveries(2, 1, 30, '2026-09-03 00:04:00+00');
select ok(
  public.dead_letter_publisher_delivery(
    (select delivery_id from dead_claim), (select lease_token from dead_claim), 'sanitized permanent failure'
  ),
  'permanent failure dead-letters through CAS'
);

create temporary table verify_claim as
select * from public.claim_publisher_deliveries(2, 1, 30, '2026-09-03 00:04:00+00');
select ok(
  public.mark_publisher_dispatch_started(
    (select delivery_id from verify_claim), (select lease_token from verify_claim), repeat('c', 64)
  ),
  'verification test enters dispatch phase'
);
select ok(
  public.mark_publisher_verification_required(
    (select delivery_id from verify_claim), (select lease_token from verify_claim), 'sanitized indeterminate response'
  ),
  'indeterminate provider result requires reconciliation through CAS'
);

create temporary table success_claim as
select * from public.claim_publisher_deliveries(2, 1, 30, '2026-09-03 00:04:00+00');
select ok(
  public.mark_publisher_dispatch_started(
    (select delivery_id from success_claim), (select lease_token from success_claim), repeat('d', 64)
  ),
  'success test enters dispatch phase'
);
select throws_ok(
  format(
    'select public.complete_publisher_delivery(%L, %L, %L)',
    (select delivery_id from success_claim), (select lease_token from success_claim), ''
  ),
  '22023',
  'platform post ID is required for success',
  'success rejects an empty provider post ID'
);
select ok(
  public.complete_publisher_delivery(
    (select delivery_id from success_claim), (select lease_token from success_claim),
    'sanitized-provider-id', 'https://example.invalid/live', '{}'::jsonb
  ),
  'success finalizes through dispatch-phase lease CAS'
);
select is(
  (select state from public.publisher_deliveries where id = (select delivery_id from success_claim)),
  'succeeded',
  'successful delivery retains its terminal state'
);
select is(
  (select count(*)::integer from public.publisher_audit_log where event_type = 'ownership_transferred'),
  1,
  'ownership handoff is recorded in append-only audit history'
);

select * from finish();
rollback;
