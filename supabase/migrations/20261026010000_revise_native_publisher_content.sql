-- Issue #41: atomically replace unattempted native work without creating another booking.
create table public.native_publisher_revisions (
  request_id uuid primary key,
  user_id text not null,
  company_id text not null,
  content_item_id uuid not null,
  fingerprint_sha256 text not null check (fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  response jsonb,
  created_at timestamptz not null default statement_timestamp(),
  constraint native_publisher_revision_response check (response is null or jsonb_typeof(response) = 'object')
);
alter table public.native_publisher_revisions enable row level security;
revoke all on public.native_publisher_revisions from public, anon, authenticated, service_role;
grant select on public.native_publisher_revisions to service_role;

create function publisher_private.revise_native_publisher_content(
  p_request_id uuid, p_user_id text, p_company_id text, p_content_item_id uuid,
  p_expected_epoch bigint, p_expected_lifecycle_version bigint,
  p_caption text, p_media jsonb, p_scheduled_at timestamptz,
  p_approval_reference text, p_actor text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_request public.native_publisher_revisions%rowtype;
  v_item public.publisher_content_items%rowtype;
  v_owner text;
  v_epoch bigint;
  v_platforms text[];
  v_fingerprint text;
  v_response jsonb;
  v_before jsonb;
begin
  perform publisher_private.assert_service_caller();
  if p_request_id is null or p_content_item_id is null
    or p_expected_epoch is null or p_expected_epoch < 1
    or p_expected_lifecycle_version is null or p_expected_lifecycle_version < 0
    or nullif(btrim(p_user_id),'') is null or nullif(btrim(p_company_id),'') is null
    or p_caption is null or nullif(btrim(p_caption),'') is null or length(p_caption) > 100000
    or p_media is null or jsonb_typeof(p_media) <> 'object' or octet_length(p_media::text) > 65536
    or p_scheduled_at is null or not isfinite(p_scheduled_at)
    or nullif(btrim(p_actor),'') is null or length(p_actor) > 128 or p_actor ~ '[[:cntrl:]]'
    or nullif(btrim(p_approval_reference),'') is null or length(p_approval_reference) > 256
    or p_approval_reference ~ '[[:cntrl:]]' then
    raise exception 'invalid native revision input' using errcode = '22023';
  end if;
  perform 1 from public.companies where user_id = p_user_id and id = p_company_id;
  if not found then raise exception 'native content not found' using errcode = 'P0002'; end if;
  -- The database computes the receipt digest; callers cannot claim a different payload is a replay.
  v_fingerprint := encode(extensions.digest(jsonb_build_object(
    'userId',p_user_id,'companyId',p_company_id,'contentItemId',p_content_item_id,
    'expectedEpoch',p_expected_epoch,'expectedLifecycleVersion',p_expected_lifecycle_version,
    'caption',p_caption,'media',p_media,'scheduledAt',to_char(p_scheduled_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'approvalReference',btrim(p_approval_reference),'actor',btrim(p_actor)
  )::text,'sha256'),'hex');
  -- Check tenant-scoped identity before inserting a receipt.
  perform 1 from public.publisher_content_items
    where id=p_content_item_id and user_id=p_user_id and company_id=p_company_id;
  if not found then raise exception 'native content not found' using errcode='P0002'; end if;
  insert into public.native_publisher_revisions(request_id,user_id,company_id,content_item_id,fingerprint_sha256)
    values(p_request_id,p_user_id,p_company_id,p_content_item_id,v_fingerprint)
    on conflict(request_id) do nothing;
  if not found then
    select * into v_request from public.native_publisher_revisions where request_id=p_request_id for update;
    if v_request.user_id is distinct from p_user_id or v_request.company_id is distinct from p_company_id
      or v_request.content_item_id is distinct from p_content_item_id
      or v_request.fingerprint_sha256 is distinct from v_fingerprint then
      raise exception 'native revision request ID was already used with different content' using errcode='23505';
    end if;
    if v_request.response is null then raise exception 'native revision request is incomplete' using errcode='40001'; end if;
    return v_request.response || jsonb_build_object('replayed',true);
  end if;
  if p_scheduled_at <= statement_timestamp() then
    raise exception 'native revision requires a future schedule' using errcode='22023';
  end if;
  -- Same ownership -> content -> delivery lock order as the guarded reschedule/claim paths.
  select owner,epoch into v_owner,v_epoch from public.publisher_queue_ownership
    where source='legacy_spp' for update;
  if v_owner is distinct from 'replacement' or v_epoch is distinct from p_expected_epoch then
    raise exception 'publisher ownership epoch conflict' using errcode='40001';
  end if;
  select * into v_item from public.publisher_content_items
    where id=p_content_item_id and user_id=p_user_id and company_id=p_company_id for update;
  if not found then raise exception 'native content not found' using errcode='P0002'; end if;
  perform 1 from public.publisher_deliveries where content_item_id=v_item.id order by id for update;
  if v_item.lifecycle_version <> p_expected_lifecycle_version then
    raise exception 'publisher lifecycle version conflict' using errcode='40001';
  end if;
  if v_item.source_system is null or v_item.ingestion_envelope is null or v_item.legacy_spp_id is not null
    or v_item.migration_state <> 'native' or v_item.approval_state <> 'approved'
    or v_item.publishability <> 'publishable' or v_item.content_type='article'
    or v_item.media_state <> 'ready' or v_item.content_state <> 'ready'
    or not exists(select 1 from public.publisher_deliveries where content_item_id=v_item.id)
    or exists(select 1 from public.hermes_social_schedules
      where source_content_item_id=v_item.id or target_content_item_id=v_item.id)
    or exists(select 1 from public.publisher_deliveries d where d.content_item_id=v_item.id
      and (d.state <> 'pending' or d.attempt_count <> 0 or d.lease_token is not null
        or d.lease_phase is not null or d.lease_expires_at is not null
        or d.platform_post_id is not null or d.published_at is not null or d.live_url is not null
        or d.provider_reconciliation_metadata <> '{}'::jsonb
        or d.platform not in ('facebook','instagram','linkedin')))
    or exists(select 1 from public.publisher_delivery_attempts a join public.publisher_deliveries d
      on d.id=a.delivery_id where d.content_item_id=v_item.id) then
    raise exception 'only ready unattempted native pending content can be revised' using errcode='55000';
  end if;
  select array_agg(platform order by platform) into v_platforms
    from public.publisher_deliveries where content_item_id=v_item.id;
  if ('linkedin'=any(v_platforms) and length(p_caption)>3000)
    or not publisher_private.native_media_is_ready(p_user_id,p_company_id,v_item.content_type,v_platforms,p_media) then
    raise exception 'revision media or caption does not satisfy platform requirements' using errcode='22023';
  end if;
  v_before := jsonb_build_object('caption',v_item.caption,'media',v_item.media,
    'scheduled_at',v_item.scheduled_at,'lifecycle_version',v_item.lifecycle_version);
  update public.publisher_content_items set caption=p_caption,media=p_media,scheduled_at=p_scheduled_at,
    lifecycle_version=lifecycle_version+1,last_release_fingerprint_sha256=null,last_release_response=null,
    updated_at=statement_timestamp() where id=v_item.id returning * into v_item;
  update public.publisher_deliveries set next_attempt_at=p_scheduled_at,last_error=null,
    updated_at=statement_timestamp() where content_item_id=v_item.id;
  select jsonb_build_object('content_item_id',v_item.id,'revised',true,'replayed',false,
    'scheduled_at',v_item.scheduled_at,'lifecycle_version',v_item.lifecycle_version,
    'deliveries',(select jsonb_agg(jsonb_build_object('id',id,'platform',platform,'state',state) order by platform)
      from public.publisher_deliveries where content_item_id=v_item.id)) into v_response;
  insert into public.publisher_audit_log(user_id,company_id,content_item_id,event_type,actor,details)
    values(p_user_id,p_company_id,v_item.id,'native_content_revised',btrim(p_actor),jsonb_build_object(
      'request_id',p_request_id,'approval_reference',btrim(p_approval_reference),'ownership_epoch',v_epoch,
      'before',v_before,'after',jsonb_build_object('caption',v_item.caption,'media',v_item.media,
      'scheduled_at',v_item.scheduled_at,'lifecycle_version',v_item.lifecycle_version)));
  update public.native_publisher_revisions set response=v_response where request_id=p_request_id;
  return v_response;
end;
$$;

create function public.revise_native_publisher_content(
  p_request_id uuid, p_user_id text, p_company_id text, p_content_item_id uuid,
  p_expected_epoch bigint, p_expected_lifecycle_version bigint,
  p_caption text, p_media jsonb, p_scheduled_at timestamptz,
  p_approval_reference text, p_actor text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  perform publisher_private.assert_service_caller();
  return publisher_private.revise_native_publisher_content(p_request_id,p_user_id,p_company_id,p_content_item_id,
    p_expected_epoch,p_expected_lifecycle_version,p_caption,p_media,p_scheduled_at,p_approval_reference,p_actor);
end;
$$;
revoke all on function publisher_private.revise_native_publisher_content(uuid,text,text,uuid,bigint,bigint,text,jsonb,timestamptz,text,text) from public,anon,authenticated,service_role;
revoke all on function public.revise_native_publisher_content(uuid,text,text,uuid,bigint,bigint,text,jsonb,timestamptz,text,text) from public,anon,authenticated,service_role;
grant execute on function publisher_private.revise_native_publisher_content(uuid,text,text,uuid,bigint,bigint,text,jsonb,timestamptz,text,text) to service_role;
grant execute on function public.revise_native_publisher_content(uuid,text,text,uuid,bigint,bigint,text,jsonb,timestamptz,text,text) to service_role;
