begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

select has_table('public', 'hermes_social_schedules', 'Hermes schedule links exist');
select has_table('public', 'hermes_social_schedule_requests', 'Hermes mutation identities exist');
select ok(not has_table_privilege('anon', 'public.hermes_social_schedules', 'select'), 'anon cannot read Hermes schedules');
select ok(not has_table_privilege('authenticated', 'public.hermes_social_schedules', 'select'), 'authenticated cannot read Hermes schedules');
select ok(not has_table_privilege('service_role', 'public.hermes_social_schedules', 'insert'), 'service role cannot bypass adoption RPC');
select ok(not has_table_privilege('service_role', 'public.hermes_social_schedule_requests', 'update'), 'service role cannot rewrite request audit');
select ok(not has_function_privilege('anon', 'public.hermes_adopt_social_schedule(uuid,text,bigint,text,text,uuid,timestamptz,text,text,text)', 'execute'), 'anon cannot adopt');
select ok(not has_function_privilege('authenticated', 'public.hermes_cancel_social_schedule(uuid,text,uuid,bigint,text,text,text,text)', 'execute'), 'authenticated cannot cancel');
select ok(has_function_privilege('service_role', 'public.hermes_restore_social_schedule(uuid,text,uuid,bigint,text,text,timestamptz,text)', 'execute'), 'service role can restore through RPC');

insert into public.companies(user_id,id,name) values
  ('hermes-user','hermes-company','Synthetic Hermes Tenant'),
  ('other-user','hermes-company','Synthetic Other Tenant With Same Slug');

update public.publisher_queue_ownership
set owner='replacement', epoch=2, cutoff_at=statement_timestamp(),
    reconciliation_sha256=repeat('a',64), transferred_at=statement_timestamp()
where source='legacy_spp';

insert into public.scheduled_posts(
  id,user_id,company_id,item_id,content_type,caption,platforms,scheduled_at,status
) values (
  '10000000-0000-4000-8000-000000000001','hermes-user','hermes-company',
  'synthetic-item','reel','synthetic caption',array['instagram','facebook','linkedin'],
  statement_timestamp()+interval '1 day','queued'
);

insert into public.publisher_content_items(
  id,user_id,company_id,legacy_spp_id,item_id,content_type,caption,media,
  scheduled_at,approval_state,publishability,migration_state,legacy_status,
  legacy_payload,legacy_payload_sha256
) values (
  '20000000-0000-4000-8000-000000000001','hermes-user','hermes-company',
  '10000000-0000-4000-8000-000000000001','synthetic-item','reel','synthetic caption','{}',
  statement_timestamp()+interval '1 day','approved','publishable','active','queued',
  jsonb_build_object(
    'id','10000000-0000-4000-8000-000000000001','user_id','hermes-user',
    'company_id','hermes-company','content_type','reel','caption','synthetic caption',
    'scheduled_at',to_jsonb(statement_timestamp()+interval '1 day')
  ),repeat('b',64)
);

insert into public.publisher_deliveries(
  id,content_item_id,platform,state,idempotency_key,next_attempt_at,
  platform_post_id,published_at
) values
  ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','instagram','pending','legacy-test:instagram',statement_timestamp()+interval '1 day',null,null),
  ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','facebook','pending','legacy-test:facebook',statement_timestamp()+interval '1 day',null,null),
  ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','linkedin','succeeded','legacy-test:linkedin',null,'synthetic-linkedin-id',statement_timestamp());

select is(
  (public.hermes_preview_legacy_social_schedule('hermes-user','hermes-company','10000000-0000-4000-8000-000000000001')->>'approvalState'),
  'approved','preview exposes approval state'
);
select is(
  (public.hermes_preview_legacy_social_schedule('hermes-user','hermes-company','10000000-0000-4000-8000-000000000001')->>'contentFingerprintSha256'),
  repeat('b',64),'preview exposes immutable content fingerprint'
);
select ok(
  (public.hermes_preview_legacy_social_schedule('hermes-user','hermes-company','10000000-0000-4000-8000-000000000001')->>'safeToAdopt')::boolean,
  'preview reports safe candidate'
);
select is(public.hermes_preview_legacy_social_schedule('other-user','hermes-company','10000000-0000-4000-8000-000000000001'),null::jsonb,'same company slug under another user cannot preview candidate');

select throws_ok(
  $$select public.hermes_adopt_social_schedule(
    '40000000-0000-4000-8000-000000000001',repeat('c',64),1,'hermes-user','hermes-company',
    '10000000-0000-4000-8000-000000000001',statement_timestamp()+interval '2 days',
    'approval:test',repeat('b',64),'hermes:test')$$,
  '40001','Hermes ownership mismatch','wrong ownership epoch fails closed'
);
select throws_ok(
  $$select public.hermes_adopt_social_schedule(
    '40000000-0000-4000-8000-000000000002',repeat('c',64),2,'hermes-user','hermes-company',
    '10000000-0000-4000-8000-000000000001',statement_timestamp()+interval '2 days',
    'approval:test',repeat('d',64),'hermes:test')$$,
  '55000','approved imported item is not adoptable','changed content fingerprint fails closed'
);
select throws_ok(
  $$select public.hermes_adopt_social_schedule(
    '40000000-0000-4000-8000-000000000003',repeat('c',64),2,'other-user','hermes-company',
    '10000000-0000-4000-8000-000000000001',statement_timestamp()+interval '2 days',
    'approval:test',repeat('b',64),'hermes:test')$$,
  'P0002','approved imported item not found','same company slug under another user cannot adopt candidate'
);
update public.publisher_deliveries set state='dead_letter'
where id='30000000-0000-4000-8000-000000000002';
select throws_ok(
  $$select public.hermes_adopt_social_schedule(
    '40000000-0000-4000-8000-000000000005',repeat('5',64),2,'hermes-user','hermes-company',
    '10000000-0000-4000-8000-000000000001',statement_timestamp()+interval '2 days',
    'approval:test',repeat('b',64),'hermes:test')$$,
  '55000','legacy item has a non-adoptable delivery state','terminal non-success source state cannot be reset by adoption'
);
update public.publisher_deliveries set state='pending'
where id='30000000-0000-4000-8000-000000000002';

insert into public.publisher_delivery_attempts(
  delivery_id,attempt_number,idempotency_key,lease_token,state,dispatch_started_at,finished_at
) values (
  '30000000-0000-4000-8000-000000000002',1,'synthetic-historical-attempt',
  '50000000-0000-4000-8000-000000000001','dead_letter',statement_timestamp(),statement_timestamp()
);
select throws_ok(
  $$select public.hermes_adopt_social_schedule(
    '40000000-0000-4000-8000-000000000006',repeat('6',64),2,'hermes-user','hermes-company',
    '10000000-0000-4000-8000-000000000001',statement_timestamp()+interval '2 days',
    'approval:test',repeat('b',64),'hermes:test')$$,
  '55000','legacy item has historical dispatch ambiguity','cleared delivery state cannot hide a historical dispatch start'
);
delete from public.publisher_delivery_attempts where idempotency_key='synthetic-historical-attempt';

create temporary table adoption_result as
select public.hermes_adopt_social_schedule(
  '40000000-0000-4000-8000-000000000010',repeat('e',64),2,'hermes-user','hermes-company',
  '10000000-0000-4000-8000-000000000001',statement_timestamp()+interval '2 days',
  'approval:test',repeat('b',64),'hermes:test') result;

select is((select result->>'replayed' from adoption_result),'false','first adoption is not a replay');
select is((select status from public.scheduled_posts where id='10000000-0000-4000-8000-000000000001'),'cancelled','legacy scheduler row is soft-cancelled atomically');
select is((select migration_state from public.publisher_content_items where id='20000000-0000-4000-8000-000000000001'),'historical','imported source is retired without deletion');
select is((select state from public.publisher_deliveries where id='30000000-0000-4000-8000-000000000003'),'succeeded','source success is preserved');
select is((select count(*)::integer from public.publisher_deliveries where content_item_id=(select target_content_item_id from public.hermes_social_schedules)),2,'only unfinished inherited platforms get native deliveries');
select is((select count(*)::integer from public.publisher_deliveries where content_item_id=(select target_content_item_id from public.hermes_social_schedules) and state='pending'),2,'native inherited platforms are scheduled once');
select is((select count(*)::integer from public.hermes_social_schedule_requests where request_id='40000000-0000-4000-8000-000000000010'),1,'mutation request ID is unique and audited');
select is(
  (public.hermes_adopt_social_schedule(
    '40000000-0000-4000-8000-000000000010',repeat('e',64),2,'hermes-user','hermes-company',
    '10000000-0000-4000-8000-000000000001',statement_timestamp()+interval '2 days',
    'approval:test',repeat('b',64),'hermes:test')->>'replayed'),
  'true','exact request replay returns the stored response without another delivery set'
);
select is((select count(*)::integer from public.hermes_social_schedules),1,'exact replay cannot duplicate a schedule');
select is(
  public.hermes_get_social_schedule((select id from public.hermes_social_schedules),'other-user','hermes-company'),
  null::jsonb,'same company slug under another user cannot read schedule status'
);
select throws_ok(
  $$select public.hermes_cancel_social_schedule(
    '40000000-0000-4000-8000-000000000017',repeat('9',64),
    (select id from public.hermes_social_schedules),2,'other-user','hermes-company','cross tenant','hermes:test')$$,
  'P0002','Hermes schedule not found','same company slug under another user cannot mutate schedule'
);
select throws_ok(
  $$select public.hermes_cancel_social_schedule(
    '40000000-0000-4000-8000-000000000010',repeat('f',64),
    (select id from public.hermes_social_schedules),2,'hermes-user','hermes-company','different request','hermes:test')$$,
  '23505','Hermes request ID was already used with different content','same request ID with changed digest conflicts'
);

update public.publisher_deliveries set state='dead_letter',next_attempt_at=null,last_error='synthetic terminal outcome'
where content_item_id=(select target_content_item_id from public.hermes_social_schedules) and platform='facebook';

select is(
  (public.hermes_cancel_social_schedule(
    '40000000-0000-4000-8000-000000000011',repeat('1',64),
    (select id from public.hermes_social_schedules),2,'hermes-user','hermes-company','operator requested','hermes:test')->>'state'),
  'cancelled','soft cancellation succeeds'
);
select is((select count(*)::integer from public.publisher_deliveries where content_item_id=(select target_content_item_id from public.hermes_social_schedules) and state='cancelled'),1,'cancel marks only pending/retryable native deliveries');
select is((select state from public.publisher_deliveries where content_item_id=(select target_content_item_id from public.hermes_social_schedules) and platform='facebook'),'dead_letter','cancel preserves a terminal target outcome');
select is((select state from public.publisher_deliveries where id='30000000-0000-4000-8000-000000000003'),'succeeded','cancel still preserves earlier platform success');

update public.publisher_deliveries set state='dead_letter'
where content_item_id=(select target_content_item_id from public.hermes_social_schedules) and platform='instagram';
select throws_ok(
  $$select public.hermes_restore_social_schedule(
    '40000000-0000-4000-8000-000000000015',repeat('7',64),
    (select id from public.hermes_social_schedules),2,'hermes-user','hermes-company',
    statement_timestamp()+interval '3 days','hermes:test')$$,
  '55000','schedule has no restorable deliveries','restore requires an actual cancelled delivery'
);
update public.publisher_deliveries set state='cancelled'
where content_item_id=(select target_content_item_id from public.hermes_social_schedules) and platform='instagram';

select is(
  (public.hermes_restore_social_schedule(
    '40000000-0000-4000-8000-000000000012',repeat('2',64),
    (select id from public.hermes_social_schedules),2,'hermes-user','hermes-company',
    statement_timestamp()+interval '3 days','hermes:test')->>'state'),
  'active','cancelled schedule can be safely restored'
);
select is((select count(*)::integer from public.publisher_deliveries where content_item_id=(select target_content_item_id from public.hermes_social_schedules) and state='pending'),1,'restore reactivates cancelled platforms only');
select is((select count(*)::integer from public.publisher_deliveries where state='succeeded'),1,'restore never recreates a succeeded platform');

update public.publisher_deliveries set state='dead_letter',next_attempt_at=null
where content_item_id=(select target_content_item_id from public.hermes_social_schedules) and platform='instagram';
select throws_ok(
  $$select public.hermes_cancel_social_schedule(
    '40000000-0000-4000-8000-000000000016',repeat('8',64),
    (select id from public.hermes_social_schedules),2,'hermes-user','hermes-company','terminal test','hermes:test')$$,
  '55000','schedule has no cancellable deliveries','fully terminal schedule cannot be misleadingly cancelled'
);
update public.publisher_deliveries set state='pending',next_attempt_at=statement_timestamp()+interval '3 days'
where content_item_id=(select target_content_item_id from public.hermes_social_schedules) and platform='instagram';

update public.publisher_deliveries set state='leased',lease_token=gen_random_uuid(),
  lease_expires_at=statement_timestamp()+interval '5 minutes',lease_phase='pre_dispatch'
where content_item_id=(select target_content_item_id from public.hermes_social_schedules) and platform='instagram';
select throws_ok(
  $$select public.hermes_cancel_social_schedule(
    '40000000-0000-4000-8000-000000000013',repeat('3',64),
    (select id from public.hermes_social_schedules),2,'hermes-user','hermes-company','race test','hermes:test')$$,
  '55000','schedule has a live lease or ambiguous dispatch','cancellation loses safely to a live publisher lease'
);
select is((select state from public.hermes_social_schedules),'active','failed racing cancellation leaves schedule active');

update public.publisher_deliveries set state='verification_required',lease_token=null,
  lease_expires_at=null,lease_phase=null
where content_item_id=(select target_content_item_id from public.hermes_social_schedules) and platform='instagram';
select throws_ok(
  $$select public.hermes_cancel_social_schedule(
    '40000000-0000-4000-8000-000000000014',repeat('4',64),
    (select id from public.hermes_social_schedules),2,'hermes-user','hermes-company','ambiguity test','hermes:test')$$,
  '55000','schedule has a live lease or ambiguous dispatch','ambiguous provider outcome is preserved and blocks cancellation'
);
select is((select state from public.publisher_deliveries where content_item_id=(select target_content_item_id from public.hermes_social_schedules) and platform='instagram'),'verification_required','ambiguous delivery remains untouched');
select is((select count(*)::integer from public.publisher_audit_log where event_type in ('hermes_schedule_adopted','hermes_schedule_cancelled','hermes_schedule_restored')),3,'adopt/cancel/restore actions are auditable');
select ok(not exists(select 1 from public.publisher_audit_log where details::text ~* '(access[_-]?token|authorization|secret)'), 'bridge audit contains no credential-shaped fields');

select * from finish();
rollback;
