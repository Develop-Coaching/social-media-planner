-- Issue #37: make YouTube the safe default for new reels and provide a
-- tenant-bound, two-phase workflow for an exact reviewed historical list.
-- This migration never rewrites legacy_payload or ingestion_envelope.

create table public.publisher_youtube_backfill_approvals (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  company_id text not null,
  content_item_ids uuid[] not null,
  snapshot jsonb not null,
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  release_at timestamptz not null,
  spacing_minutes integer not null check (spacing_minutes >= 1440),
  actor text not null,
  state text not null default 'previewed' check (state in ('previewed','applied')),
  expires_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  applied_at timestamptz,
  foreign key (user_id, company_id) references public.companies(user_id, id) on delete restrict,
  constraint publisher_youtube_backfill_approval_state check (
    (state = 'previewed' and applied_at is null) or (state = 'applied' and applied_at is not null)
  )
);

alter table public.publisher_youtube_backfill_approvals enable row level security;
revoke all on table public.publisher_youtube_backfill_approvals from public,anon,authenticated,service_role;

create or replace function publisher_private.youtube_schedule_conflicts(
  p_times timestamptz[],
  p_exclude_content_item_ids uuid[] default array[]::uuid[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from unnest(p_times) proposed(at)
    join public.publisher_deliveries d
      on d.platform='youtube' and d.state in ('pending','retryable','leased')
    join public.publisher_content_items ci on ci.id=d.content_item_id
    where d.content_item_id<>all(coalesce(p_exclude_content_item_ids,array[]::uuid[]))
      and abs(extract(epoch from (coalesce(d.next_attempt_at,ci.scheduled_at)-proposed.at))) < 86400
  )
$$;

create or replace function public.enforce_youtube_planned_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz;
begin
  if new.platform='youtube' and new.state='pending'
    and (tg_op='INSERT' or old.state is distinct from 'pending' or old.next_attempt_at is distinct from new.next_attempt_at) then
    select coalesce(new.next_attempt_at,ci.scheduled_at) into v_at
    from public.publisher_content_items ci where ci.id=new.content_item_id;
    if v_at is null then
      raise exception 'YouTube pending delivery requires a planned schedule' using errcode='23514';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('publisher:youtube:quota-schedule',0));
    if publisher_private.youtube_schedule_conflicts(array[v_at],array[new.content_item_id]) then
      raise exception 'YouTube quota schedule overlaps an existing nonterminal delivery' using errcode='55000';
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_youtube_planned_schedule
before insert or update on public.publisher_deliveries
for each row execute function public.enforce_youtube_planned_schedule();

create or replace function publisher_private.youtube_backfill_snapshot(
  p_user_id text,
  p_company_id text,
  p_content_item_ids uuid[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_snapshot jsonb;
  v_count integer;
begin
  if nullif(btrim(p_user_id), '') is null or nullif(btrim(p_company_id), '') is null
    or coalesce(array_length(p_content_item_ids, 1), 0) < 1
    or array_length(p_content_item_ids, 1) > 25
    or exists (
      select 1 from unnest(p_content_item_ids) id group by id having count(*) > 1
    ) then
    raise exception 'backfill requires a non-empty exact list of unique IDs' using errcode = '22023';
  end if;

  select count(*)::integer into v_count
  from public.publisher_content_items ci
  where ci.user_id = p_user_id and ci.company_id = p_company_id
    and ci.id = any(p_content_item_ids);
  if v_count <> array_length(p_content_item_ids, 1) then
    raise exception 'exact backfill list is not owned by the requested tenant' using errcode = 'P0002';
  end if;

  select count(*)::integer into v_count
  from public.publisher_content_items ci
  where ci.user_id = p_user_id and ci.company_id = p_company_id
    and ci.id = any(p_content_item_ids)
    and ci.content_type in ('reel','video')
    and ci.approval_state = 'approved'
    and ci.publishability = 'publishable'
    and ci.media_state = 'ready' and ci.content_state = 'ready'
    and ci.migration_state in ('historical','active','native')
    and (
      nullif(btrim(ci.media->>'video_url'), '') is not null
      or (jsonb_typeof(ci.media->'upload_paths') = 'array' and jsonb_array_length(ci.media->'upload_paths') > 0)
    )
    and exists (
      select 1 from public.publisher_deliveries succeeded
      where succeeded.content_item_id = ci.id
        and succeeded.platform in ('instagram','facebook','linkedin')
        and succeeded.state = 'succeeded'
    )
    and not exists (
      select 1 from public.publisher_deliveries rejected
      where rejected.content_item_id = ci.id
        and (rejected.platform = 'youtube' or rejected.state in (
          'cancelled','blocked_content','blocked_media','pending','retryable','leased'
        ))
    );
  if v_count <> array_length(p_content_item_ids, 1) then
    raise exception 'exact backfill list contains an ineligible, cancelled, blocked, non-reel, non-video, or duplicate item'
      using errcode = '55000';
  end if;

  select jsonb_agg(jsonb_build_object(
      'legacy_spp_id', ci.legacy_spp_id,
      'content_item_id', ci.id,
      'lifecycle_version', ci.lifecycle_version,
      'migration_state', ci.migration_state,
      'legacy_payload_sha256', ci.legacy_payload_sha256,
      'media_sha256', encode(extensions.digest(ci.media::text, 'sha256'), 'hex'),
      'succeeded_deliveries', (
        select jsonb_agg(jsonb_build_object(
          'platform', d.platform, 'delivery_id', d.id, 'platform_post_id', d.platform_post_id
        ) order by d.platform)
        from public.publisher_deliveries d
        where d.content_item_id = ci.id
          and d.platform in ('instagram','facebook','linkedin') and d.state = 'succeeded'
      )
    ) order by requested.ordinality)
  into v_snapshot
  from unnest(p_content_item_ids) with ordinality requested(content_item_id, ordinality)
  join public.publisher_content_items ci
    on ci.id = requested.content_item_id
   and ci.user_id = p_user_id and ci.company_id = p_company_id;

  return v_snapshot;
end;
$$;

create or replace function publisher_private.preview_youtube_backfill(
  p_user_id text,
  p_company_id text,
  p_content_item_ids uuid[],
  p_release_at timestamptz,
  p_spacing_minutes integer,
  p_actor text,
  p_valid_for_minutes integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snapshot jsonb;
  v_manifest text;
  v_approval public.publisher_youtube_backfill_approvals%rowtype;
begin
  if p_release_at is null or p_release_at < statement_timestamp() + interval '5 minutes'
    or p_spacing_minutes < 1440 or p_spacing_minutes > 10080
    or p_valid_for_minutes < 5 or p_valid_for_minutes > 60
    or nullif(btrim(p_actor), '') is null or length(p_actor) > 200 then
    raise exception 'invalid backfill release, spacing, approval lifetime, or actor' using errcode = '22023';
  end if;

  v_snapshot := publisher_private.youtube_backfill_snapshot(p_user_id, p_company_id, p_content_item_ids);
  v_manifest := encode(extensions.digest(jsonb_build_object(
    'user_id', p_user_id,
    'company_id', p_company_id,
    'snapshot', v_snapshot,
    'release_at', to_jsonb(p_release_at),
    'spacing_minutes', p_spacing_minutes
  )::text, 'sha256'), 'hex');

  insert into public.publisher_youtube_backfill_approvals(
    user_id,company_id,content_item_ids,snapshot,manifest_sha256,release_at,spacing_minutes,actor,expires_at
  ) values (
    p_user_id,p_company_id,p_content_item_ids,v_snapshot,v_manifest,p_release_at,p_spacing_minutes,btrim(p_actor),
    statement_timestamp() + make_interval(mins => p_valid_for_minutes)
  ) returning * into v_approval;

  insert into public.publisher_audit_log(user_id,company_id,event_type,actor,details)
  values (p_user_id,p_company_id,'youtube_backfill_previewed',btrim(p_actor),jsonb_build_object(
    'approval_id',v_approval.id,'manifest_sha256',v_manifest,'content_item_ids',p_content_item_ids,
    'release_at',p_release_at,'spacing_minutes',p_spacing_minutes,'expires_at',v_approval.expires_at
  ));

  return jsonb_build_object(
    'approval_id',v_approval.id,'manifest_sha256',v_manifest,'expires_at',v_approval.expires_at,
    'release_at',p_release_at,'spacing_minutes',p_spacing_minutes,'candidates',v_snapshot
  );
end;
$$;

create or replace function publisher_private.apply_youtube_backfill(
  p_approval_id uuid,
  p_manifest_sha256 text,
  p_user_id text,
  p_company_id text,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_approval public.publisher_youtube_backfill_approvals%rowtype;
  v_current_snapshot jsonb;
  v_inserted jsonb;
begin
  if p_approval_id is null or p_manifest_sha256 !~ '^[0-9a-f]{64}$'
    or nullif(btrim(p_actor), '') is null or length(p_actor) > 200 then
    raise exception 'invalid backfill approval proof or actor' using errcode = '22023';
  end if;

  select * into v_approval from public.publisher_youtube_backfill_approvals
  where id = p_approval_id and user_id = p_user_id and company_id = p_company_id for update;
  if not found then raise exception 'backfill approval not found' using errcode = 'P0002'; end if;
  if v_approval.state <> 'previewed' then
    raise exception 'backfill approval was already applied' using errcode = '55000';
  end if;
  if v_approval.expires_at <= statement_timestamp() then
    raise exception 'backfill approval expired' using errcode = '55000';
  end if;
  if v_approval.manifest_sha256 <> p_manifest_sha256 then
    raise exception 'backfill approval manifest mismatch' using errcode = '55000';
  end if;

  perform 1 from public.publisher_content_items ci
  where ci.user_id=v_approval.user_id and ci.company_id=v_approval.company_id
    and ci.id=any(v_approval.content_item_ids)
  order by ci.id for update;

  v_current_snapshot := publisher_private.youtube_backfill_snapshot(
    v_approval.user_id,v_approval.company_id,v_approval.content_item_ids
  );
  if v_current_snapshot is distinct from v_approval.snapshot then
    raise exception 'backfill approval is stale; preview again' using errcode = '40001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('publisher:youtube:quota-schedule',0));
  if publisher_private.youtube_schedule_conflicts(array(
    select v_approval.release_at + make_interval(mins => ((ordinality-1)*v_approval.spacing_minutes)::integer)
    from generate_subscripts(v_approval.content_item_ids,1) as s(ordinality)
  )) then
    raise exception 'YouTube quota schedule overlaps an existing nonterminal delivery' using errcode = '55000';
  end if;

  update public.publisher_content_items ci set migration_state='active',updated_at=statement_timestamp()
  where ci.user_id=v_approval.user_id and ci.company_id=v_approval.company_id
    and ci.id=any(v_approval.content_item_ids) and ci.migration_state='historical';

  with inserted as (
    insert into public.publisher_deliveries(content_item_id,platform,state,idempotency_key,next_attempt_at)
    select ci.id,'youtube','pending','youtube-backfill:'||ci.id::text,
      v_approval.release_at + make_interval(mins => ((requested.ordinality - 1) * v_approval.spacing_minutes)::integer)
    from unnest(v_approval.content_item_ids) with ordinality requested(content_item_id,ordinality)
    join public.publisher_content_items ci on ci.id=requested.content_item_id
      and ci.user_id=v_approval.user_id and ci.company_id=v_approval.company_id
    returning id,content_item_id,next_attempt_at
  )
  select jsonb_agg(jsonb_build_object(
    'delivery_id',id,'content_item_id',content_item_id,'next_attempt_at',next_attempt_at
  ) order by next_attempt_at) into v_inserted from inserted;

  insert into public.publisher_audit_log(user_id,company_id,content_item_id,delivery_id,event_type,actor,details)
  select v_approval.user_id,v_approval.company_id,d.content_item_id,d.id,'youtube_backfill_queued',btrim(p_actor),
    jsonb_build_object('approval_id',v_approval.id,'manifest_sha256',v_approval.manifest_sha256,
      'content_item_id',ci.id,'legacy_spp_id',ci.legacy_spp_id,'next_attempt_at',d.next_attempt_at,
      'reconciliation','worker checkpoints deterministic dcsrc tag before dispatch')
  from public.publisher_deliveries d
  join public.publisher_content_items ci on ci.id=d.content_item_id
  where d.platform='youtube' and d.idempotency_key like 'youtube-backfill:%'
    and ci.user_id=v_approval.user_id and ci.company_id=v_approval.company_id
    and ci.id=any(v_approval.content_item_ids);

  update public.publisher_youtube_backfill_approvals
  set state='applied',applied_at=statement_timestamp() where id=v_approval.id;
  insert into public.publisher_audit_log(user_id,company_id,event_type,actor,details)
  values (v_approval.user_id,v_approval.company_id,'youtube_backfill_applied',btrim(p_actor),
    jsonb_build_object('approval_id',v_approval.id,'manifest_sha256',v_approval.manifest_sha256,
      'delivery_count',jsonb_array_length(v_inserted)));

  return jsonb_build_object('approval_id',v_approval.id,'manifest_sha256',v_approval.manifest_sha256,
    'deliveries',v_inserted);
end;
$$;

create or replace function public.ingest_native_publisher_content(
  p_user_id text, p_company_id text, p_source_system text, p_source_id text,
  p_content_type text, p_caption text, p_media jsonb, p_scheduled_at timestamptz,
  p_platforms text[], p_media_state text, p_media_block_reason text default null,
  p_content_state text default 'ready', p_content_block_reason text default null,
  p_source_metadata jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_content_type text := lower(btrim(p_content_type));
  v_platforms text[];
  v_requested_platforms text[];
  v_existing_platforms text[];
  v_existing_content_item_id uuid;
begin
  perform publisher_private.assert_service_caller();
  if 'youtube' = any(coalesce(p_platforms,array[]::text[])) and v_content_type not in ('reel','video') then
    raise exception 'YouTube is only valid for reel or video content' using errcode = '22023';
  end if;
  select array_agg(distinct lower(btrim(platform)) order by lower(btrim(platform))) into v_requested_platforms
  from unnest(coalesce(p_platforms,array[]::text[])) platform;

  -- Take the global schedule lock before reading replay identity. A concurrent
  -- identical ingest must observe the winner and exclude its own slot.
  if v_content_type='reel' or 'youtube'=any(coalesce(v_requested_platforms,array[]::text[])) then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      p_user_id||chr(31)||p_company_id||chr(31)||lower(btrim(p_source_system))||chr(31)||btrim(p_source_id),0
    ));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('publisher:youtube:quota-schedule',0));
  end if;

  select ci.id into v_existing_content_item_id
  from public.publisher_content_items ci
  where ci.user_id=p_user_id and ci.company_id=p_company_id
    and ci.source_system=lower(btrim(p_source_system)) and ci.source_id=btrim(p_source_id);

  -- An old native reel may have an immutable envelope created before YouTube
  -- became the default. Preserve an exact omitted-YouTube replay; all new reels
  -- and reels whose stored envelope already includes YouTube get the default.
  if v_content_type='reel' and not ('youtube'=any(coalesce(v_requested_platforms,array[]::text[]))) then
    select array_agg(value #>> '{}' order by value #>> '{}') into v_existing_platforms
    from public.publisher_content_items ci,
      jsonb_array_elements(coalesce(ci.ingestion_envelope->'platforms','[]'::jsonb)) value
    where ci.user_id=p_user_id and ci.company_id=p_company_id
      and ci.source_system=lower(btrim(p_source_system)) and ci.source_id=btrim(p_source_id)
    group by ci.id;
  end if;
  if v_content_type='reel' and v_existing_platforms is distinct from v_requested_platforms then
    v_platforms := array(select distinct platform from unnest(v_requested_platforms || array['youtube']) platform order by platform);
  else
    v_platforms := v_requested_platforms;
  end if;
  if 'youtube'=any(coalesce(v_platforms,array[]::text[])) and p_media_state='ready' and p_content_state='ready' then
    if publisher_private.youtube_schedule_conflicts(
      array[p_scheduled_at],
      case when v_existing_content_item_id is null then array[]::uuid[] else array[v_existing_content_item_id] end
    ) then
      raise exception 'YouTube quota schedule overlaps an existing nonterminal delivery' using errcode = '55000';
    end if;
  end if;
  return publisher_private.ingest_native_publisher_content(p_user_id,p_company_id,p_source_system,p_source_id,
    p_content_type,p_caption,p_media,p_scheduled_at,v_platforms,p_media_state,p_media_block_reason,
    p_content_state,p_content_block_reason,p_source_metadata);
end;
$$;

create or replace function public.preview_youtube_backfill(
  p_user_id text,p_company_id text,p_content_item_ids uuid[],p_release_at timestamptz,
  p_spacing_minutes integer,p_actor text,p_valid_for_minutes integer default 30
)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform publisher_private.assert_service_caller();
  return publisher_private.preview_youtube_backfill(p_user_id,p_company_id,p_content_item_ids,
    p_release_at,p_spacing_minutes,p_actor,p_valid_for_minutes);
end $$;

create or replace function public.apply_youtube_backfill(
  p_approval_id uuid,p_manifest_sha256 text,p_user_id text,p_company_id text,p_actor text
)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform publisher_private.assert_service_caller();
  return publisher_private.apply_youtube_backfill(p_approval_id,p_manifest_sha256,p_user_id,p_company_id,p_actor);
end $$;

revoke all on function public.preview_youtube_backfill(text,text,uuid[],timestamptz,integer,text,integer) from public,anon,authenticated,service_role;
revoke all on function public.apply_youtube_backfill(uuid,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.enforce_youtube_planned_schedule() from public,anon,authenticated,service_role;
grant execute on function public.preview_youtube_backfill(text,text,uuid[],timestamptz,integer,text,integer) to service_role;
grant execute on function public.apply_youtube_backfill(uuid,text,text,text,text) to service_role;
revoke all on function publisher_private.youtube_backfill_snapshot(text,text,uuid[]) from public,anon,authenticated,service_role;
revoke all on function publisher_private.youtube_schedule_conflicts(timestamptz[],uuid[]) from public,anon,authenticated,service_role;
revoke all on function publisher_private.preview_youtube_backfill(text,text,uuid[],timestamptz,integer,text,integer) from public,anon,authenticated,service_role;
revoke all on function publisher_private.apply_youtube_backfill(uuid,text,text,text,text) from public,anon,authenticated,service_role;
-- Native ingestion is exposed only through the compatibility-aware public
-- wrapper above; service callers must not bypass reel defaulting.
revoke execute on function publisher_private.ingest_native_publisher_content(text,text,text,text,text,text,jsonb,timestamptz,text[],text,text,text,text,jsonb) from service_role;
