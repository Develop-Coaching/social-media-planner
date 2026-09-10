begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok(not has_function_privilege('anon','public.hermes_list_social_queue(text,text,integer,uuid,timestamptz,timestamptz)','execute'),'anon cannot list queue');
select ok(not has_function_privilege('authenticated','public.hermes_reschedule_social_queue(uuid,text,bigint,text,text,jsonb,text,text)','execute'),'authenticated cannot move queue');
select ok(not has_table_privilege('service_role','public.publisher_content_items','update'),'service caller cannot bypass RPC guard');
insert into public.companies(user_id,id,name) values ('move-user','move-company','Synthetic Move Demo'),('other-user','move-company','Other Demo');
update public.publisher_queue_ownership set owner='replacement',epoch=2,cutoff_at=now(),reconciliation_sha256=repeat('a',64),transferred_at=now() where source='legacy_spp';
insert into public.scheduled_posts(id,user_id,company_id,item_id,content_type,caption,platforms,scheduled_at,status)
values ('10000000-0000-4000-8000-000000000001','move-user','move-company','import-1','post','Imported demo',array['facebook','linkedin'],'2099-09-11T11:00Z','queued');
insert into public.publisher_content_items(id,user_id,company_id,legacy_spp_id,item_id,content_type,caption,scheduled_at,approval_state,migration_state,legacy_status,legacy_payload,legacy_payload_sha256)
values ('20000000-0000-4000-8000-000000000001','move-user','move-company','10000000-0000-4000-8000-000000000001','import-1','post','Imported demo','2099-09-11T11:00Z','approved','active','queued',
jsonb_build_object('id','10000000-0000-4000-8000-000000000001','user_id','move-user','company_id','move-company','content_type','post','caption','Imported demo','scheduled_at','2099-09-11T11:00Z','status','queued'),repeat('b',64));
insert into public.publisher_content_items(id,user_id,company_id,content_type,caption,scheduled_at,approval_state,migration_state)
values ('20000000-0000-4000-8000-000000000002','move-user','move-company','post','Native demo','2099-09-13T11:00Z','approved','native'),
('20000000-0000-4000-8000-000000000003','move-user','move-company','post','Third demo','2099-09-15T11:00Z','approved','native'),
('20000000-0000-4000-8000-000000000004','other-user','move-company','post','Other tenant','2099-09-15T11:00Z','approved','native');
insert into public.publisher_deliveries(content_item_id,platform,state,idempotency_key,next_attempt_at)
select ci.id,p,'pending',ci.id::text||':'||p,ci.scheduled_at from public.publisher_content_items ci cross join unnest(array['facebook','linkedin']) p where ci.user_id in ('move-user','other-user');
create temporary table original_deliveries as select id,content_item_id,idempotency_key from public.publisher_deliveries;
create temporary table move_preview as select id,scheduled_at,publisher_private.hermes_queue_fingerprint(id) fingerprint from public.publisher_content_items where user_id='move-user';
create function pg_temp.batch() returns jsonb language sql as $$ select jsonb_agg(jsonb_build_object('contentItemId',id,'expectedScheduledAt',scheduled_at,'expectedContentSha256',fingerprint,'scheduledAt',scheduled_at+interval '14 days') order by id) from move_preview $$;
select is(jsonb_array_length(public.hermes_list_social_queue('move-user','move-company')->'items'),3,'list includes imported and native items in tenant only');
select is((public.hermes_list_social_queue('move-user','move-company',1)->>'nextCursor'),'20000000-0000-4000-8000-000000000001','pagination cursor is last returned ID');
select is(jsonb_array_length(public.hermes_list_social_queue('move-user','move-company',50,'20000000-0000-4000-8000-000000000001')->'items'),2,'cursor has no repeated first item');
select is(jsonb_array_length(public.hermes_list_social_queue('move-user','move-company',50,null,'2099-09-13T11:00Z','2099-09-15T11:00Z')->'items'),1,'date bounds are inclusive/exclusive');
select is((public.hermes_resolve_social_queue('move-user','move-company',null,'10000000-0000-4000-8000-000000000001')->>'contentItemId'),'20000000-0000-4000-8000-000000000001','legacy identifier resolves unadopted item');
select is(public.hermes_resolve_social_queue('other-user','move-company','20000000-0000-4000-8000-000000000001'),null::jsonb,'resolver does not leak same-slug other-user record');
select throws_ok($$select public.hermes_resolve_social_queue('move-user','move-company','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001')$$,'22023','exactly one schedule identifier is required','ambiguous identifiers rejected');
select throws_ok($$select public.hermes_reschedule_social_queue(gen_random_uuid(),repeat('c',64),1,'move-user','move-company',pg_temp.batch(),'approval:demo','hermes:demo')$$,'40001','Hermes ownership mismatch','stale ownership rejected');
select throws_ok($$select public.hermes_reschedule_social_queue(gen_random_uuid(),repeat('c',64),2,'other-user','move-company',pg_temp.batch(),'approval:demo','hermes:demo')$$,'P0002','queue item not found','cross-tenant mutation rejected');
select throws_ok($$select public.hermes_reschedule_social_queue(gen_random_uuid(),repeat('c',64),2,'move-user','move-company',jsonb_set(pg_temp.batch(),'{1,expectedContentSha256}',to_jsonb(repeat('e',64))),'approval:demo','hermes:demo')$$,'40001','queue preview is stale; refresh before rescheduling','stale fingerprint rejects complete batch');
select is((select count(*) from public.publisher_content_items ci join move_preview p on p.id=ci.id where ci.scheduled_at=p.scheduled_at),3::bigint,'failed batch changes no dates');
select throws_ok($$update public.publisher_content_items set scheduled_at='2099-10-01' where id='20000000-0000-4000-8000-000000000001'$$,'23514','legacy SPP identity, payload, and publish projection are immutable','unscoped legacy date write still blocked');
select throws_ok($$select public.hermes_reschedule_social_queue(gen_random_uuid(),repeat('c',64),2,'move-user','move-company',jsonb_set(pg_temp.batch(),'{0,expectedScheduledAt}','"2099-09-12T11:00:00Z"'),'approval:demo','hermes:demo')$$,'40001','queue preview is stale; refresh before rescheduling','changed expected date rejected even with matching content fingerprint');
select throws_ok($$insert into public.publisher_content_items(user_id,company_id,legacy_spp_id,content_type,caption,scheduled_at,legacy_payload,legacy_payload_sha256)
select user_id,company_id,legacy_spp_id,content_type,caption,scheduled_at+interval '1 day',legacy_payload,legacy_payload_sha256 from public.publisher_content_items where id='20000000-0000-4000-8000-000000000001'$$,'23514','legacy import date must match immutable source payload','new imports must still match the immutable source date');
select lives_ok($$select public.hermes_reschedule_social_queue('40000000-0000-4000-8000-000000000001',repeat('c',64),2,'move-user','move-company',pg_temp.batch(),'approval:demo','hermes:demo')$$,'three-item atomic move works');
select is((select scheduled_at from public.publisher_content_items where id='20000000-0000-4000-8000-000000000001'),'2099-09-25T11:00Z'::timestamptz,'imported schedule moved in place');
select is((select scheduled_at from public.publisher_content_items where id='20000000-0000-4000-8000-000000000002'),'2099-09-27T11:00Z'::timestamptz,'native schedule moved in place');
select is((select scheduled_at from public.publisher_content_items where id='20000000-0000-4000-8000-000000000003'),'2099-09-29T11:00Z'::timestamptz,'third schedule moved in place');
select is((select legacy_payload->>'scheduled_at' from public.publisher_content_items where id='20000000-0000-4000-8000-000000000001'),'2099-09-11T11:00Z','immutable source date remains in payload');
select is((select scheduled_at from public.scheduled_posts where id='10000000-0000-4000-8000-000000000001'),'2099-09-11T11:00Z'::timestamptz,'retired legacy queue is untouched');
select is((select count(*) from original_deliveries o join public.publisher_deliveries d using(id,content_item_id,idempotency_key)),8::bigint,'delivery IDs and idempotency keys preserved');
select is((select count(*) from public.publisher_deliveries),8::bigint,'no duplicate deliveries created');
select is((select count(*) from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where d.next_attempt_at=ci.scheduled_at),8::bigint,'all delivery due times match effective schedules');
select is((select count(*) from public.publisher_audit_log where event_type='hermes_schedule_rescheduled'),3::bigint,'each move has one audit event');
select ok((public.hermes_reschedule_social_queue('40000000-0000-4000-8000-000000000001',repeat('c',64),2,'move-user','move-company',pg_temp.batch(),'approval:demo','hermes:demo')->>'replayed')::boolean,'identical request replays even though previews now stale');
select is((select count(*) from public.publisher_audit_log where event_type='hermes_schedule_rescheduled'),3::bigint,'replay does not add audit events');
select throws_ok($$select public.hermes_reschedule_social_queue('40000000-0000-4000-8000-000000000001',repeat('d',64),2,'move-user','move-company',pg_temp.batch(),'approval:demo','hermes:demo')$$,'23505','Hermes request ID was already used with different content','changed request cannot reuse UUID');
select throws_ok($$select public.hermes_reschedule_social_queue(gen_random_uuid(),repeat('c',64),2,'move-user','move-company',pg_temp.batch(),'approval:demo','hermes:demo')$$,'40001','queue preview is stale; refresh before rescheduling','old preview fails after move');
update move_preview p set scheduled_at=ci.scheduled_at,fingerprint=publisher_private.hermes_queue_fingerprint(ci.id) from public.publisher_content_items ci where ci.id=p.id;
update public.publisher_deliveries set state='verification_required' where content_item_id='20000000-0000-4000-8000-000000000002' and platform='facebook';
select ok(not publisher_private.hermes_queue_eligible('20000000-0000-4000-8000-000000000002'),'ambiguous platform makes whole item unsafe');
select throws_ok($$select public.hermes_reschedule_social_queue(gen_random_uuid(),repeat('c',64),2,'move-user','move-company',pg_temp.batch(),'approval:demo','hermes:demo')$$,'55000','queue item is not safely reschedulable','ambiguous middle item rejects entire batch');
select is((select count(*) from public.publisher_content_items ci join move_preview p on p.id=ci.id where ci.scheduled_at=p.scheduled_at),3::bigint,'ineligible batch makes no partial changes');
update public.publisher_deliveries set state='succeeded',platform_post_id='synthetic:done',published_at=now() where content_item_id='20000000-0000-4000-8000-000000000002' and platform='facebook';
select ok(not publisher_private.hermes_queue_eligible('20000000-0000-4000-8000-000000000002'),'partial success cannot move unfinished siblings');
update public.publisher_deliveries set state='pending',platform_post_id=null,published_at=null,attempt_count=1 where content_item_id='20000000-0000-4000-8000-000000000002' and platform='facebook';
select ok(not publisher_private.hermes_queue_eligible('20000000-0000-4000-8000-000000000002'),'any prior attempt rejects move');
update public.publisher_deliveries set state='leased',lease_token=gen_random_uuid(),lease_expires_at=now()+interval '1 minute',lease_phase='pre_dispatch' where content_item_id='20000000-0000-4000-8000-000000000002' and platform='facebook';
select throws_ok($$select public.hermes_reschedule_social_queue(gen_random_uuid(),repeat('c',64),2,'move-user','move-company',pg_temp.batch(),'approval:demo','hermes:demo')$$,'55000','queue item is not safely reschedulable','pre-dispatch lease rejects whole batch');
update public.publisher_deliveries set state='pending',attempt_count=0,lease_token=null,lease_expires_at=null,lease_phase=null where content_item_id='20000000-0000-4000-8000-000000000002' and platform='facebook';
insert into public.publisher_delivery_attempts(delivery_id,attempt_number,idempotency_key,lease_token,state,dispatch_started_at,finished_at)
select id,1,'synthetic:historical',gen_random_uuid(),'dead_letter',now(),now() from public.publisher_deliveries where content_item_id='20000000-0000-4000-8000-000000000002' and platform='facebook';
select ok(not publisher_private.hermes_queue_eligible('20000000-0000-4000-8000-000000000002'),'hidden historical attempt rejects move even with reset counter');
select throws_ok($$select public.hermes_reschedule_social_queue(gen_random_uuid(),repeat('c',64),2,'move-user','move-company','[]','approval:demo','hermes:demo')$$,'22023','invalid batch bounds','empty batch rejected');
select throws_ok($$select public.hermes_reschedule_social_queue(gen_random_uuid(),repeat('c',64),2,'move-user','move-company',jsonb_build_array(pg_temp.batch()->0,pg_temp.batch()->0),'approval:demo','hermes:demo')$$,'22023','duplicate content item in batch','duplicate target rejected');
select throws_ok($$select public.hermes_reschedule_social_queue(gen_random_uuid(),repeat('c',64),2,'move-user','move-company',jsonb_set(pg_temp.batch(),'{0,scheduledAt}','"2020-01-01T11:00:00Z"'),'approval:demo','hermes:demo')$$,'22023','reschedule timestamp must be finite and in the future','past target rejected');
select is((select count(*) from public.claim_publisher_deliveries(2,10,300,'2099-09-20T11:00Z')),2::bigint,'worker cannot claim moved items at old dates (only other tenant due)');
create temporary table adopted as select public.hermes_adopt_social_schedule(
 '40000000-0000-4000-8000-000000000009',repeat('f',64),2,'move-user','move-company',
 '10000000-0000-4000-8000-000000000001','2099-10-01T11:00Z','approval:adopt',repeat('b',64),'hermes:demo') result;
select ok((select (public.hermes_resolve_social_queue('move-user','move-company',null,null,(result->>'scheduleId')::uuid)->>'safeToReschedule')::boolean from adopted),'unattempted adopted schedule is movable');
select is((select public.hermes_resolve_social_queue('move-user','move-company',null,'10000000-0000-4000-8000-000000000001')->>'hermesScheduleId'),(select result->>'scheduleId' from adopted),'legacy resolver prefers active adopted target');
create temporary table adopted_preview as select public.hermes_resolve_social_queue('move-user','move-company',null,null,(result->>'scheduleId')::uuid) item from adopted;
select lives_ok($$select public.hermes_reschedule_social_queue(gen_random_uuid(),repeat('a',64),2,'move-user','move-company',
 (select jsonb_build_array(jsonb_build_object('contentItemId',item->>'contentItemId','expectedScheduledAt',item->>'scheduledAt','expectedContentSha256',item->>'contentFingerprintSha256','scheduledAt','2099-10-03T11:00:00Z')) from adopted_preview),'approval:adopt-move','hermes:demo')$$,'adopted item moves in place');
select is((select scheduled_at from public.hermes_social_schedules where id=(select (result->>'scheduleId')::uuid from adopted)),'2099-10-03T11:00Z'::timestamptz,'Hermes link schedule stays synchronized');
select is((select count(*) from public.hermes_social_schedules),1::bigint,'reschedule creates no replacement Hermes link');
select * from finish();
rollback;
