begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

select ok(not has_function_privilege('anon','public.preview_youtube_backfill(text,text,uuid[],timestamptz,integer,text,integer)','execute'),'anonymous callers cannot preview backfills');
select ok(not has_function_privilege('authenticated','public.apply_youtube_backfill(uuid,text,text,text,text)','execute'),'authenticated callers cannot apply backfills');
select ok(has_function_privilege('service_role','public.preview_youtube_backfill(text,text,uuid[],timestamptz,integer,text,integer)','execute'),'service role can use the preview RPC');
select ok(not has_table_privilege('service_role','public.publisher_youtube_backfill_approvals','insert'),'service role cannot bypass the approval RPC');

insert into public.companies(user_id,id,name) values
  ('backfill-user','backfill-company','Synthetic Backfill Tenant'),
  ('other-backfill-user','backfill-company','Other Synthetic Tenant');

insert into public.publisher_content_items(
  id,user_id,company_id,legacy_spp_id,content_type,caption,media,scheduled_at,
  approval_state,publishability,migration_state,legacy_status,legacy_payload,legacy_payload_sha256
) values
  ('10000000-0000-4000-8000-000000000001','backfill-user','backfill-company','20000000-0000-4000-8000-000000000001','reel','Eligible one','{"video_url":"https://synthetic.invalid/one.mp4"}','2026-09-03','approved','publishable','historical','published',
    '{"id":"20000000-0000-4000-8000-000000000001","user_id":"backfill-user","company_id":"backfill-company","content_type":"reel","caption":"Eligible one","scheduled_at":"2026-09-03T00:00:00Z","status":"published"}',repeat('1',64)),
  ('10000000-0000-4000-8000-000000000002','backfill-user','backfill-company',null,'reel','Eligible native reel','{"upload_paths":["backfill-user/backfill-company/two.mp4"]}','2026-09-05','approved','publishable','native',null,null,null),
  ('10000000-0000-4000-8000-000000000003','backfill-user','backfill-company','20000000-0000-4000-8000-000000000003','reel','Stale preview','{"video_url":"https://synthetic.invalid/three.mp4"}','2026-09-07','approved','publishable','historical','published',
    '{"id":"20000000-0000-4000-8000-000000000003","user_id":"backfill-user","company_id":"backfill-company","content_type":"reel","caption":"Stale preview","scheduled_at":"2026-09-07T00:00:00Z","status":"published"}',repeat('3',64)),
  ('10000000-0000-4000-8000-000000000004','other-backfill-user','backfill-company','20000000-0000-4000-8000-000000000004','reel','Other tenant','{"video_url":"https://synthetic.invalid/four.mp4"}','2026-09-09','approved','publishable','historical','published',
    '{"id":"20000000-0000-4000-8000-000000000004","user_id":"other-backfill-user","company_id":"backfill-company","content_type":"reel","caption":"Other tenant","scheduled_at":"2026-09-09T00:00:00Z","status":"published"}',repeat('4',64)),
  ('10000000-0000-4000-8000-000000000005','backfill-user','backfill-company','20000000-0000-4000-8000-000000000005','post','Image post','{"upload_paths":["backfill-user/backfill-company/image.jpg"]}','2026-09-11','approved','publishable','historical','published',
    '{"id":"20000000-0000-4000-8000-000000000005","user_id":"backfill-user","company_id":"backfill-company","content_type":"post","caption":"Image post","scheduled_at":"2026-09-11T00:00:00Z","status":"published"}',repeat('5',64)),
  ('10000000-0000-4000-8000-000000000006','backfill-user','backfill-company','20000000-0000-4000-8000-000000000006','article','Article','{}','2026-09-13','approved','planning_only','historical','published',
    '{"id":"20000000-0000-4000-8000-000000000006","user_id":"backfill-user","company_id":"backfill-company","content_type":"article","caption":"Article","scheduled_at":"2026-09-13T00:00:00Z","status":"published"}',repeat('6',64)),
  ('10000000-0000-4000-8000-000000000007','backfill-user','backfill-company','20000000-0000-4000-8000-000000000007','reel','No video','{}','2026-09-15','approved','publishable','historical','published',
    '{"id":"20000000-0000-4000-8000-000000000007","user_id":"backfill-user","company_id":"backfill-company","content_type":"reel","caption":"No video","scheduled_at":"2026-09-15T00:00:00Z","status":"published"}',repeat('7',64)),
  ('10000000-0000-4000-8000-000000000008','backfill-user','backfill-company','20000000-0000-4000-8000-000000000008','reel','Cancelled','{"video_url":"https://synthetic.invalid/eight.mp4"}','2026-09-17','approved','publishable','historical','published',
    '{"id":"20000000-0000-4000-8000-000000000008","user_id":"backfill-user","company_id":"backfill-company","content_type":"reel","caption":"Cancelled","scheduled_at":"2026-09-17T00:00:00Z","status":"published"}',repeat('8',64)),
  ('10000000-0000-4000-8000-000000000009','backfill-user','backfill-company','20000000-0000-4000-8000-000000000009','reel','Blocked','{"video_url":"https://synthetic.invalid/nine.mp4"}','2026-09-19','approved','publishable','historical','published',
    '{"id":"20000000-0000-4000-8000-000000000009","user_id":"backfill-user","company_id":"backfill-company","content_type":"reel","caption":"Blocked","scheduled_at":"2026-09-19T00:00:00Z","status":"published"}',repeat('9',64)),
  ('10000000-0000-4000-8000-000000000010','backfill-user','backfill-company','20000000-0000-4000-8000-000000000010','reel','Disjoint approval','{"video_url":"https://synthetic.invalid/ten.mp4"}','2026-09-21','approved','publishable','historical','published',
    '{"id":"20000000-0000-4000-8000-000000000010","user_id":"backfill-user","company_id":"backfill-company","content_type":"reel","caption":"Disjoint approval","scheduled_at":"2026-09-21T00:00:00Z","status":"published"}',repeat('a',64)),
  ('10000000-0000-4000-8000-000000000011','backfill-user','backfill-company','20000000-0000-4000-8000-000000000011','reel','Stale approval','{"video_url":"https://synthetic.invalid/eleven.mp4"}','2026-09-23','approved','publishable','historical','published',
    '{"id":"20000000-0000-4000-8000-000000000011","user_id":"backfill-user","company_id":"backfill-company","content_type":"reel","caption":"Stale approval","scheduled_at":"2026-09-23T00:00:00Z","status":"published"}',repeat('b',64));

insert into public.publisher_deliveries(content_item_id,platform,state,idempotency_key,platform_post_id,published_at)
select id,'instagram',case when id='10000000-0000-4000-8000-000000000008' then 'cancelled' else 'succeeded' end,
  'fixture:'||id::text||':instagram',
  case when id='10000000-0000-4000-8000-000000000008' then null else 'ig-'||id::text end,
  case when id='10000000-0000-4000-8000-000000000008' then null else '2026-09-20'::timestamptz end
from public.publisher_content_items where user_id in ('backfill-user','other-backfill-user') and content_type <> 'article';
insert into public.publisher_deliveries(content_item_id,platform,state,idempotency_key,platform_post_id,published_at)
values ('10000000-0000-4000-8000-000000000008','facebook','succeeded','fixture:mixed-cancelled:facebook','fb-mixed-cancelled','2026-09-20');
insert into public.publisher_deliveries(content_item_id,platform,state,idempotency_key)
values ('10000000-0000-4000-8000-000000000009','facebook','blocked_content','fixture:mixed-blocked:facebook');

select lives_ok(
  $$select publisher_private.ingest_native_publisher_content('backfill-user','backfill-company','greg_brain','pre-default-reel','reel','Old native reel','{"upload_paths":["backfill-user/backfill-company/old.mp4"]}','2099-09-30',array['instagram'],'ready',null,'ready',null,'{}')$$,
  'fixture represents a native reel ingested before YouTube defaulting'
);
select is(
  (public.ingest_native_publisher_content('backfill-user','backfill-company','greg_brain','pre-default-reel','reel','Old native reel','{"upload_paths":["backfill-user/backfill-company/old.mp4"]}','2099-09-30',array['instagram'],'ready',null)->>'created'),
  'false','an exact pre-default reel replay remains idempotent'
);
select is((select count(*)::integer from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.source_id='pre-default-reel' and d.platform='youtube'),0,'compatibility replay does not mutate the immutable old envelope or delivery set');

select lives_ok(
  $$select public.ingest_native_publisher_content('backfill-user','backfill-company','greg_brain','future-reel','reel','Future reel','{"upload_paths":["backfill-user/backfill-company/future.mp4"]}','2099-10-01',array['instagram'],'ready',null)$$,
  'new reels may omit YouTube explicitly'
);
select is((select count(*)::integer from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.source_id='future-reel'),2,'new reels default to the requested platform plus YouTube');
select is((select count(*)::integer from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.source_id='future-reel' and d.platform='youtube'),1,'future reel default creates exactly one YouTube delivery');
select is(
  (public.ingest_native_publisher_content('backfill-user','backfill-company','greg_brain','future-reel','reel','Future reel','{"upload_paths":["backfill-user/backfill-company/future.mp4"]}','2099-10-01',array['instagram'],'ready',null)->>'created'),
  'false','a post-default reel replay excludes its own planned YouTube slot and remains idempotent'
);
select lives_ok(
  $$select public.ingest_native_publisher_content('backfill-user','backfill-company','greg_brain','blocked-overlap','reel','Blocked overlap','{}','2099-10-01',array['instagram'],'blocked','video pending')$$,
  'blocked reel inventory may be recorded before it owns a quota slot'
);
select throws_ok(
  $$select public.attach_native_publisher_media('backfill-user','backfill-company','greg_brain','blocked-overlap','{"upload_paths":["backfill-user/backfill-company/blocked-overlap.mp4"]}')$$,
  '55000','YouTube quota schedule overlaps an existing nonterminal delivery','media attachment cannot release a YouTube delivery into an occupied planned slot'
);
select lives_ok(
  $$select public.ingest_native_publisher_content('backfill-user','backfill-company','greg_brain','content-blocked-overlap','reel','Content blocked overlap','{"upload_paths":["backfill-user/backfill-company/content-blocked.mp4"]}','2099-10-01',array['instagram'],'ready',null,'blocked','approval pending')$$,
  'content-blocked reel inventory may be recorded before it owns a quota slot'
);
select throws_ok(
  $$select public.release_native_publisher_content('backfill-user','backfill-company','greg_brain','content-blocked-overlap','2099-10-01',0,'Released content',null,'synthetic-operator')$$,
  '55000','YouTube quota schedule overlaps an existing nonterminal delivery','native release cannot enter an occupied YouTube planned slot'
);
select lives_ok(
  $$select public.ingest_native_publisher_content('backfill-user','backfill-company','greg_brain','second-future-reel','reel','Second future reel','{"upload_paths":["backfill-user/backfill-company/future-two.mp4"]}','2099-10-03',array['instagram'],'ready',null)$$,
  'a second ordinary YouTube reel may use a non-overlapping slot'
);
select throws_ok(
  $$update public.publisher_deliveries d set next_attempt_at='2099-10-03' from public.publisher_content_items ci where ci.id=d.content_item_id and ci.source_id='future-reel' and d.platform='youtube'$$,
  '55000','YouTube quota schedule overlaps an existing nonterminal delivery','reschedule-style pending mutation cannot move into an occupied slot'
);
update public.publisher_deliveries d set state='cancelled',next_attempt_at=null
from public.publisher_content_items ci where ci.id=d.content_item_id and ci.source_id='blocked-overlap' and d.platform='youtube';
select throws_ok(
  $$update public.publisher_deliveries d set state='pending',next_attempt_at='2099-10-01' from public.publisher_content_items ci where ci.id=d.content_item_id and ci.source_id='blocked-overlap' and d.platform='youtube'$$,
  '55000','YouTube quota schedule overlaps an existing nonterminal delivery','restore-style cancelled-to-pending mutation cannot enter an occupied slot'
);
select throws_ok(
  $$select public.ingest_native_publisher_content('backfill-user','backfill-company','greg_brain','bad-youtube','post','Text','{}','2099-10-01',array['youtube'],'ready',null)$$,
  '22023','YouTube is only valid for reel or video content','non-video content cannot request YouTube'
);

create temporary table exact_preview as select public.preview_youtube_backfill(
  'backfill-user','backfill-company',array['10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001']::uuid[],
  '2099-11-01',1440,'synthetic-reviewer',30
) result;
select is(jsonb_array_length((select result->'candidates' from exact_preview)),2,'preview contains the exact requested set');
select is((select result->'candidates'->0->>'content_item_id' from exact_preview),'10000000-0000-4000-8000-000000000002','preview preserves reviewed ordering for release pacing and accepts native items');
select is((select state from public.publisher_youtube_backfill_approvals where id=((select result->>'approval_id' from exact_preview)::uuid)),'previewed','preview creates a short-lived approval');
select is((select count(*)::integer from public.publisher_audit_log where event_type='youtube_backfill_previewed' and actor='synthetic-reviewer'),1,'preview is audited');

select throws_ok(
  $$select public.preview_youtube_backfill('backfill-user','backfill-company',array['10000000-0000-4000-8000-000000000004']::uuid[],'2099-11-01',1440,'synthetic-reviewer',30)$$,
  'P0002','exact backfill list is not owned by the requested tenant','cross-tenant IDs are rejected'
);
select throws_ok(
  $$select public.preview_youtube_backfill('backfill-user','backfill-company',array['10000000-0000-4000-8000-000000000005']::uuid[],'2099-11-01',1440,'synthetic-reviewer',30)$$,
  '55000','exact backfill list contains an ineligible, cancelled, blocked, non-reel, non-video, or duplicate item','image posts are rejected'
);
select throws_ok(
  $$select public.preview_youtube_backfill('backfill-user','backfill-company',array['10000000-0000-4000-8000-000000000006']::uuid[],'2099-11-01',1440,'synthetic-reviewer',30)$$,
  '55000','exact backfill list contains an ineligible, cancelled, blocked, non-reel, non-video, or duplicate item','articles are rejected'
);
select throws_ok(
  $$select public.preview_youtube_backfill('backfill-user','backfill-company',array['10000000-0000-4000-8000-000000000007']::uuid[],'2099-11-01',1440,'synthetic-reviewer',30)$$,
  '55000','exact backfill list contains an ineligible, cancelled, blocked, non-reel, non-video, or duplicate item','reels without video are rejected'
);
select throws_ok(
  $$select public.preview_youtube_backfill('backfill-user','backfill-company',array['10000000-0000-4000-8000-000000000008']::uuid[],'2099-11-01',1440,'synthetic-reviewer',30)$$,
  '55000','exact backfill list contains an ineligible, cancelled, blocked, non-reel, non-video, or duplicate item','cancelled items are rejected'
);
select throws_ok(
  $$select public.preview_youtube_backfill('backfill-user','backfill-company',array['10000000-0000-4000-8000-000000000009']::uuid[],'2099-11-01',1440,'synthetic-reviewer',30)$$,
  '55000','exact backfill list contains an ineligible, cancelled, blocked, non-reel, non-video, or duplicate item','mixed succeeded and blocked delivery items are rejected'
);

select throws_ok(format(
  'select public.apply_youtube_backfill(%L,%L,%L,%L,%L)',(select result->>'approval_id' from exact_preview),
  (select result->>'manifest_sha256' from exact_preview),'other-backfill-user','backfill-company','synthetic-applier'
), 'P0002','backfill approval not found','apply re-binds approval to the exact tenant');
create temporary table applied as select public.apply_youtube_backfill(
  ((select result->>'approval_id' from exact_preview)::uuid),(select result->>'manifest_sha256' from exact_preview),
  'backfill-user','backfill-company','synthetic-applier'
) result;
select is(jsonb_array_length((select result->'deliveries' from applied)),2,'apply queues every and only approved item');
select is((select count(*)::integer from public.publisher_deliveries where platform='youtube' and idempotency_key like 'youtube-backfill:%'),2,'apply creates exactly two YouTube deliveries');
select is((select max(next_attempt_at)-min(next_attempt_at) from public.publisher_deliveries where platform='youtube' and idempotency_key like 'youtube-backfill:%'),interval '1 day','release is quota-paced one Short per day');
select is((select count(*)::integer from public.publisher_deliveries where state='succeeded' and platform='instagram' and content_item_id in ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002')),2,'existing succeeded deliveries remain unchanged');
select is((select legacy_payload_sha256 from public.publisher_content_items where id='10000000-0000-4000-8000-000000000001'),repeat('1',64),'immutable legacy payload hash remains unchanged');
select is((select migration_state from public.publisher_content_items where id='10000000-0000-4000-8000-000000000001'),'active','approved historical item becomes claimable without cloning its legacy payload');
select throws_ok(format(
  'select public.apply_youtube_backfill(%L,%L,%L,%L,%L)',(select result->>'approval_id' from exact_preview),(select result->>'manifest_sha256' from exact_preview),'backfill-user','backfill-company','synthetic-applier'
), '55000','backfill approval was already applied','approval replay cannot duplicate deliveries');

create temporary table overlapping_approval as select public.preview_youtube_backfill(
  'backfill-user','backfill-company',array['10000000-0000-4000-8000-000000000010']::uuid[],
  '2099-11-01',1440,'synthetic-reviewer',30
) result;
select throws_ok(format(
  'select public.apply_youtube_backfill(%L,%L,%L,%L,%L)',(select result->>'approval_id' from overlapping_approval),(select result->>'manifest_sha256' from overlapping_approval),'backfill-user','backfill-company','synthetic-applier'
), '55000','YouTube quota schedule overlaps an existing nonterminal delivery','disjoint approvals cannot schedule overlapping YouTube quota windows');

create temporary table ordinary_overlap as select public.preview_youtube_backfill(
  'backfill-user','backfill-company',array['10000000-0000-4000-8000-000000000003']::uuid[],
  '2099-10-01',1440,'synthetic-reviewer',30
) result;
select throws_ok(format(
  'select public.apply_youtube_backfill(%L,%L,%L,%L,%L)',(select result->>'approval_id' from ordinary_overlap),(select result->>'manifest_sha256' from ordinary_overlap),'backfill-user','backfill-company','synthetic-applier'
), '55000','YouTube quota schedule overlaps an existing nonterminal delivery','backfill cannot overlap an ordinary future YouTube delivery');

create temporary table stale_preview as select public.preview_youtube_backfill(
  'backfill-user','backfill-company',array['10000000-0000-4000-8000-000000000011']::uuid[],
  '2099-12-01',1440,'synthetic-reviewer',30
) result;
update public.publisher_deliveries set platform_post_id='changed-after-preview'
where content_item_id='10000000-0000-4000-8000-000000000011' and platform='instagram';
select throws_ok(format(
  'select public.apply_youtube_backfill(%L,%L,%L,%L,%L)',(select result->>'approval_id' from stale_preview),(select result->>'manifest_sha256' from stale_preview),'backfill-user','backfill-company','synthetic-applier'
), '40001','backfill approval is stale; preview again','stale approvals cannot be applied');

select * from finish();
rollback;
