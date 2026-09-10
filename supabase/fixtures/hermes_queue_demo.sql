-- LOCAL SYNTHETIC DATA ONLY. Apply once after a local database reset.
insert into public.companies(user_id,id,name) values ('move-http-user','move-http-company','Synthetic Move Demo'),('move-http-other-user','move-http-company','Other Demo');
update public.publisher_queue_ownership set owner='replacement',epoch=2,cutoff_at=now(),reconciliation_sha256=repeat('a',64),transferred_at=now() where source='legacy_spp';
insert into public.scheduled_posts(id,user_id,company_id,item_id,content_type,caption,platforms,scheduled_at,status)
values ('10000000-0000-4000-8000-000000000001','move-http-user','move-http-company','import-1','post','Imported demo',array['facebook','linkedin'],'2099-09-11T11:00Z','queued');
insert into public.publisher_content_items(id,user_id,company_id,legacy_spp_id,item_id,content_type,caption,scheduled_at,approval_state,migration_state,legacy_status,legacy_payload,legacy_payload_sha256)
values ('20000000-0000-4000-8000-000000000001','move-http-user','move-http-company','10000000-0000-4000-8000-000000000001','import-1','post','Imported demo','2099-09-11T11:00Z','approved','active','queued',
jsonb_build_object('id','10000000-0000-4000-8000-000000000001','user_id','move-http-user','company_id','move-http-company','content_type','post','caption','Imported demo','scheduled_at','2099-09-11T11:00Z','status','queued'),repeat('b',64));
insert into public.publisher_content_items(id,user_id,company_id,content_type,caption,scheduled_at,approval_state,migration_state)
values ('20000000-0000-4000-8000-000000000002','move-http-user','move-http-company','post','Native demo','2099-09-13T11:00Z','approved','native'),
('20000000-0000-4000-8000-000000000003','move-http-user','move-http-company','post','Third demo','2099-09-15T11:00Z','approved','native'),
('20000000-0000-4000-8000-000000000004','move-http-other-user','move-http-company','post','Other tenant','2099-09-15T11:00Z','approved','native');
insert into public.publisher_deliveries(content_item_id,platform,state,idempotency_key,next_attempt_at)
select ci.id,p,'pending',ci.id::text||':'||p,ci.scheduled_at from public.publisher_content_items ci cross join unnest(array['facebook','linkedin']) p where ci.user_id in ('move-http-user','move-http-other-user');
