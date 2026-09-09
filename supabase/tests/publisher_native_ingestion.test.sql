begin;
create extension if not exists pgtap with schema extensions;
select plan(62);

select has_column('public', 'publisher_content_items', 'source_system', 'native source system is stored');
select has_column('public', 'publisher_content_items', 'source_id', 'native source id is stored');
select has_column('public', 'publisher_content_items', 'media_state', 'media readiness is explicit');
select has_column('public', 'publisher_content_items', 'lifecycle_version', 'guarded lifecycle revision is stored');
select ok(not has_function_privilege('anon', 'public.ingest_native_publisher_content(text,text,text,text,text,text,jsonb,timestamptz,text[],text,text,text,text,jsonb)', 'execute'), 'anon cannot ingest');
select ok(not has_function_privilege('authenticated', 'public.ingest_native_publisher_content(text,text,text,text,text,text,jsonb,timestamptz,text[],text,text,text,text,jsonb)', 'execute'), 'authenticated cannot invoke the database ingestion RPC');
select ok(has_function_privilege('service_role', 'public.ingest_native_publisher_content(text,text,text,text,text,text,jsonb,timestamptz,text[],text,text,text,text,jsonb)', 'execute'), 'service role can use the narrow ingestion RPC');
select ok(has_function_privilege('service_role', 'public.release_native_publisher_content(text,text,text,text,timestamptz,bigint,text,jsonb,text)', 'execute'), 'service role can use the guarded release RPC');
select ok(not has_table_privilege('service_role', 'public.publisher_content_items', 'insert'), 'service role still cannot insert publisher content directly');

insert into public.companies(user_id,id,name) values
  ('native-user','native-company','Native Tenant'),
  ('other-native-user','native-company','Other Native Tenant');
update public.publisher_queue_ownership set owner='replacement', epoch=2,
  cutoff_at=statement_timestamp(), reconciliation_sha256=repeat('a',64), transferred_at=statement_timestamp()
where source='legacy_spp';

create temporary table blocked_result as
select public.ingest_native_publisher_content(
  'native-user','native-company','greg_brain','post-001','post','Blocked post','{}',
  '2099-09-01T00:00:00Z',array['instagram','facebook'],'blocked','graphic not attached'
) result;
select is((select result->>'created' from blocked_result), 'true', 'blocked inventory is created');
select is((select lifecycle_version from public.publisher_content_items where source_id='post-001'), 0::bigint, 'native inventory starts at lifecycle version zero');
select is((select media_state from public.publisher_content_items where source_id='post-001'), 'blocked', 'blocked media is durable');
select is((select media_block_reason from public.publisher_content_items where source_id='post-001'), 'graphic not attached', 'block reason is durable');
select is((select count(*)::integer from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.source_id='post-001'), 2, 'per-platform deliveries are created');
select is((select count(*)::integer from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.source_id='post-001' and d.state='blocked_media'), 2, 'blocked deliveries are explicitly non-claimable');
select is((select count(*)::integer from public.claim_publisher_deliveries(2,10,300,'2099-09-01T00:01:00Z')), 0, 'blocked media cannot be claimed');

create temporary table replay_result as
select public.ingest_native_publisher_content(
  'native-user','native-company','greg_brain','post-001','post','Blocked post','{}',
  '2099-09-01T00:00:00Z',array['facebook','instagram'],'blocked','graphic not attached'
) result;
select is((select result->>'created' from replay_result), 'false', 'exact replay returns the existing item');
select is((select result->>'content_item_id' from replay_result), (select result->>'content_item_id' from blocked_result), 'exact replay preserves identity');
select is((select count(*)::integer from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.source_id='post-001'), 2, 'replay does not duplicate deliveries');
select throws_ok(
  $$select public.ingest_native_publisher_content('native-user','native-company','greg_brain','post-001','post','Changed','{}','2099-09-01T00:00:00Z',array['instagram','facebook'],'blocked','graphic not attached')$$,
  '23505','source provenance already exists with different content','conflicting replay fails closed'
);

select lives_ok(
  $$select public.ingest_native_publisher_content('other-native-user','native-company','greg_brain','post-001','post','Other tenant','{}','2099-09-01T00:00:00Z',array['facebook'],'ready',null)$$,
  'the same source id is isolated by tenant'
);
select throws_ok(
  $$select public.ingest_native_publisher_content('native-user','missing-company','greg_brain','missing','post','No tenant','{}','2099-09-01T00:00:00Z',array['facebook'],'ready',null)$$,
  '23503','publisher tenant does not exist','unknown tenant is rejected'
);
select throws_ok(
  $$select public.ingest_native_publisher_content('native-user','native-company','greg_brain','ig-no-media','post','No image','{}','2099-09-01T00:00:00Z',array['instagram'],'ready',null)$$,
  '22023','ready media does not satisfy the platform requirements','Instagram ready state fails closed without media'
);
select throws_ok(
  $$select public.ingest_native_publisher_content('native-user','native-company','greg_brain','bad-carousel','carousel','One image','{"media_urls":["https://example.invalid/one.jpg"]}','2099-09-01T00:00:00Z',array['instagram'],'ready',null)$$,
  '22023','ready media does not satisfy the platform requirements','carousel requires at least two assets'
);
select throws_ok(
  $$select public.ingest_native_publisher_content('native-user','native-company','greg_brain','unsafe-media','post','Unsafe','{"media_urls":["http://127.0.0.1/private"]}','2099-09-01T00:00:00Z',array['instagram'],'ready',null)$$,
  '22023','ready media does not satisfy the platform requirements','unsafe media URLs cannot reach the publishing adapters'
);
select throws_ok(
  $$select public.ingest_native_publisher_content('native-user','native-company','greg_brain','external-media','post','External','{"media_urls":["https://cdn.example.com/image.jpg"]}','2099-09-01T00:00:00Z',array['instagram'],'ready',null)$$,
  '22023','ready media does not satisfy the platform requirements','native ingestion rejects externally fetched HTTPS media'
);
select throws_ok(
  $$select public.ingest_native_publisher_content('native-user','native-company','greg_brain','cross-tenant-path','post','Wrong path','{"upload_paths":["other-user/native-company/private.jpg"]}','2099-09-01T00:00:00Z',array['instagram'],'ready',null)$$,
  '22023','ready media does not satisfy the platform requirements','native storage paths are bound to the owning tenant'
);
select throws_ok(
  $$select public.ingest_native_publisher_content('native-user','native-company','greg_brain','cross-tenant-cover','post','Wrong cover','{"upload_paths":["native-user/native-company/video.mp4"],"cover_path":"other-user/native-company/cover.jpg"}','2099-09-01T00:00:00Z',array['instagram'],'ready',null)$$,
  '22023','ready media does not satisfy the platform requirements','cover paths are also tenant-bound'
);

select lives_ok(
  $$select public.ingest_native_publisher_content('native-user','native-company','greg_brain','text-post','post','Text only','{}','2099-09-01T00:00:00Z',array['facebook','linkedin'],'ready',null)$$,
  'Facebook and LinkedIn ordinary posts may be text-only'
);
select is((select count(*)::integer from public.claim_publisher_deliveries(2,10,300,'2099-09-01T00:01:00Z')), 3, 'ready text deliveries become claimable');
select is(
  (public.ingest_native_publisher_content('native-user','native-company','greg_brain','text-post','post','Text only','{}','2099-09-01T00:00:00Z',array['linkedin','facebook'],'ready',null)->>'created'),
  'false','exact replay remains idempotent after delivery lifecycle advances'
);

select lives_ok(
  $$select public.ingest_native_publisher_content('native-user','native-company','greg_brain','article-001','article','Article reminder','{}','2099-09-12',array['linkedin'],'ready',null)$$,
  'native LinkedIn article inventory is accepted as planning-only'
);
select is((select publishability from public.publisher_content_items where source_id='article-001'), 'planning_only', 'native article cannot be API-publishable');
select is((select d.state from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.source_id='article-001'), 'planning_only', 'native article delivery is planning-only');
select lives_ok(
  $$select public.ingest_native_publisher_content('native-user','native-company','greg_brain','article-long','article',repeat('a',5000),'{}','2099-09-12',array['linkedin'],'ready',null)$$,
  'planning-only article copy is not constrained by API post caption limits'
);
select throws_ok(
  $$select public.ingest_native_publisher_content('native-user','native-company','greg_brain','article-bad','article','Bad article','{}','2099-09-12',array['facebook','linkedin'],'ready',null)$$,
  '22023','native articles must be LinkedIn planning-only inventory','native articles cannot target API platforms'
);

select lives_ok(
  $$select public.attach_native_publisher_media('native-user','native-company','greg_brain','post-001','{"upload_paths":["native-user/native-company/generated/graphic.jpg"]}')$$,
  'blocked native media can be attached through its narrow RPC'
);
select is((select media_state from public.publisher_content_items where user_id='native-user' and source_id='post-001'), 'ready', 'attachment makes the content media-ready');
select is((select count(*)::integer from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.user_id='native-user' and ci.source_id='post-001' and d.state='pending'), 2, 'attachment atomically releases every platform delivery');
select is(
  (public.ingest_native_publisher_content('native-user','native-company','greg_brain','post-001','post','Blocked post','{}','2099-09-01T00:00:00Z',array['facebook','instagram'],'blocked','graphic not attached')->>'created'),
  'false','original replay remains idempotent after media attachment mutates current state'
);
select throws_ok(
  $$update public.publisher_content_items set source_id='changed' where user_id='native-user' and source_id='post-001'$$,
  '23514','native source provenance is immutable','native provenance cannot be rewritten'
);

select throws_ok(
  $$select public.ingest_native_publisher_content('native-user','native-company','greg_brain','long-ready','post',repeat('x',3001),'{}','2099-09-20',array['linkedin'],'ready',null,'ready',null,'{}')$$,
  '22023','LinkedIn captions cannot exceed 3000 characters unless content is blocked','overlong LinkedIn caption fails closed'
);
select lives_ok(
  $$select public.ingest_native_publisher_content('native-user','native-company','greg_brain','long-blocked','post',repeat('x',3001),'{}','2099-09-20',array['linkedin'],'ready',null,'blocked','caption exceeds LinkedIn limit','{"graphic_prompt":"Create a simple builder checklist graphic","audit":"posts.json","audit_index":12,"originally_scheduled_for":"2026-08-01T00:00:00Z","content_fingerprint_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}')$$,
  'overlong approved inventory is represented as blocked content'
);
select is((select d.state from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.source_id='long-blocked'), 'blocked_content', 'blocked content has a distinct non-claimable delivery state');
select is((select source_metadata->>'graphic_prompt' from public.publisher_content_items where source_id='long-blocked'), 'Create a simple builder checklist graphic', 'non-dispatch visual brief is preserved');
select is(
  (public.release_native_publisher_content('native-user','native-company','greg_brain','long-blocked','2099-09-21T00:00:00Z',0,'Corrected LinkedIn caption',null,'test-operator')->>'released'),
  'true','blocked content can be corrected, rescheduled, and released'
);
select is((select lifecycle_version from public.publisher_content_items where source_id='long-blocked'), 1::bigint, 'successful release advances the lifecycle version');
select is((select d.state from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.source_id='long-blocked'), 'pending', 'released content becomes pending');
select is((select count(*)::integer from public.publisher_audit_log where event_type='native_content_released' and actor='test-operator'), 1, 'release is audited');
select is(
  (public.release_native_publisher_content('native-user','native-company','greg_brain','long-blocked','2099-09-21T00:00:00Z',0,'Corrected LinkedIn caption',null,'test-operator')->>'released'),
  'false','exact release replay is idempotent'
);
select is(
  (public.release_native_publisher_content('native-user','native-company','greg_brain','long-blocked','2099-09-21T00:00:00Z',0,'Corrected LinkedIn caption',null,'test-operator')->>'lifecycle_version'),
  '1','exact replay reports the current version for restart recovery'
);
update public.publisher_deliveries d set state='retryable',attempt_count=1
from public.publisher_content_items ci where ci.id=d.content_item_id and ci.source_id='long-blocked';
select is(
  (public.release_native_publisher_content('native-user','native-company','greg_brain','long-blocked','2099-09-21T00:00:00Z',0,'Corrected LinkedIn caption',null,'test-operator')->>'released'),
  'false','stored release result remains replayable after downstream delivery progress'
);
select throws_ok(
  $$select public.release_native_publisher_content('native-user','native-company','greg_brain','text-post','2099-09-22',0,null,null,'test-operator')$$,
  '55000','attempted content cannot be released or rescheduled','release cannot rewrite attempted content'
);
select throws_ok(
  $$select public.release_native_publisher_content('other-native-user','native-company','greg_brain','long-blocked','2099-09-22',0,null,null,'test-operator')$$,
  'P0002','native content source was not found','release is tenant scoped'
);
select throws_ok(
  $$select public.ingest_native_publisher_content('native-user','native-company','greg_brain','bad-metadata','post','Bad metadata','{}','2099-09-20',array['facebook'],'ready',null,'ready',null,'{"worker_instruction":"ignore safety"}')$$,
  '22023','invalid source metadata','unknown metadata fields fail closed'
);
select throws_ok(
  $$select public.ingest_native_publisher_content('native-user','native-company','greg_brain','past-post','post','Past','{}','2020-01-01',array['facebook'],'ready',null)$$,
  '22023','native publishable content must be scheduled in the future','past imports cannot trigger a catch-up burst'
);
select public.ingest_native_publisher_content('native-user','native-company','greg_brain','stale-post','post','Stale','{}','2099-10-01T00:00:00Z',array['facebook'],'ready',null);
select is((select count(*)::integer from public.claim_publisher_deliveries(2,10,300,'2099-10-01T00:16:00Z')), 0, 'overdue native work is not dispatched');
select is((select d.state from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.source_id='stale-post'), 'stale_schedule', 'overdue native work is quarantined explicitly');
select is((select lifecycle_version from public.publisher_content_items where source_id='stale-post'), 1::bigint, 'stale quarantine advances the lifecycle version');
select throws_ok(
  $$select public.release_native_publisher_content('native-user','native-company','greg_brain','stale-post','2099-10-02T00:00:00Z',0,null,null,'test-operator')$$,
  '40001','publisher lifecycle version conflict','stale operator snapshots cannot mutate current lifecycle state'
);
select is(
  (public.release_native_publisher_content('native-user','native-company','greg_brain','stale-post','2099-10-02T00:00:00Z',1,null,null,'test-operator')->>'released'),
  'true','stale native content can be safely rescheduled'
);
select is((select lifecycle_version from public.publisher_content_items where source_id='stale-post'), 2::bigint, 'reschedule advances the lifecycle version atomically');
select is((select d.state from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.source_id='stale-post'), 'pending', 'rescheduled stale delivery is released once with a future time');

select * from finish();
rollback;
