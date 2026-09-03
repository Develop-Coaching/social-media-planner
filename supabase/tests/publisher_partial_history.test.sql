begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into public.companies (user_id, id, name)
values ('partial-user', 'partial-company', 'Sanitized Partial Fixture');

with fixture as (
  select jsonb_build_object(
    'id', '20000000-0000-0000-0000-' || lpad(i::text, 12, '0'),
    'user_id', 'partial-user', 'company_id', 'partial-company',
    'item_id', 'partial-' || i,
    'content_type', case when i <= 14 then 'article' when i <= 21 then 'reel' else 'post' end,
    'caption', 'Sanitized partial caption ' || i,
    'platforms', case when i <= 14 or i > 21 then jsonb_build_array('linkedin') else jsonb_build_array('instagram','facebook','linkedin') end,
    'platform_post_ids', case
      when i = 15 then jsonb_build_object(
        'facebook','durable-partial-id',
        'instagram_container','ig-container-sanitized',
        'instagram_container_since','2026-09-03T01:02:03.000Z'
      )
      when i = 16 then jsonb_build_object(
        'instagram_container_since','2026-09-03T02:03:04.000Z'
      )
      when i between 23 and 50 then jsonb_build_object('linkedin','durable-history-' || i)
      else '{}'::jsonb end,
    'scheduled_at', to_jsonb('2026-09-01 00:00:00+00'::timestamptz + i * interval '1 hour'),
    'status', case when i <= 21 then 'queued' when i <= 50 then 'published' else 'cancelled' end,
    'retry_count', 0, 'created_at', to_jsonb('2026-08-01'::timestamptz),
    'updated_at', to_jsonb('2026-08-02'::timestamptz),
    'published_at', case when i between 22 and 50 then to_jsonb('2026-08-02'::timestamptz) else 'null'::jsonb end
  ) payload from generate_series(1,67) generated(i)
)
select public.import_legacy_spp_rows(jsonb_agg(payload order by payload->>'id')) from fixture;

select is((select state from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.legacy_spp_id='20000000-0000-0000-0000-000000000015' and d.platform='facebook'), 'succeeded', 'queued platform with durable ID imports terminal-success');
select is((select state from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.legacy_spp_id='20000000-0000-0000-0000-000000000015' and d.platform='instagram'), 'verification_required', 'Instagram auxiliary container requires verification');
select is((select provider_reconciliation_metadata from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.legacy_spp_id='20000000-0000-0000-0000-000000000015' and d.platform='instagram'), '{"instagram_container":"ig-container-sanitized","instagram_container_since":"2026-09-03T01:02:03.000Z"}'::jsonb, 'Instagram container ID and start time are preserved for provider reconciliation');
select is((select state from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.legacy_spp_id='20000000-0000-0000-0000-000000000015' and d.platform='linkedin'), 'migration_frozen', 'only unfinished queued platform is frozen');
select is((select state from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.legacy_spp_id='20000000-0000-0000-0000-000000000022' and d.platform='linkedin'), 'historical', 'published history without durable ID is nonclaimable historical');
select is((select state from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.legacy_spp_id='20000000-0000-0000-0000-000000000023' and d.platform='linkedin'), 'succeeded', 'published history with durable ID imports succeeded');
select is((select state from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.legacy_spp_id='20000000-0000-0000-0000-000000000016' and d.platform='instagram'), 'verification_required', 'Instagram container-since alone requires verification');
select throws_ok(
  $$select public.transfer_publisher_queue_ownership(1, '2026-09-03')$$,
  '55000',
  'ownership transfer requires zero live leases',
  'Instagram container verification blocks ownership transfer and activation'
);

create temporary table initial_attestation as
select reconciliation_sha256 from public.publisher_queue_ownership where source = 'legacy_spp';

select throws_ok(
  format(
    'select public.resolve_legacy_delivery_verification(%L, %L, null, null, %L, %L::jsonb)',
    (select d.id from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.legacy_spp_id='20000000-0000-0000-0000-000000000015' and d.platform='instagram'),
    'confirmed_absent', 'sanitized-reviewer', '{}'
  ),
  '22023',
  'verification resolution requires an outcome, actor, and provider evidence',
  'resolution refuses empty provider evidence'
);
select ok(
  public.resolve_legacy_delivery_verification(
    (select d.id from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.legacy_spp_id='20000000-0000-0000-0000-000000000015' and d.platform='instagram'),
    'confirmed_absent', null, null, 'sanitized-reviewer',
    '{"verification_method":"api_lookup","verification_result":"not_found","checked_at":"2026-09-03T04:05:06Z"}'::jsonb
  ),
  'provider-confirmed absence resolves to a frozen, safe-to-activate delivery'
);
select is((select state from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.legacy_spp_id='20000000-0000-0000-0000-000000000015' and d.platform='instagram'), 'migration_frozen', 'confirmed absence returns ambiguous delivery to migration freeze');
select ok(
  (select actor = 'sanitized-reviewer'
    and details->>'resolution' = 'confirmed_absent'
    and details->'before'->>'state' = 'verification_required'
    and details->'after'->>'state' = 'migration_frozen'
    and details->'provider_evidence'->>'verification_result' = 'not_found'
   from public.publisher_audit_log
   where event_type = 'legacy_verification_resolved'
     and delivery_id = (select d.id from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.legacy_spp_id='20000000-0000-0000-0000-000000000015' and d.platform='instagram')
   order by id desc limit 1),
  'confirmed-absence audit immutably records actor, before, after, and provider evidence'
);
select isnt(
  (select reconciliation_sha256 from public.publisher_queue_ownership where source = 'legacy_spp'),
  (select reconciliation_sha256 from initial_attestation),
  'resolution refreshes the database-derived reconciliation attestation atomically'
);
select ok(
  public.resolve_legacy_delivery_verification(
    (select d.id from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.legacy_spp_id='20000000-0000-0000-0000-000000000016' and d.platform='instagram'),
    'confirmed_published', 'ig-durable-resolved-id', '2026-09-03T05:06:07Z',
    'sanitized-reviewer', '{"verification_method":"manual_provider_check","verification_result":"published","checked_at":"2026-09-03T05:06:07Z","provider_reference":"ig-durable-resolved-id"}'::jsonb
  ),
  'provider-confirmed publication resolves with a durable ID'
);
select is((select state from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.legacy_spp_id='20000000-0000-0000-0000-000000000016' and d.platform='instagram'), 'succeeded', 'confirmed publication is terminal success');
select is((select platform_post_id from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.legacy_spp_id='20000000-0000-0000-0000-000000000016' and d.platform='instagram'), 'ig-durable-resolved-id', 'confirmed publication stores durable provider ID');
select ok(
  (select details->'provider_evidence'->>'verification_result' = 'published'
    and details->'after'->>'state' = 'succeeded'
    and details->>'provider_post_id' = 'ig-durable-resolved-id'
   from public.publisher_audit_log
   where event_type = 'legacy_verification_resolved'
     and delivery_id = (select d.id from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.legacy_spp_id='20000000-0000-0000-0000-000000000016' and d.platform='instagram')
   order by id desc limit 1),
  'confirmed-publication audit records evidence and durable provider result'
);
select is(public.transfer_publisher_queue_ownership(1, '2026-09-03'), 2::bigint, 'transfer accepts only the fully audited resolutions');
select is((select state from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.legacy_spp_id='20000000-0000-0000-0000-000000000015' and d.platform='instagram'), 'pending', 'confirmed absence becomes claimable only after atomic transfer');
select is((select state from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.legacy_spp_id='20000000-0000-0000-0000-000000000016' and d.platform='instagram'), 'succeeded', 'confirmed publication stays terminal through transfer');

select * from finish();
rollback;
