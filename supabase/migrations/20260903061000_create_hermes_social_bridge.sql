-- Hermes scheduling bridge (issue #24).
--
-- Additive and server-only. Hermes can adopt an approved imported legacy item
-- only after the replacement publisher owns the queue. The immutable import is
-- retained; a native content item is created for the Hermes-controlled schedule.

create table public.hermes_social_schedules (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source = 'legacy_spp'),
  ownership_epoch bigint not null check (ownership_epoch > 0),
  user_id text not null,
  company_id text not null,
  legacy_spp_id uuid not null unique,
  source_content_item_id uuid not null unique
    references public.publisher_content_items(id) on delete restrict,
  target_content_item_id uuid not null unique
    references public.publisher_content_items(id) on delete restrict,
  approval_reference text not null,
  content_fingerprint_sha256 text not null
    check (content_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('active', 'cancelled')),
  scheduled_at timestamptz not null,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_by text not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint hermes_social_schedules_tenant_fk foreign key (user_id, company_id)
    references public.companies(user_id, id) on delete restrict,
  constraint hermes_social_schedules_cancel_shape check (
    (state = 'active' and cancelled_at is null and cancellation_reason is null)
    or (state = 'cancelled' and cancelled_at is not null and nullif(btrim(cancellation_reason), '') is not null)
  )
);

create index hermes_social_schedules_tenant_idx
  on public.hermes_social_schedules (user_id, company_id, scheduled_at);

create table public.hermes_social_schedule_requests (
  request_id uuid primary key,
  operation text not null check (operation in ('adopt', 'cancel', 'restore')),
  request_fingerprint_sha256 text not null
    check (request_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  schedule_id uuid references public.hermes_social_schedules(id) on delete restrict,
  user_id text not null,
  company_id text not null,
  actor text not null,
  approval_reference text,
  response jsonb,
  occurred_at timestamptz not null default statement_timestamp(),
  constraint hermes_social_schedule_requests_tenant_fk foreign key (user_id, company_id)
    references public.companies(user_id, id) on delete restrict
);

create index hermes_social_schedule_requests_schedule_idx
  on public.hermes_social_schedule_requests (schedule_id, occurred_at);

alter table public.hermes_social_schedules enable row level security;
alter table public.hermes_social_schedule_requests enable row level security;

revoke all on table public.hermes_social_schedules from public, anon, authenticated, service_role;
revoke all on table public.hermes_social_schedule_requests from public, anon, authenticated, service_role;
grant select on table public.hermes_social_schedules to service_role;
grant select on table public.hermes_social_schedule_requests to service_role;

create or replace function publisher_private.assert_hermes_text(
  p_value text,
  p_label text,
  p_max_length integer
)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_value text := btrim(p_value);
begin
  if nullif(v_value, '') is null or length(v_value) > p_max_length
    or v_value ~ '[[:cntrl:]]' then
    raise exception 'invalid Hermes %', p_label using errcode = '22023';
  end if;
  return v_value;
end;
$$;

create or replace function publisher_private.hermes_delivery_outcomes(
  p_source_content_item_id uuid,
  p_target_content_item_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'platform', x.platform,
    'state', x.state,
    'attemptCount', x.attempt_count,
    'platformPostId', x.platform_post_id,
    'liveUrl', x.live_url,
    'publishedAt', x.published_at,
    'hasError', x.last_error is not null
  ) order by x.platform), '[]'::jsonb)
  from (
    select distinct on (d.platform)
      d.platform, d.state, d.attempt_count, d.platform_post_id,
      d.live_url, d.published_at, d.last_error,
      case when d.state = 'succeeded' then 0 else 1 end as priority
    from public.publisher_deliveries d
    where d.content_item_id in (p_source_content_item_id, p_target_content_item_id)
      and (d.content_item_id = p_target_content_item_id or d.state = 'succeeded')
    order by d.platform, priority, d.created_at desc
  ) x
$$;

create or replace function publisher_private.hermes_schedule_result(
  p_schedule_id uuid,
  p_user_id text,
  p_company_id text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_schedule public.hermes_social_schedules%rowtype;
begin
  select * into v_schedule
  from public.hermes_social_schedules s
  where s.id = p_schedule_id and s.user_id = p_user_id and s.company_id = p_company_id;
  if not found then return null; end if;

  return jsonb_build_object(
    'scheduleId', v_schedule.id,
    'source', v_schedule.source,
    'legacySppId', v_schedule.legacy_spp_id,
    'companyId', v_schedule.company_id,
    'ownershipEpoch', v_schedule.ownership_epoch,
    'state', v_schedule.state,
    'scheduledAt', v_schedule.scheduled_at,
    'approvalReference', v_schedule.approval_reference,
    'contentFingerprintSha256', v_schedule.content_fingerprint_sha256,
    'cancelledAt', v_schedule.cancelled_at,
    'createdAt', v_schedule.created_at,
    'updatedAt', v_schedule.updated_at,
    'platforms', publisher_private.hermes_delivery_outcomes(
      v_schedule.source_content_item_id, v_schedule.target_content_item_id)
  );
end;
$$;

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
  if p_operation not in ('adopt', 'cancel', 'restore')
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

create or replace function publisher_private.hermes_preview_legacy_social_schedule(
  p_user_id text,
  p_company_id text,
  p_legacy_spp_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_content public.publisher_content_items%rowtype;
begin
  select * into v_content
  from public.publisher_content_items ci
  where ci.user_id = p_user_id and ci.company_id = p_company_id
    and ci.legacy_spp_id = p_legacy_spp_id;
  if not found then return null; end if;

  return jsonb_build_object(
    'legacySppId', v_content.legacy_spp_id,
    'companyId', v_content.company_id,
    'currentSchedule', v_content.scheduled_at,
    'approvalState', v_content.approval_state,
    'contentFingerprintSha256', v_content.legacy_payload_sha256,
    'migrationState', v_content.migration_state,
    'ownershipEpoch', (select o.epoch from public.publisher_queue_ownership o
      where o.source = 'legacy_spp' and o.owner = 'replacement'),
    'platforms', coalesce((
      select jsonb_agg(jsonb_build_object('platform', d.platform, 'state', d.state) order by d.platform)
      from public.publisher_deliveries d where d.content_item_id = v_content.id
    ), '[]'::jsonb),
    'safeToAdopt', v_content.approval_state = 'approved'
      and v_content.publishability = 'publishable'
      and v_content.migration_state = 'active'
      and v_content.legacy_status = 'queued'
      and v_content.legacy_spp_id <> '367259e6-69af-461d-8510-09bd7eb6aea7'::uuid
      and exists (select 1 from public.publisher_queue_ownership o
        where o.source = 'legacy_spp' and o.owner = 'replacement')
      and exists (select 1 from public.scheduled_posts sp
        where sp.id = v_content.legacy_spp_id and sp.user_id = v_content.user_id
          and sp.company_id = v_content.company_id and sp.status = 'queued'
          and sp.publisher_lease_token is null and not sp.publisher_verification_required)
      and not exists (select 1 from public.hermes_social_schedules s
        where s.legacy_spp_id = v_content.legacy_spp_id)
      and exists (select 1 from public.publisher_deliveries d
        where d.content_item_id = v_content.id)
      and not exists (
        select 1 from public.publisher_deliveries d
        where d.content_item_id = v_content.id
          and (d.state not in ('pending', 'retryable', 'succeeded')
            or d.lease_token is not null or d.lease_phase = 'dispatch_started')
      )
      and not exists (
        select 1 from public.publisher_deliveries d
        join public.publisher_delivery_attempts a on a.delivery_id = d.id
        where d.content_item_id = v_content.id and d.state <> 'succeeded'
          and a.dispatch_started_at is not null
      )
  );
end;
$$;

create or replace function publisher_private.hermes_get_social_schedule(
  p_schedule_id uuid,
  p_user_id text,
  p_company_id text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select publisher_private.hermes_schedule_result(p_schedule_id, p_user_id, p_company_id)
$$;

create or replace function publisher_private.hermes_adopt_social_schedule(
  p_request_id uuid,
  p_request_fingerprint_sha256 text,
  p_expected_epoch bigint,
  p_user_id text,
  p_company_id text,
  p_legacy_spp_id uuid,
  p_scheduled_at timestamptz,
  p_approval_reference text,
  p_expected_content_sha256 text,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner text;
  v_epoch bigint;
  v_source public.publisher_content_items%rowtype;
  v_target_id uuid;
  v_schedule_id uuid;
  v_replay jsonb;
  v_result jsonb;
  v_actor text := publisher_private.assert_hermes_text(p_actor, 'actor', 128);
  v_approval text := publisher_private.assert_hermes_text(p_approval_reference, 'approval reference', 256);
begin
  if p_legacy_spp_id = '367259e6-69af-461d-8510-09bd7eb6aea7'::uuid then
    raise exception 'protected schedule cannot be used by the Hermes bridge' using errcode = '42501';
  end if;

  perform 1 from public.companies where user_id = p_user_id and id = p_company_id;
  if not found then raise exception 'configured Hermes tenant not found' using errcode = 'P0002'; end if;

  v_replay := publisher_private.hermes_reserve_request(
    p_request_id, 'adopt', p_request_fingerprint_sha256,
    p_user_id, p_company_id, v_actor, v_approval);
  if v_replay is not null then return v_replay; end if;

  if p_scheduled_at is null or p_scheduled_at <= statement_timestamp()
    or p_expected_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid Hermes adoption input' using errcode = '22023';
  end if;

  select owner, epoch into v_owner, v_epoch
  from public.publisher_queue_ownership
  where source = 'legacy_spp' for update;
  if v_owner is distinct from 'replacement' or v_epoch is distinct from p_expected_epoch then
    raise exception 'Hermes ownership mismatch' using errcode = '40001';
  end if;

  select * into v_source
  from public.publisher_content_items ci
  where ci.user_id = p_user_id and ci.company_id = p_company_id
    and ci.legacy_spp_id = p_legacy_spp_id
  for update;
  if not found then raise exception 'approved imported item not found' using errcode = 'P0002'; end if;
  if v_source.approval_state <> 'approved' or v_source.publishability <> 'publishable'
    or v_source.migration_state <> 'active' or v_source.legacy_status <> 'queued'
    or v_source.legacy_payload_sha256 is distinct from p_expected_content_sha256 then
    raise exception 'approved imported item is not adoptable' using errcode = '55000';
  end if;
  if exists (select 1 from public.hermes_social_schedules s where s.legacy_spp_id = p_legacy_spp_id) then
    raise exception 'legacy item is already adopted' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.publisher_deliveries d where d.content_item_id = v_source.id
      and (d.state in ('leased', 'verification_required') or d.lease_token is not null
        or d.lease_phase = 'dispatch_started')
  ) then
    raise exception 'legacy item has a live lease or ambiguous dispatch' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.publisher_deliveries d
    where d.content_item_id = v_source.id
      and d.state not in ('pending', 'retryable', 'succeeded')
  ) then
    raise exception 'legacy item has a non-adoptable delivery state' using errcode = '55000';
  end if;
  if exists (
    select 1
    from public.publisher_deliveries d
    join public.publisher_delivery_attempts a on a.delivery_id = d.id
    where d.content_item_id = v_source.id and d.state <> 'succeeded'
      and a.dispatch_started_at is not null
  ) then
    raise exception 'legacy item has historical dispatch ambiguity' using errcode = '55000';
  end if;
  if not exists (select 1 from public.publisher_deliveries d where d.content_item_id = v_source.id) then
    raise exception 'legacy item has no platform deliveries' using errcode = '55000';
  end if;

  perform 1 from public.scheduled_posts sp
  where sp.id = p_legacy_spp_id and sp.user_id = v_source.user_id
    and sp.company_id = p_company_id and sp.status = 'queued'
    and sp.publisher_lease_token is null and not sp.publisher_verification_required
  for update;
  if not found then
    raise exception 'legacy source schedule is not safely cancellable' using errcode = '55000';
  end if;

  insert into public.publisher_content_items (
    user_id, company_id, item_id, content_type, caption, media, scheduled_at,
    approval_state, publishability, migration_state
  ) values (
    v_source.user_id, v_source.company_id, v_source.item_id, v_source.content_type,
    v_source.caption, v_source.media, p_scheduled_at,
    'approved', 'publishable', 'native'
  ) returning id into v_target_id;

  insert into public.hermes_social_schedules (
    source, ownership_epoch, user_id, company_id, legacy_spp_id,
    source_content_item_id, target_content_item_id, approval_reference,
    content_fingerprint_sha256, state, scheduled_at, created_by
  ) values (
    'legacy_spp', v_epoch, v_source.user_id, v_source.company_id, p_legacy_spp_id,
    v_source.id, v_target_id, v_approval, p_expected_content_sha256,
    'active', p_scheduled_at, v_actor
  ) returning id into v_schedule_id;

  insert into public.publisher_deliveries (
    content_item_id, platform, state, idempotency_key, next_attempt_at
  )
  select v_target_id, d.platform, 'pending',
    'hermes:' || v_schedule_id::text || ':' || d.platform, p_scheduled_at
  from public.publisher_deliveries d
  where d.content_item_id = v_source.id and d.state in ('pending', 'retryable');

  update public.publisher_deliveries
  set state = 'cancelled', next_attempt_at = null,
      last_error = 'Retired by Hermes adoption', updated_at = statement_timestamp()
  where content_item_id = v_source.id and state in ('pending', 'retryable');

  update public.publisher_content_items
  set migration_state = 'historical', updated_at = statement_timestamp()
  where id = v_source.id;

  update public.scheduled_posts
  set status = 'cancelled', error = 'Adopted by deterministic Hermes bridge',
      updated_at = statement_timestamp()
  where id = p_legacy_spp_id;

  insert into public.publisher_audit_log (
    user_id, company_id, content_item_id, event_type, actor, details
  ) values (
    v_source.user_id, v_source.company_id, v_target_id,
    'hermes_schedule_adopted', v_actor,
    jsonb_build_object(
      'schedule_id', v_schedule_id, 'legacy_spp_id', p_legacy_spp_id,
      'ownership_epoch', v_epoch, 'scheduled_at', p_scheduled_at,
      'approval_reference', v_approval,
      'content_fingerprint_sha256', p_expected_content_sha256,
      'request_id', p_request_id,
      'request_fingerprint_sha256', p_request_fingerprint_sha256
    )
  );

  v_result := publisher_private.hermes_schedule_result(v_schedule_id, p_user_id, p_company_id)
    || jsonb_build_object('replayed', false);
  update public.hermes_social_schedule_requests
  set schedule_id = v_schedule_id, response = v_result
  where request_id = p_request_id;
  return v_result;
end;
$$;

create or replace function publisher_private.hermes_cancel_social_schedule(
  p_request_id uuid,
  p_request_fingerprint_sha256 text,
  p_schedule_id uuid,
  p_expected_epoch bigint,
  p_user_id text,
  p_company_id text,
  p_reason text,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner text;
  v_epoch bigint;
  v_schedule public.hermes_social_schedules%rowtype;
  v_replay jsonb;
  v_result jsonb;
  v_actor text := publisher_private.assert_hermes_text(p_actor, 'actor', 128);
  v_reason text := publisher_private.assert_hermes_text(p_reason, 'cancellation reason', 512);
begin
  select * into v_schedule from public.hermes_social_schedules s
  where s.id = p_schedule_id and s.user_id = p_user_id and s.company_id = p_company_id;
  if not found then raise exception 'Hermes schedule not found' using errcode = 'P0002'; end if;

  v_replay := publisher_private.hermes_reserve_request(
    p_request_id, 'cancel', p_request_fingerprint_sha256,
    v_schedule.user_id, p_company_id, v_actor, null);
  if v_replay is not null then return v_replay; end if;

  select owner, epoch into v_owner, v_epoch from public.publisher_queue_ownership
  where source = v_schedule.source for update;
  if v_owner is distinct from 'replacement' or v_epoch is distinct from p_expected_epoch
    or v_schedule.ownership_epoch <> v_epoch then
    raise exception 'Hermes ownership mismatch' using errcode = '40001';
  end if;

  select * into v_schedule from public.hermes_social_schedules s
  where s.id = p_schedule_id and s.user_id = p_user_id and s.company_id = p_company_id for update;
  if v_schedule.state <> 'active' then
    raise exception 'Hermes schedule is not active' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.publisher_deliveries d
    where d.content_item_id = v_schedule.target_content_item_id
      and (d.state in ('leased', 'verification_required') or d.lease_token is not null
        or d.lease_phase = 'dispatch_started')
  ) then raise exception 'schedule has a live lease or ambiguous dispatch' using errcode = '55000'; end if;
  if not exists (
    select 1 from public.publisher_deliveries d
    where d.content_item_id = v_schedule.target_content_item_id
      and d.state in ('pending', 'retryable')
  ) then raise exception 'schedule has no cancellable deliveries' using errcode = '55000'; end if;

  update public.publisher_deliveries
  set state = 'cancelled', next_attempt_at = null,
      last_error = 'Cancelled through Hermes bridge', updated_at = statement_timestamp()
  where content_item_id = v_schedule.target_content_item_id
    and state in ('pending', 'retryable');
  update public.hermes_social_schedules
  set state = 'cancelled', cancelled_at = statement_timestamp(),
      cancellation_reason = v_reason, updated_at = statement_timestamp()
  where id = p_schedule_id;

  insert into public.publisher_audit_log (
    user_id, company_id, content_item_id, event_type, actor, details
  ) values (
    v_schedule.user_id, v_schedule.company_id, v_schedule.target_content_item_id,
    'hermes_schedule_cancelled', v_actor,
    jsonb_build_object('schedule_id', p_schedule_id, 'reason', v_reason,
      'request_id', p_request_id, 'request_fingerprint_sha256', p_request_fingerprint_sha256)
  );
  v_result := publisher_private.hermes_schedule_result(p_schedule_id, p_user_id, p_company_id)
    || jsonb_build_object('replayed', false);
  update public.hermes_social_schedule_requests set schedule_id = p_schedule_id, response = v_result
  where request_id = p_request_id;
  return v_result;
end;
$$;

create or replace function publisher_private.hermes_restore_social_schedule(
  p_request_id uuid,
  p_request_fingerprint_sha256 text,
  p_schedule_id uuid,
  p_expected_epoch bigint,
  p_user_id text,
  p_company_id text,
  p_scheduled_at timestamptz,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner text;
  v_epoch bigint;
  v_schedule public.hermes_social_schedules%rowtype;
  v_replay jsonb;
  v_result jsonb;
  v_actor text := publisher_private.assert_hermes_text(p_actor, 'actor', 128);
begin
  select * into v_schedule from public.hermes_social_schedules s
  where s.id = p_schedule_id and s.user_id = p_user_id and s.company_id = p_company_id;
  if not found then raise exception 'Hermes schedule not found' using errcode = 'P0002'; end if;

  v_replay := publisher_private.hermes_reserve_request(
    p_request_id, 'restore', p_request_fingerprint_sha256,
    v_schedule.user_id, p_company_id, v_actor, null);
  if v_replay is not null then return v_replay; end if;

  if p_scheduled_at is null or p_scheduled_at <= statement_timestamp() then
    raise exception 'restore schedule must be in the future' using errcode = '22023';
  end if;

  select owner, epoch into v_owner, v_epoch from public.publisher_queue_ownership
  where source = v_schedule.source for update;
  if v_owner is distinct from 'replacement' or v_epoch is distinct from p_expected_epoch
    or v_schedule.ownership_epoch <> v_epoch then
    raise exception 'Hermes ownership mismatch' using errcode = '40001';
  end if;

  select * into v_schedule from public.hermes_social_schedules s
  where s.id = p_schedule_id and s.user_id = p_user_id and s.company_id = p_company_id for update;
  if v_schedule.state <> 'cancelled' then
    raise exception 'Hermes schedule is not cancelled' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.publisher_deliveries d
    where d.content_item_id = v_schedule.target_content_item_id
      and (d.state in ('leased', 'verification_required') or d.lease_token is not null
        or d.lease_phase = 'dispatch_started')
  ) then raise exception 'schedule has a live lease or ambiguous dispatch' using errcode = '55000'; end if;
  if not exists (
    select 1 from public.publisher_deliveries d
    where d.content_item_id = v_schedule.target_content_item_id and d.state = 'cancelled'
  ) then raise exception 'schedule has no restorable deliveries' using errcode = '55000'; end if;

  update public.publisher_content_items set scheduled_at = p_scheduled_at,
    updated_at = statement_timestamp() where id = v_schedule.target_content_item_id;
  update public.publisher_deliveries set state = 'pending', next_attempt_at = p_scheduled_at,
    last_error = null, updated_at = statement_timestamp()
  where content_item_id = v_schedule.target_content_item_id and state = 'cancelled';
  update public.hermes_social_schedules set state = 'active', scheduled_at = p_scheduled_at,
    cancelled_at = null, cancellation_reason = null, updated_at = statement_timestamp()
  where id = p_schedule_id;

  insert into public.publisher_audit_log (
    user_id, company_id, content_item_id, event_type, actor, details
  ) values (
    v_schedule.user_id, v_schedule.company_id, v_schedule.target_content_item_id,
    'hermes_schedule_restored', v_actor,
    jsonb_build_object('schedule_id', p_schedule_id, 'scheduled_at', p_scheduled_at,
      'request_id', p_request_id, 'request_fingerprint_sha256', p_request_fingerprint_sha256)
  );
  v_result := publisher_private.hermes_schedule_result(p_schedule_id, p_user_id, p_company_id)
    || jsonb_build_object('replayed', false);
  update public.hermes_social_schedule_requests set schedule_id = p_schedule_id, response = v_result
  where request_id = p_request_id;
  return v_result;
end;
$$;

-- Narrow Data API wrappers. The caller check is inherited from the publisher
-- base migration and only service_role receives EXECUTE.
create or replace function public.hermes_preview_legacy_social_schedule(p_user_id text,p_company_id text,p_legacy_spp_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin perform publisher_private.assert_service_caller(); return publisher_private.hermes_preview_legacy_social_schedule(p_user_id,p_company_id,p_legacy_spp_id); end $$;

create or replace function public.hermes_get_social_schedule(p_schedule_id uuid,p_user_id text,p_company_id text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin perform publisher_private.assert_service_caller(); return publisher_private.hermes_get_social_schedule(p_schedule_id,p_user_id,p_company_id); end $$;

create or replace function public.hermes_adopt_social_schedule(p_request_id uuid,p_request_fingerprint_sha256 text,p_expected_epoch bigint,p_user_id text,p_company_id text,p_legacy_spp_id uuid,p_scheduled_at timestamptz,p_approval_reference text,p_expected_content_sha256 text,p_actor text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin perform publisher_private.assert_service_caller(); return publisher_private.hermes_adopt_social_schedule(p_request_id,p_request_fingerprint_sha256,p_expected_epoch,p_user_id,p_company_id,p_legacy_spp_id,p_scheduled_at,p_approval_reference,p_expected_content_sha256,p_actor); end $$;

create or replace function public.hermes_cancel_social_schedule(p_request_id uuid,p_request_fingerprint_sha256 text,p_schedule_id uuid,p_expected_epoch bigint,p_user_id text,p_company_id text,p_reason text,p_actor text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin perform publisher_private.assert_service_caller(); return publisher_private.hermes_cancel_social_schedule(p_request_id,p_request_fingerprint_sha256,p_schedule_id,p_expected_epoch,p_user_id,p_company_id,p_reason,p_actor); end $$;

create or replace function public.hermes_restore_social_schedule(p_request_id uuid,p_request_fingerprint_sha256 text,p_schedule_id uuid,p_expected_epoch bigint,p_user_id text,p_company_id text,p_scheduled_at timestamptz,p_actor text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin perform publisher_private.assert_service_caller(); return publisher_private.hermes_restore_social_schedule(p_request_id,p_request_fingerprint_sha256,p_schedule_id,p_expected_epoch,p_user_id,p_company_id,p_scheduled_at,p_actor); end $$;

revoke all on function public.hermes_preview_legacy_social_schedule(text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.hermes_get_social_schedule(uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.hermes_adopt_social_schedule(uuid,text,bigint,text,text,uuid,timestamptz,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.hermes_cancel_social_schedule(uuid,text,uuid,bigint,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.hermes_restore_social_schedule(uuid,text,uuid,bigint,text,text,timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function public.hermes_preview_legacy_social_schedule(text,text,uuid) to service_role;
grant execute on function public.hermes_get_social_schedule(uuid,text,text) to service_role;
grant execute on function public.hermes_adopt_social_schedule(uuid,text,bigint,text,text,uuid,timestamptz,text,text,text) to service_role;
grant execute on function public.hermes_cancel_social_schedule(uuid,text,uuid,bigint,text,text,text,text) to service_role;
grant execute on function public.hermes_restore_social_schedule(uuid,text,uuid,bigint,text,text,timestamptz,text) to service_role;

revoke all on all functions in schema publisher_private from public,anon,authenticated,service_role;
grant usage on schema publisher_private to service_role;
grant execute on all functions in schema publisher_private to service_role;
