-- Issue #35. Existing IDs and immutable source payloads remain unchanged.
-- Effective scheduled_at is movable only through the audited service-only RPC.
alter table public.publisher_content_items drop constraint publisher_content_items_legacy_projection;
alter table public.publisher_content_items add constraint publisher_content_items_legacy_projection check (
    legacy_spp_id is null or (
      legacy_spp_id = (legacy_payload->>'id')::uuid
      and user_id = legacy_payload->>'user_id'
      and company_id = legacy_payload->>'company_id'
      and content_type = lower(legacy_payload->>'content_type')
      and caption = coalesce(legacy_payload->>'caption', '')
      and legacy_status = legacy_payload->>'status'
      and publishability = case when lower(legacy_payload->>'content_type') = 'article'
        then 'planning_only' else 'publishable' end
    )
  );

create or replace function public.protect_legacy_publisher_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.legacy_spp_id is not null and new.scheduled_at is distinct from (new.legacy_payload->>'scheduled_at')::timestamptz then
      raise exception 'legacy import date must match immutable source payload' using errcode='23514';
    end if;
    return new;
  end if;
  if old.legacy_spp_id is not null and (
    new.legacy_spp_id is distinct from old.legacy_spp_id
    or new.legacy_payload is distinct from old.legacy_payload
    or new.legacy_payload_sha256 is distinct from old.legacy_payload_sha256
    or new.user_id is distinct from old.user_id
    or new.company_id is distinct from old.company_id
    or new.item_id is distinct from old.item_id
    or new.content_type is distinct from old.content_type
    or new.caption is distinct from old.caption
    or new.media is distinct from old.media
    or (new.scheduled_at is distinct from old.scheduled_at
      and coalesce(current_setting('publisher.hermes_reschedule_rpc', true), '') <> 'enabled')
    or new.publishability is distinct from old.publishability
    or new.legacy_status is distinct from old.legacy_status
  ) then
    raise exception 'legacy SPP identity, payload, and publish projection are immutable'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger protect_legacy_publisher_fields on public.publisher_content_items;
create trigger protect_legacy_publisher_fields before insert or update on public.publisher_content_items
for each row execute function public.protect_legacy_publisher_fields();

alter table public.hermes_social_schedule_requests
  drop constraint hermes_social_schedule_requests_operation_check,
  add constraint hermes_social_schedule_requests_operation_check
    check (operation in ('adopt', 'cancel', 'restore', 'reschedule'));

create or replace function publisher_private.hermes_reserve_request(
  p_request_id uuid,
  p_operation text,
  p_request_fingerprint_sha256 text,
  p_user_id text,
  p_company_id text,
  p_actor text,
  p_approval_reference text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.hermes_social_schedule_requests%rowtype;
begin
  if p_operation not in ('adopt', 'cancel', 'restore', 'reschedule')
    or p_request_fingerprint_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid Hermes request identity' using errcode = '22023';
  end if;

  insert into public.hermes_social_schedule_requests (
    request_id, operation, request_fingerprint_sha256,
    user_id, company_id, actor, approval_reference
  ) values (
    p_request_id, p_operation, p_request_fingerprint_sha256,
    p_user_id, p_company_id, p_actor, p_approval_reference
  ) on conflict (request_id) do nothing;

  if found then return null; end if;

  select * into v_existing
  from public.hermes_social_schedule_requests r
  where r.request_id = p_request_id
  for update;

  if v_existing.operation is distinct from p_operation
    or v_existing.request_fingerprint_sha256 is distinct from p_request_fingerprint_sha256
    or v_existing.user_id is distinct from p_user_id
    or v_existing.company_id is distinct from p_company_id then
    raise exception 'Hermes request ID was already used with different content'
      using errcode = '23505';
  end if;
  if v_existing.response is null then
    raise exception 'Hermes request is incomplete' using errcode = '40001';
  end if;
  return v_existing.response || jsonb_build_object('replayed', true);
end;
$$;

create or replace function publisher_private.hermes_queue_fingerprint(p_content_item_id uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select encode(extensions.digest(jsonb_build_object(
    'caption', ci.caption, 'media', ci.media, 'contentType', ci.content_type,
    'approvalState', ci.approval_state, 'mediaState', ci.media_state,
    'contentState', ci.content_state, 'lifecycleVersion', ci.lifecycle_version,
    'legacyHash', ci.legacy_payload_sha256,
    'platforms', (select jsonb_agg(d.platform order by d.platform)
      from public.publisher_deliveries d where d.content_item_id = ci.id)
  )::text, 'sha256'), 'hex')
  from public.publisher_content_items ci where ci.id = p_content_item_id
$$;

create or replace function publisher_private.hermes_queue_eligible(p_content_item_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce((select
    ci.approval_state = 'approved' and ci.publishability = 'publishable'
    and ci.migration_state in ('native','active') and ci.content_type <> 'article'
    and ci.media_state = 'ready' and ci.content_state = 'ready' and ci.scheduled_at is not null
    and coalesce(ci.legacy_spp_id::text, '') <> '367259e6-69af-461d-8510-09bd7eb6aea7'
    and exists (select 1 from public.publisher_queue_ownership o where o.source = 'legacy_spp' and o.owner = 'replacement')
    and exists (select 1 from public.publisher_deliveries d where d.content_item_id = ci.id)
    and not exists (select 1 from public.publisher_deliveries d where d.content_item_id = ci.id
      and (d.state <> 'pending' or d.attempt_count <> 0 or d.lease_token is not null
        or d.lease_phase is not null or d.platform_post_id is not null or d.published_at is not null
        or d.live_url is not null or d.provider_reconciliation_metadata <> '{}'::jsonb
        or d.platform not in ('instagram','facebook','linkedin')))
    and not exists (select 1 from public.publisher_delivery_attempts a
      join public.publisher_deliveries d on d.id = a.delivery_id where d.content_item_id = ci.id)
    and not exists (select 1 from public.hermes_social_schedules s where s.target_content_item_id = ci.id
      and (s.state <> 'active' or s.ownership_epoch <> (select o.epoch from public.publisher_queue_ownership o where o.source='legacy_spp')
        or s.legacy_spp_id = '367259e6-69af-461d-8510-09bd7eb6aea7'::uuid
        or exists (select 1 from public.publisher_deliveries d where d.content_item_id = s.source_content_item_id
          and (d.attempt_count <> 0 or d.state <> 'cancelled' or d.platform_post_id is not null or d.published_at is not null
            or d.live_url is not null or d.provider_reconciliation_metadata <> '{}'::jsonb))
        or exists (select 1 from public.publisher_delivery_attempts a join public.publisher_deliveries d on d.id=a.delivery_id
          where d.content_item_id=s.source_content_item_id)))
    and (ci.legacy_spp_id is null or (ci.legacy_status = 'queued' and exists (
      select 1 from public.scheduled_posts sp where sp.id=ci.legacy_spp_id
        and sp.user_id=ci.user_id and sp.company_id=ci.company_id and sp.status='queued'
        and sp.publisher_lease_token is null and not sp.publisher_verification_required and sp.publisher_claim_count=0)))
    from public.publisher_content_items ci where ci.id=p_content_item_id), false)
$$;

create or replace function publisher_private.hermes_queue_item(p_content_item_id uuid,p_user_id text,p_company_id text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'contentItemId',ci.id,'legacySppId',coalesce(ci.legacy_spp_id,s.legacy_spp_id),
    'hermesScheduleId',s.id,'sourceSystem',ci.source_system,'sourceId',ci.source_id,
    'companyId',ci.company_id,'caption',ci.caption,'contentType',ci.content_type,
    'scheduledAt',ci.scheduled_at,'approvalState',ci.approval_state,
    'contentFingerprintSha256',publisher_private.hermes_queue_fingerprint(ci.id),
    'platforms',publisher_private.hermes_delivery_outcomes(s.source_content_item_id,ci.id),
    'safeToReschedule',publisher_private.hermes_queue_eligible(ci.id)
  ) from public.publisher_content_items ci
  left join public.hermes_social_schedules s on s.target_content_item_id=ci.id
    and s.user_id=p_user_id and s.company_id=p_company_id
  where ci.id=p_content_item_id and ci.user_id=p_user_id and ci.company_id=p_company_id
$$;

create or replace function publisher_private.hermes_list_social_queue(
  p_user_id text,p_company_id text,p_limit integer default 50,p_cursor uuid default null,
  p_from timestamptz default null,p_to timestamptz default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[]; v_items jsonb; v_epoch bigint;
begin
  perform publisher_private.assert_service_caller();
  if p_limit is null or p_limit < 1 or p_limit > 100 or (p_from is not null and p_to is not null and p_from >= p_to) then
    raise exception 'invalid queue bounds' using errcode='22023';
  end if;
  select array_agg(x.id order by x.id) into v_ids from (
    select ci.id from public.publisher_content_items ci where ci.user_id=p_user_id and ci.company_id=p_company_id
      and ci.migration_state <> 'historical'
      and (p_cursor is null or ci.id > p_cursor)
      and (p_from is null or ci.scheduled_at >= p_from) and (p_to is null or ci.scheduled_at < p_to)
    order by ci.id limit p_limit+1) x;
  select coalesce(jsonb_agg(publisher_private.hermes_queue_item(x.id,p_user_id,p_company_id) order by x.id),'[]'::jsonb)
    into v_items from unnest(v_ids[1:p_limit]) x(id);
  select epoch into v_epoch from public.publisher_queue_ownership where source='legacy_spp';
  return jsonb_build_object('ownershipEpoch',v_epoch,'items',v_items,
    'nextCursor',case when cardinality(v_ids)>p_limit then v_ids[p_limit] else null end);
end $$;

create or replace function publisher_private.hermes_resolve_social_queue(
  p_user_id text,p_company_id text,p_content_item_id uuid default null,
  p_legacy_spp_id uuid default null,p_schedule_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform publisher_private.assert_service_caller();
  if num_nonnulls(p_content_item_id,p_legacy_spp_id,p_schedule_id) <> 1 then
    raise exception 'exactly one schedule identifier is required' using errcode='22023';
  end if;
  if p_content_item_id is not null then v_id:=p_content_item_id;
  elsif p_schedule_id is not null then
    select target_content_item_id into v_id from public.hermes_social_schedules
      where id=p_schedule_id and user_id=p_user_id and company_id=p_company_id;
  else
    select target_content_item_id into v_id from public.hermes_social_schedules
      where legacy_spp_id=p_legacy_spp_id and user_id=p_user_id and company_id=p_company_id;
    if v_id is null then select id into v_id from public.publisher_content_items
      where legacy_spp_id=p_legacy_spp_id and user_id=p_user_id and company_id=p_company_id; end if;
  end if;
  return publisher_private.hermes_queue_item(v_id,p_user_id,p_company_id);
end $$;

create or replace function publisher_private.hermes_reschedule_social_queue(
  p_request_id uuid,p_request_fingerprint_sha256 text,p_expected_epoch bigint,
  p_user_id text,p_company_id text,p_changes jsonb,p_approval_reference text,p_actor text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb; v_result jsonb; v_owner text; v_epoch bigint;
  v_change jsonb; v_item public.publisher_content_items%rowtype;
  v_new timestamptz; v_old timestamptz; v_guard text;
  v_actor text := publisher_private.assert_hermes_text(p_actor,'actor',128);
  v_approval text := publisher_private.assert_hermes_text(p_approval_reference,'approval reference',256);
  v_changes jsonb := '[]'::jsonb;
begin
  perform publisher_private.assert_service_caller();
  if jsonb_typeof(p_changes) is distinct from 'array' then
    raise exception 'changes must be an array' using errcode='22023';
  end if;
  if jsonb_array_length(p_changes) < 1 or jsonb_array_length(p_changes) > 20
    or p_expected_epoch is null or p_expected_epoch < 1 then
    raise exception 'invalid batch bounds' using errcode='22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_changes) x where jsonb_typeof(x) <> 'object'
    or not (x ?& array['contentItemId','scheduledAt','expectedScheduledAt','expectedContentSha256'])
    or (select count(*) from jsonb_object_keys(x)) <> 4
    or jsonb_typeof(x->'contentItemId') <> 'string' or jsonb_typeof(x->'scheduledAt') <> 'string'
    or jsonb_typeof(x->'expectedScheduledAt') <> 'string' or jsonb_typeof(x->'expectedContentSha256') <> 'string'
    or (x->>'expectedContentSha256') !~ '^[0-9a-f]{64}$') then
    raise exception 'invalid batch change' using errcode='22023';
  end if;
  if (select count(distinct (x->>'contentItemId')::uuid) from jsonb_array_elements(p_changes) x) <> jsonb_array_length(p_changes) then
    raise exception 'duplicate content item in batch' using errcode='22023';
  end if;
  v_replay := publisher_private.hermes_reserve_request(p_request_id,'reschedule',p_request_fingerprint_sha256,
    p_user_id,p_company_id,v_actor,v_approval);
  if v_replay is not null then return v_replay; end if;

  -- Same first lock as claim_publisher_deliveries: a claim and a move cannot race.
  select owner,epoch into v_owner,v_epoch from public.publisher_queue_ownership where source='legacy_spp' for update;
  if v_owner is distinct from 'replacement' or v_epoch is distinct from p_expected_epoch then
    raise exception 'Hermes ownership mismatch' using errcode='40001';
  end if;
  -- Deterministic row locks also serialize with native media/release and Hermes cancel/restore.
  perform 1 from public.publisher_content_items ci where ci.user_id=p_user_id and ci.company_id=p_company_id
    and ci.id in (select (x->>'contentItemId')::uuid from jsonb_array_elements(p_changes) x) order by ci.id for update;
  perform 1 from public.hermes_social_schedules s where s.user_id=p_user_id and s.company_id=p_company_id
    and s.target_content_item_id in (select (x->>'contentItemId')::uuid from jsonb_array_elements(p_changes) x) order by s.id for update;
  perform 1 from public.publisher_deliveries d where d.content_item_id in (
    select ci.id from public.publisher_content_items ci where ci.user_id=p_user_id and ci.company_id=p_company_id
      and ci.id in (select (x->>'contentItemId')::uuid from jsonb_array_elements(p_changes) x)) order by d.id for update;
  perform 1 from public.scheduled_posts sp where sp.user_id=p_user_id and sp.company_id=p_company_id
    and sp.id in (select ci.legacy_spp_id from public.publisher_content_items ci
      where ci.user_id=p_user_id and ci.company_id=p_company_id
        and ci.id in (select (x->>'contentItemId')::uuid from jsonb_array_elements(p_changes) x)) order by sp.id for update;

  -- Validate the whole batch before changing any schedule.
  for v_change in select value from jsonb_array_elements(p_changes) loop
    select * into v_item from public.publisher_content_items ci where ci.id=(v_change->>'contentItemId')::uuid
      and ci.user_id=p_user_id and ci.company_id=p_company_id;
    if not found then raise exception 'queue item not found' using errcode='P0002'; end if;
    v_new := (v_change->>'scheduledAt')::timestamptz;
    v_old := (v_change->>'expectedScheduledAt')::timestamptz;
    if v_new is null or not isfinite(v_new) or v_new <= statement_timestamp() or v_old is null or not isfinite(v_old) then
      raise exception 'reschedule timestamp must be finite and in the future' using errcode='22023'; end if;
    if v_item.scheduled_at is distinct from v_old or publisher_private.hermes_queue_fingerprint(v_item.id) is distinct from (v_change->>'expectedContentSha256') then
      raise exception 'queue preview is stale; refresh before rescheduling' using errcode='40001'; end if;
    if not publisher_private.hermes_queue_eligible(v_item.id) then
      raise exception 'queue item is not safely reschedulable' using errcode='55000'; end if;
  end loop;
  v_guard:=current_setting('publisher.hermes_reschedule_rpc',true);
  perform set_config('publisher.hermes_reschedule_rpc','enabled',true);
  for v_change in select value from jsonb_array_elements(p_changes) loop
    v_new:=(v_change->>'scheduledAt')::timestamptz;
    update public.publisher_content_items set scheduled_at=v_new,lifecycle_version=lifecycle_version+1,updated_at=statement_timestamp()
      where id=(v_change->>'contentItemId')::uuid and user_id=p_user_id and company_id=p_company_id returning * into v_item;
    update public.publisher_deliveries set next_attempt_at=v_new,updated_at=statement_timestamp() where content_item_id=v_item.id;
    update public.hermes_social_schedules set scheduled_at=v_new,updated_at=statement_timestamp()
      where target_content_item_id=v_item.id and user_id=p_user_id and company_id=p_company_id;
    insert into public.publisher_audit_log(user_id,company_id,content_item_id,event_type,actor,details)
      values(p_user_id,p_company_id,v_item.id,'hermes_schedule_rescheduled',v_actor,jsonb_build_object(
        'request_id',p_request_id,'request_fingerprint_sha256',p_request_fingerprint_sha256,
        'ownership_epoch',v_epoch,'approval_reference',v_approval,
        'previous_scheduled_at',(v_change->>'expectedScheduledAt')::timestamptz,'scheduled_at',v_new,
        'previous_content_fingerprint_sha256',v_change->>'expectedContentSha256'));
    v_changes:=v_changes || jsonb_build_array(jsonb_build_object('contentItemId',v_item.id,
      'previousScheduledAt',(v_change->>'expectedScheduledAt')::timestamptz,'scheduledAt',v_new));
  end loop;
  perform set_config('publisher.hermes_reschedule_rpc',coalesce(v_guard,''),true);
  v_result:=jsonb_build_object('replayed',false,'ownershipEpoch',v_epoch,'changes',v_changes,'approvalReference',v_approval);
  update public.hermes_social_schedule_requests set response=v_result where request_id=p_request_id;
  return v_result;
end $$;

create or replace function public.hermes_list_social_queue(p_user_id text,p_company_id text,p_limit integer default 50,p_cursor uuid default null,p_from timestamptz default null,p_to timestamptz default null)
returns jsonb language plpgsql security invoker set search_path='' as $$ begin
  perform publisher_private.assert_service_caller();
  return publisher_private.hermes_list_social_queue(p_user_id,p_company_id,p_limit,p_cursor,p_from,p_to);
end $$;
create or replace function public.hermes_resolve_social_queue(p_user_id text,p_company_id text,p_content_item_id uuid default null,p_legacy_spp_id uuid default null,p_schedule_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$ begin
  perform publisher_private.assert_service_caller();
  return publisher_private.hermes_resolve_social_queue(p_user_id,p_company_id,p_content_item_id,p_legacy_spp_id,p_schedule_id);
end $$;
create or replace function public.hermes_reschedule_social_queue(p_request_id uuid,p_request_fingerprint_sha256 text,p_expected_epoch bigint,p_user_id text,p_company_id text,p_changes jsonb,p_approval_reference text,p_actor text)
returns jsonb language plpgsql security invoker set search_path='' as $$ begin
  perform publisher_private.assert_service_caller();
  return publisher_private.hermes_reschedule_social_queue(p_request_id,p_request_fingerprint_sha256,p_expected_epoch,p_user_id,p_company_id,p_changes,p_approval_reference,p_actor);
end $$;
revoke all on function public.hermes_list_social_queue(text,text,integer,uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.hermes_resolve_social_queue(text,text,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.hermes_reschedule_social_queue(uuid,text,bigint,text,text,jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.hermes_list_social_queue(text,text,integer,uuid,timestamptz,timestamptz) to service_role;
grant execute on function public.hermes_resolve_social_queue(text,text,uuid,uuid,uuid) to service_role;
grant execute on function public.hermes_reschedule_social_queue(uuid,text,bigint,text,text,jsonb,text,text) to service_role;
revoke all on all functions in schema publisher_private from public,anon,authenticated,service_role;
grant execute on all functions in schema publisher_private to service_role;
