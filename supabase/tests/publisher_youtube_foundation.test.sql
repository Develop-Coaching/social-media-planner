begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into public.companies(user_id,id,name)
values ('youtube-user','youtube-company','Synthetic YouTube Tenant');
update public.publisher_queue_ownership set owner='replacement',epoch=2,
  cutoff_at=statement_timestamp(),reconciliation_sha256=repeat('a',64),transferred_at=statement_timestamp()
where source='legacy_spp';

select lives_ok(
  $$select public.ingest_native_publisher_content(
    'youtube-user','youtube-company','greg_brain','reel-001','reel','A synthetic Short #Builders',
    '{"upload_paths":["youtube-user/youtube-company/reel.mp4"]}',
    '2099-09-28T01:00:00Z',array['youtube'],'ready',null)$$,
  'native ingestion accepts a tenant-owned YouTube reel'
);
select is((select count(*)::integer from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.source_id='reel-001' and d.platform='youtube'), 1, 'one YouTube delivery is created');
select throws_ok(
  $$select public.ingest_native_publisher_content(
    'youtube-user','youtube-company','greg_brain','text-youtube','post','No video','{}',
    '2099-09-28T01:00:00Z',array['youtube'],'ready',null)$$,
  '22023','YouTube is only valid for reel or video content','YouTube ready inventory fails closed for non-video content'
);

create temporary table youtube_claim as
select * from public.claim_publisher_deliveries(2,1,300,'2099-09-28T01:00:00Z');
select is((select platform from youtube_claim), 'youtube', 'claim exposes the YouTube platform');
select is((select provider_reconciliation_metadata from youtube_claim), '{}'::jsonb, 'new YouTube delivery starts without reconciliation metadata');
select ok(public.checkpoint_publisher_delivery(
  (select delivery_id from youtube_claim),(select lease_token from youtube_claim),
  '{"youtube_media_kind":"short","youtube_source_tag":"dcsrc_0123456789abcdef01234567"}'::jsonb
), 'strict YouTube reconciliation metadata is checkpointed');
select is((select provider_reconciliation_metadata->>'youtube_source_tag' from public.publisher_deliveries where id=(select delivery_id from youtube_claim)), 'dcsrc_0123456789abcdef01234567', 'source tag is durable');
select throws_ok(format(
  'select public.checkpoint_publisher_delivery(%L,%L,%L::jsonb)',
  (select delivery_id from youtube_claim),(select lease_token from youtube_claim),
  '{"youtube_media_kind":"short","youtube_source_tag":"raw-internal-id"}'
), '22023','provider reconciliation checkpoint is not safe for delivery platform youtube','raw internal IDs are rejected from the source tag');
select throws_ok(format(
  'select public.checkpoint_publisher_delivery(%L,%L,%L::jsonb)',
  (select delivery_id from youtube_claim),(select lease_token from youtube_claim),
  '{"youtube_media_kind":"short","instagram_creation_id":"cross-platform"}'
), '22023','provider reconciliation checkpoint is not safe for delivery platform youtube','cross-platform checkpoint keys are rejected');
select ok(public.mark_publisher_dispatch_started(
  (select delivery_id from youtube_claim),(select lease_token from youtube_claim),repeat('b',64)
), 'dispatch is marked before videos.insert');
select is((select new_state from public.reap_expired_publisher_leases('2099-09-28T01:06:00Z') where delivery_id=(select delivery_id from youtube_claim)), 'verification_required', 'expired YouTube dispatch is quarantined');
select is((select count(*)::integer from public.claim_publisher_deliveries(2,10,300,'2099-09-28T01:07:00Z')), 0, 'ambiguous YouTube upload is never automatically reclaimed');

select * from finish();
rollback;
