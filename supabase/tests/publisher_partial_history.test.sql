begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

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
      when i = 15 then jsonb_build_object('instagram','durable-partial-id','facebook','pending')
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

select is((select state from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.legacy_spp_id='20000000-0000-0000-0000-000000000015' and d.platform='instagram'), 'succeeded', 'queued platform with durable ID imports terminal-success');
select is((select state from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.legacy_spp_id='20000000-0000-0000-0000-000000000015' and d.platform='facebook'), 'verification_required', 'queued sentinel platform requires verification');
select is((select state from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.legacy_spp_id='20000000-0000-0000-0000-000000000015' and d.platform='linkedin'), 'migration_frozen', 'only unfinished queued platform is frozen');
select is((select state from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.legacy_spp_id='20000000-0000-0000-0000-000000000022' and d.platform='linkedin'), 'historical', 'published history without durable ID is nonclaimable historical');
select is((select state from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.legacy_spp_id='20000000-0000-0000-0000-000000000023' and d.platform='linkedin'), 'succeeded', 'published history with durable ID imports succeeded');

select * from finish();
rollback;
