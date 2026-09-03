-- Narrow, migration-safe publisher queue (issue #16).
--
-- This is deliberately additive. The legacy scheduled_posts table remains the
-- source of truth until transfer_publisher_queue_ownership() commits. Both old
-- and replacement claim functions serialize on publisher_queue_ownership so
-- there is no interval in which both schedulers may claim a legacy job.

do $$
declare
  v_missing text;
begin
  select string_agg(required.column_name, ', ' order by required.column_name)
  into v_missing
  from (values
    ('id'), ('user_id'), ('company_id'), ('saved_content_id'), ('item_id'),
    ('content_type'), ('caption'), ('image_keys'), ('media_urls'), ('video_url'),
    ('platforms'), ('scheduled_at'), ('status'), ('platform_post_ids'), ('error'),
    ('retry_count'), ('created_at'), ('updated_at'), ('published_at'),
    ('upload_paths'), ('cover_path')
  ) as required(column_name)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'scheduled_posts'
      and c.column_name = required.column_name
  );
  if to_regclass('public.companies') is null or to_regclass('public.scheduled_posts') is null or v_missing is not null then
    raise exception 'publisher migration preflight failed; missing legacy schema columns: %', coalesce(v_missing, '(table missing)')
      using errcode = '55000';
  end if;
end;
$$;

create extension if not exists pgcrypto with schema extensions;

create schema if not exists publisher_private;
revoke all on schema publisher_private from public, anon, authenticated, service_role;

create or replace function publisher_private.assert_service_caller()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if session_user <> 'postgres'
    and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
    and coalesce(current_setting('role', true), '') <> 'service_role' then
    raise exception 'publisher RPC requires service_role' using errcode = '42501';
  end if;
end;
$$;

create table public.publisher_queue_ownership (
  source text primary key,
  owner text not null check (owner in ('legacy', 'replacement')),
  epoch bigint not null check (epoch > 0),
  cutoff_at timestamptz,
  reconciliation_sha256 text,
  transferred_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint publisher_queue_ownership_transfer_fields check (
    (owner = 'legacy' and cutoff_at is null and transferred_at is null
      and (reconciliation_sha256 is null or reconciliation_sha256 ~ '^[0-9a-f]{64}$'))
    or
    (owner = 'replacement' and cutoff_at is not null and reconciliation_sha256 ~ '^[0-9a-f]{64}$' and transferred_at is not null)
  )
);

insert into public.publisher_queue_ownership (source, owner, epoch)
values ('legacy_spp', 'legacy', 1);

create table public.publisher_content_items (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  company_id text not null,
  legacy_spp_id uuid unique,
  item_id text,
  content_type text not null,
  caption text not null default '',
  media jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz,
  approval_state text not null default 'draft'
    check (approval_state in ('draft', 'approved')),
  publishability text not null default 'publishable'
    check (publishability in ('publishable', 'planning_only')),
  migration_state text not null default 'native'
    check (migration_state in ('native', 'migration_frozen', 'active', 'historical')),
  legacy_status text,
  legacy_payload jsonb,
  legacy_payload_sha256 text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (user_id, company_id)
    references public.companies(user_id, id) on delete restrict,
  constraint publisher_content_items_legacy_pair check (
    (legacy_spp_id is null and legacy_payload is null and legacy_payload_sha256 is null)
    or
    (legacy_spp_id is not null and legacy_payload is not null and legacy_payload_sha256 ~ '^[0-9a-f]{64}$')
  ),
  constraint publisher_content_items_planning_only check (
    publishability <> 'planning_only' or content_type = 'article'
  ),
  constraint publisher_content_items_legacy_projection check (
    legacy_spp_id is null or (
      legacy_spp_id = (legacy_payload->>'id')::uuid
      and user_id = legacy_payload->>'user_id'
      and company_id = legacy_payload->>'company_id'
      and content_type = lower(legacy_payload->>'content_type')
      and caption = coalesce(legacy_payload->>'caption', '')
      and scheduled_at = (legacy_payload->>'scheduled_at')::timestamptz
      and legacy_status = legacy_payload->>'status'
      and publishability = case when lower(legacy_payload->>'content_type') = 'article'
        then 'planning_only' else 'publishable' end
    )
  )
);

create index publisher_content_items_tenant_schedule_idx
  on public.publisher_content_items (user_id, company_id, scheduled_at);
create index publisher_content_items_migration_idx
  on public.publisher_content_items (migration_state, scheduled_at)
  where migration_state = 'migration_frozen';

create table public.publisher_deliveries (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.publisher_content_items(id) on delete restrict,
  platform text not null check (platform in ('instagram', 'facebook', 'linkedin')),
  state text not null default 'pending' check (state in (
    'migration_frozen', 'planning_only', 'pending', 'leased', 'retryable',
    'verification_required', 'succeeded', 'dead_letter', 'cancelled', 'historical'
  )),
  idempotency_key text not null unique,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts > 0),
  next_attempt_at timestamptz,
  lease_token uuid,
  lease_expires_at timestamptz,
  lease_phase text check (lease_phase in ('pre_dispatch', 'dispatch_started')),
  platform_post_id text,
  provider_reconciliation_metadata jsonb not null default '{}'::jsonb,
  live_url text,
  last_error text,
  published_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (content_item_id, platform),
  constraint publisher_deliveries_lease_shape check (
    (state = 'leased' and lease_token is not null and lease_expires_at is not null and lease_phase is not null)
    or
    (state <> 'leased' and lease_token is null and lease_expires_at is null and lease_phase is null)
  ),
  constraint publisher_deliveries_planning_only check (
    state <> 'planning_only' or platform = 'linkedin'
  ),
  constraint publisher_deliveries_success_shape check (
    state <> 'succeeded'
    or (nullif(btrim(platform_post_id), '') is not null and published_at is not null)
  )
);

create index publisher_deliveries_claim_idx
  on public.publisher_deliveries (state, next_attempt_at, id)
  where state in ('pending', 'retryable');
create index publisher_deliveries_item_idx
  on public.publisher_deliveries (content_item_id);

create table public.publisher_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.publisher_deliveries(id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  idempotency_key text not null unique,
  lease_token uuid not null unique,
  state text not null check (state in (
    'claimed', 'dispatch_started', 'succeeded', 'retryable',
    'verification_required', 'dead_letter'
  )),
  request_fingerprint_sha256 text,
  provider_response jsonb,
  error text,
  claimed_at timestamptz not null default statement_timestamp(),
  dispatch_started_at timestamptz,
  finished_at timestamptz,
  unique (delivery_id, attempt_number)
);

create index publisher_delivery_attempts_delivery_idx
  on public.publisher_delivery_attempts (delivery_id, attempt_number desc);

create table public.publisher_audit_log (
  id bigint generated always as identity primary key,
  user_id text,
  company_id text,
  content_item_id uuid references public.publisher_content_items(id) on delete restrict,
  delivery_id uuid references public.publisher_deliveries(id) on delete restrict,
  event_type text not null,
  actor text not null,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default statement_timestamp()
);

create index publisher_audit_log_tenant_time_idx
  on public.publisher_audit_log (user_id, company_id, occurred_at desc);
create index publisher_audit_log_delivery_time_idx
  on public.publisher_audit_log (delivery_id, occurred_at desc);

alter table public.scheduled_posts
  add column publisher_lease_token uuid,
  add column publisher_lease_expires_at timestamptz,
  add column publisher_lease_phase text,
  add column publisher_ownership_epoch bigint,
  add column publisher_claim_count integer not null default 0,
  add column publisher_verification_required boolean not null default false;

alter table public.scheduled_posts
  add constraint scheduled_posts_publisher_lease_phase_check
    check (publisher_lease_phase in ('pre_dispatch', 'dispatch_started')),
  add constraint scheduled_posts_publisher_claim_count_check
    check (publisher_claim_count >= 0),
  add constraint scheduled_posts_publisher_lease_shape_check check (
    (publisher_lease_token is null and publisher_lease_expires_at is null and publisher_lease_phase is null)
    or
    (publisher_lease_token is not null and publisher_lease_expires_at is not null and publisher_lease_phase is not null)
  );

create index scheduled_posts_publisher_lease_idx
  on public.scheduled_posts (publisher_lease_expires_at)
  where status = 'publishing';

create or replace function public.guard_legacy_spp_claim_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'queued' and new.status = 'publishing'
    and coalesce(current_setting('publisher.legacy_claim_rpc', true), '') <> 'enabled' then
    raise exception 'legacy queued posts must be claimed through claim_legacy_spp_posts'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger guard_legacy_spp_claim_transition
before update on public.scheduled_posts
for each row execute function public.guard_legacy_spp_claim_transition();

create or replace function public.protect_legacy_publisher_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
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
    or new.scheduled_at is distinct from old.scheduled_at
    or new.publishability is distinct from old.publishability
    or new.legacy_status is distinct from old.legacy_status
  ) then
    raise exception 'legacy SPP identity, payload, and publish projection are immutable'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.protect_planning_only_delivery()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.publisher_content_items ci
    where ci.id = new.content_item_id and ci.publishability = 'planning_only'
  ) and new.state <> 'planning_only' then
    raise exception 'planning-only content cannot enter the publisher queue'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger protect_planning_only_delivery
before insert or update on public.publisher_deliveries
for each row execute function public.protect_planning_only_delivery();

create or replace function public.audit_publisher_delivery_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id text;
  v_company_id text;
begin
  if tg_op = 'INSERT' or new.state is distinct from old.state or new.lease_phase is distinct from old.lease_phase
    or new.provider_reconciliation_metadata is distinct from old.provider_reconciliation_metadata then
    select ci.user_id, ci.company_id into v_user_id, v_company_id
    from public.publisher_content_items ci where ci.id = new.content_item_id;
    insert into public.publisher_audit_log (
      user_id, company_id, content_item_id, delivery_id, event_type, actor, details
    ) values (
      v_user_id, v_company_id, new.content_item_id, new.id,
      case
        when tg_op = 'INSERT' then 'delivery_created'
        when new.state is not distinct from old.state and new.lease_phase is not distinct from old.lease_phase
          and new.provider_reconciliation_metadata is distinct from old.provider_reconciliation_metadata
          then 'delivery_checkpointed'
        else 'delivery_transitioned'
      end,
      'database',
      jsonb_build_object(
        'from_state', case when tg_op = 'INSERT' then null else old.state end,
        'to_state', new.state,
        'lease_phase', new.lease_phase,
        'attempt_count', new.attempt_count,
        'provider_reconciliation_metadata_before', case when tg_op = 'INSERT' then null else old.provider_reconciliation_metadata end,
        'provider_reconciliation_metadata_after', new.provider_reconciliation_metadata
      )
    );
  end if;
  return new;
end;
$$;

create trigger audit_publisher_delivery_transition
after insert or update on public.publisher_deliveries
for each row execute function public.audit_publisher_delivery_transition();

create trigger protect_legacy_publisher_fields
before update on public.publisher_content_items
for each row execute function public.protect_legacy_publisher_fields();

create or replace function public.prevent_publisher_audit_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'publisher_audit_log is append-only' using errcode = '55000';
end;
$$;

create trigger prevent_publisher_audit_update_or_delete
before update or delete on public.publisher_audit_log
for each row execute function public.prevent_publisher_audit_mutation();

-- Idempotently imports a complete Social Post Pro export. Existing rows must be
-- byte-for-byte equivalent as parsed JSON or the import aborts; it never
-- overwrites migrated content or runtime state.
create or replace function publisher_private.import_legacy_spp_rows(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record jsonb;
  v_content_id uuid;
  v_existing_payload jsonb;
  v_platform text;
  v_delivery_state text;
  v_inserted integer := 0;
  v_unchanged integer := 0;
  v_delivery_count integer := 0;
  v_status text;
  v_content_type text;
  v_legacy_id uuid;
  v_supplied_payload_sha256 text;
  v_platform_post_id text;
  v_platform_id_class text;
  v_ig_container_id text;
  v_ig_container_since text;
  v_reconciliation_metadata jsonb;
  v_attestation text;
  v_expected_deliveries integer;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) <> 67
    or (select count(*) from jsonb_array_elements(p_rows) r where r->>'status' = 'queued') <> 21
    or (select count(*) from jsonb_array_elements(p_rows) r where r->>'status' <> 'queued') <> 46
    or (select count(*) from jsonb_array_elements(p_rows) r where r->>'status' = 'queued' and lower(r->>'content_type') = 'article') <> 14
    or (select count(distinct r->>'id') from jsonb_array_elements(p_rows) r) <> 67
    or (select count(distinct (r->>'user_id') || chr(0) || (r->>'company_id')) from jsonb_array_elements(p_rows) r) <> 1 then
    raise exception 'legacy import must be the approved complete 67-row manifest (21 queued, 46 history, 14 queued articles, one tenant)'
      using errcode = '22023';
  end if;
  select sum(jsonb_array_length(r->'platforms')) into v_expected_deliveries
  from jsonb_array_elements(p_rows) r;

  for v_record in select value from jsonb_array_elements(p_rows)
  loop
    v_supplied_payload_sha256 := v_record->>'__migration_payload_sha256';
    v_record := v_record - '__migration_payload_sha256';
    if v_supplied_payload_sha256 is not null and v_supplied_payload_sha256 !~ '^[0-9a-f]{64}$' then
      raise exception 'invalid migration payload SHA-256' using errcode = '22023';
    end if;
    if not (v_record ?& array['id','user_id','company_id','content_type','platforms','scheduled_at','status']) then
      raise exception 'legacy row is missing required fields' using errcode = '22023';
    end if;
    if jsonb_typeof(v_record->'platforms') <> 'array' then
      raise exception 'legacy row platforms must be an array' using errcode = '22023';
    end if;

    v_legacy_id := (v_record->>'id')::uuid;
    v_status := v_record->>'status';
    v_content_type := lower(v_record->>'content_type');

    insert into public.publisher_content_items (
      user_id, company_id, legacy_spp_id, item_id, content_type, caption,
      media, scheduled_at, approval_state, publishability, migration_state,
      legacy_status, legacy_payload, legacy_payload_sha256, created_at, updated_at
    ) values (
      v_record->>'user_id',
      v_record->>'company_id',
      v_legacy_id,
      nullif(v_record->>'item_id', ''),
      v_content_type,
      coalesce(v_record->>'caption', ''),
      jsonb_build_object(
        'saved_content_id', v_record->'saved_content_id',
        'image_keys', coalesce(v_record->'image_keys', '[]'::jsonb),
        'media_urls', coalesce(v_record->'media_urls', '[]'::jsonb),
        'upload_paths', coalesce(v_record->'upload_paths', '[]'::jsonb),
        'video_url', v_record->'video_url',
        'cover_path', v_record->'cover_path'
      ),
      (v_record->>'scheduled_at')::timestamptz,
      case when v_status = 'queued' then 'approved' else 'draft' end,
      case when v_content_type = 'article' then 'planning_only' else 'publishable' end,
      case when v_status = 'queued' then 'migration_frozen' else 'historical' end,
      v_status,
      v_record,
      coalesce(v_supplied_payload_sha256, encode(extensions.digest(v_record::text, 'sha256'), 'hex')),
      coalesce((v_record->>'created_at')::timestamptz, statement_timestamp()),
      coalesce((v_record->>'updated_at')::timestamptz, statement_timestamp())
    )
    on conflict (legacy_spp_id) do nothing
    returning id into v_content_id;

    if v_content_id is null then
      select id, legacy_payload into v_content_id, v_existing_payload
      from public.publisher_content_items
      where legacy_spp_id = v_legacy_id;
      if v_existing_payload is distinct from v_record then
        raise exception 'legacy row % differs from its previous import', v_legacy_id
          using errcode = '23505';
      end if;
      v_unchanged := v_unchanged + 1;
    else
      v_inserted := v_inserted + 1;
      insert into public.publisher_audit_log (
        user_id, company_id, content_item_id, event_type, actor, details
      ) values (
        v_record->>'user_id', v_record->>'company_id', v_content_id,
        'legacy_imported', 'migration',
        jsonb_build_object('legacy_spp_id', v_legacy_id, 'legacy_status', v_status)
      );
    end if;

    for v_platform in select jsonb_array_elements_text(v_record->'platforms')
    loop
      if v_platform not in ('instagram', 'facebook', 'linkedin') then
        raise exception 'unsupported platform % for legacy row %', v_platform, v_legacy_id
          using errcode = '22023';
      end if;

      v_platform_post_id := nullif(btrim(v_record->'platform_post_ids'->>v_platform), '');
      v_ig_container_id := case when v_platform = 'instagram'
        then nullif(btrim(v_record->'platform_post_ids'->>'instagram_container'), '') else null end;
      v_ig_container_since := case when v_platform = 'instagram'
        then nullif(btrim(v_record->'platform_post_ids'->>'instagram_container_since'), '') else null end;
      v_reconciliation_metadata := case when v_platform = 'instagram'
        and (v_ig_container_id is not null or v_ig_container_since is not null)
        then jsonb_build_object(
          'instagram_container', to_jsonb(v_ig_container_id),
          'instagram_container_since', to_jsonb(v_ig_container_since)
        ) else '{}'::jsonb end;
      v_platform_id_class := case
        when v_ig_container_id is not null or v_ig_container_since is not null then 'ambiguous'
        when v_platform_post_id is not null
          and lower(v_platform_post_id) !~ '^(pending|unknown|failed|error|processing|publishing|queued|n/a|null|none|sent)$' then 'durable'
        when v_platform_post_id is not null then 'ambiguous'
        when v_platform_post_id is null then 'empty'
        else 'durable'
      end;

      v_delivery_state := case
        when v_status = 'queued' and v_content_type = 'article' then 'planning_only'
        when v_status = 'queued' and v_platform_id_class = 'durable' then 'succeeded'
        when v_status = 'queued' and v_platform_id_class = 'ambiguous' then 'verification_required'
        when v_status = 'queued' then 'migration_frozen'
        when v_status = 'published' and v_platform_id_class = 'durable' then 'succeeded'
        when v_status = 'published' then 'historical'
        when v_status = 'cancelled' then 'cancelled'
        when v_status = 'failed' then 'dead_letter'
        when v_status = 'publishing' then 'verification_required'
        else 'historical'
      end;

      insert into public.publisher_deliveries (
        content_item_id, platform, state, idempotency_key, attempt_count,
        next_attempt_at, platform_post_id, provider_reconciliation_metadata, published_at
      ) values (
        v_content_id,
        v_platform,
        v_delivery_state,
        'legacy-spp:' || v_legacy_id::text || ':' || v_platform,
        greatest(coalesce((v_record->>'retry_count')::integer, 0), 0),
        case when v_delivery_state = 'migration_frozen' then (v_record->>'scheduled_at')::timestamptz else null end,
        case when v_platform_id_class = 'durable' then v_platform_post_id else null end,
        v_reconciliation_metadata,
        case when v_delivery_state = 'succeeded'
          then coalesce((v_record->>'published_at')::timestamptz, (v_record->>'updated_at')::timestamptz)
          else null end
      ) on conflict (content_item_id, platform) do nothing;
      if found then
        v_delivery_count := v_delivery_count + 1;
      end if;
    end loop;
  end loop;

  if (select count(*) from public.publisher_content_items where legacy_spp_id is not null) <> 67
    or (select count(*) from public.publisher_deliveries d join public.publisher_content_items ci on ci.id = d.content_item_id where ci.legacy_spp_id is not null) <> v_expected_deliveries then
    raise exception 'legacy destination contains missing or extra content/deliveries' using errcode = '23514';
  end if;

  select encode(extensions.digest(string_agg(
    ci.legacy_spp_id::text || ':' || ci.legacy_payload_sha256 || ':' || d.platform || ':' || d.state || ':' || coalesce(d.platform_post_id, '') || ':' || coalesce(d.published_at::text,'') || ':' || d.provider_reconciliation_metadata::text,
    E'\n' order by ci.legacy_spp_id, d.platform
  ), 'sha256'), 'hex')
  into v_attestation
  from public.publisher_content_items ci
  join public.publisher_deliveries d on d.content_item_id = ci.id
  where ci.legacy_spp_id is not null;

  update public.publisher_queue_ownership
  set reconciliation_sha256 = v_attestation, updated_at = statement_timestamp()
  where source = 'legacy_spp' and owner = 'legacy';
  if not found then
    raise exception 'legacy import is closed after ownership transfer' using errcode = '55000';
  end if;

  return jsonb_build_object(
    'inserted_content_items', v_inserted,
    'unchanged_content_items', v_unchanged,
    'inserted_deliveries', v_delivery_count,
    'database_attestation_sha256', v_attestation
  );
end;
$$;

-- Legacy claimant. Issue #17 replaces the old select/update loop with this RPC.
-- Locking the ownership row makes claims mutually exclusive with cutover.
create or replace function publisher_private.claim_legacy_spp_posts(
  p_expected_epoch bigint,
  p_limit integer default 5,
  p_lease_seconds integer default 300,
  p_now timestamptz default statement_timestamp()
)
returns setof public.scheduled_posts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner text;
  v_epoch bigint;
begin
  if p_limit < 1 or p_limit > 100 or p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'invalid claim bounds' using errcode = '22023';
  end if;

  select owner, epoch into v_owner, v_epoch
  from public.publisher_queue_ownership
  where source = 'legacy_spp'
  for update;

  if v_owner <> 'legacy' or v_epoch <> p_expected_epoch then
    raise exception 'legacy ownership mismatch: owner %, epoch %', v_owner, v_epoch
      using errcode = '40001';
  end if;

  perform set_config('publisher.legacy_claim_rpc', 'enabled', true);

  return query
  with candidates as (
    select sp.id
    from public.scheduled_posts sp
    where sp.status = 'queued'
      and not sp.publisher_verification_required
      and sp.content_type <> 'article'
      and sp.scheduled_at <= p_now
    order by sp.scheduled_at, sp.id
    for update skip locked
    limit p_limit
  )
  update public.scheduled_posts sp
  set status = 'publishing',
      publisher_lease_token = gen_random_uuid(),
      publisher_lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
      publisher_lease_phase = 'pre_dispatch',
      publisher_ownership_epoch = v_epoch,
      publisher_claim_count = sp.publisher_claim_count + 1,
      updated_at = p_now
  from candidates c
  where sp.id = c.id
  returning sp.*;
end;
$$;

create or replace function publisher_private.claim_publisher_deliveries(
  p_expected_epoch bigint,
  p_limit integer default 10,
  p_lease_seconds integer default 300,
  p_now timestamptz default statement_timestamp()
)
returns table (
  delivery_id uuid,
  content_item_id uuid,
  platform text,
  idempotency_key text,
  attempt_number integer,
  lease_token uuid,
  lease_expires_at timestamptz,
  user_id text,
  company_id text,
  content_type text,
  caption text,
  media jsonb,
  scheduled_at timestamptz,
  legacy_spp_id uuid,
  provider_reconciliation_metadata jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner text;
  v_epoch bigint;
begin
  if p_limit < 1 or p_limit > 100 or p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'invalid claim bounds' using errcode = '22023';
  end if;

  select owner, epoch into v_owner, v_epoch
  from public.publisher_queue_ownership
  where source = 'legacy_spp'
  for update;

  if v_owner <> 'replacement' or v_epoch <> p_expected_epoch then
    raise exception 'replacement ownership mismatch: owner %, epoch %', v_owner, v_epoch
      using errcode = '40001';
  end if;

  return query
  with candidates as (
    select d.id
    from public.publisher_deliveries d
    join public.publisher_content_items ci on ci.id = d.content_item_id
    where d.state in ('pending', 'retryable')
      and coalesce(d.next_attempt_at, ci.scheduled_at) <= p_now
      and d.attempt_count < d.max_attempts
      and ci.migration_state in ('native', 'active')
      and ci.approval_state = 'approved'
      and ci.publishability = 'publishable'
      and ci.content_type <> 'article'
    order by coalesce(d.next_attempt_at, ci.scheduled_at), d.id
    for update of d skip locked
    limit p_limit
  ), claimed as (
    update public.publisher_deliveries d
    set state = 'leased',
        attempt_count = d.attempt_count + 1,
        lease_token = gen_random_uuid(),
        lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
        lease_phase = 'pre_dispatch',
        updated_at = p_now
    from candidates c
    where d.id = c.id
    returning d.*
  ), attempts as (
    insert into public.publisher_delivery_attempts (
      delivery_id, attempt_number, idempotency_key, lease_token, state, claimed_at
    )
    select c.id, c.attempt_count,
      c.idempotency_key || ':attempt:' || c.attempt_count::text,
      c.lease_token, 'claimed', p_now
    from claimed c
    returning delivery_id
  )
  select c.id, c.content_item_id, c.platform, c.idempotency_key,
         c.attempt_count, c.lease_token, c.lease_expires_at,
         ci.user_id, ci.company_id, ci.content_type, ci.caption, ci.media,
         ci.scheduled_at, ci.legacy_spp_id, c.provider_reconciliation_metadata
  from claimed c
  join attempts a on a.delivery_id = c.id
  join public.publisher_content_items ci on ci.id = c.content_item_id;
end;
$$;

create or replace function publisher_private.is_safe_provider_checkpoint(p_value jsonb, p_platform text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(p_value) = 'object'
    and p_value <> '{}'::jsonb
    and octet_length(p_value::text) <= 4096
    and p_value::text !~* 'https?://'
    and not exists (
      select 1 from jsonb_object_keys(p_value) k
      where k <> all(array[
        'instagram_creation_id', 'instagram_media_kind',
        'linkedin_video_urn', 'linkedin_image_urns', 'linkedin_media_kind'
      ])
    )
    and (not (p_value ? 'instagram_creation_id') or (
      jsonb_typeof(p_value->'instagram_creation_id') = 'string'
      and length(p_value->>'instagram_creation_id') between 1 and 512))
    and (not (p_value ? 'instagram_media_kind')
      or p_value->>'instagram_media_kind' in ('image', 'carousel', 'reel'))
    and (not (p_value ? 'linkedin_video_urn') or (
      jsonb_typeof(p_value->'linkedin_video_urn') = 'string'
      and length(p_value->>'linkedin_video_urn') between 1 and 512))
    and (not (p_value ? 'linkedin_media_kind')
      or p_value->>'linkedin_media_kind' in ('text', 'image', 'multi_image', 'video'))
    and (not (p_value ? 'linkedin_image_urns') or (
      jsonb_typeof(p_value->'linkedin_image_urns') = 'array'
      and jsonb_array_length(p_value->'linkedin_image_urns') between 1 and 9
      and not exists (
        select 1 from jsonb_array_elements(p_value->'linkedin_image_urns') e
        where jsonb_typeof(e) <> 'string' or length(e #>> '{}') not between 1 and 512
      )))
    and (
      (p_platform = 'instagram'
        and p_value ?| array['instagram_creation_id', 'instagram_media_kind']
        and not p_value ?| array['linkedin_video_urn', 'linkedin_image_urns', 'linkedin_media_kind'])
      or
      (p_platform = 'linkedin'
        and p_value ?| array['linkedin_video_urn', 'linkedin_image_urns', 'linkedin_media_kind']
        and not p_value ?| array['instagram_creation_id', 'instagram_media_kind'])
    )
  , false)
$$;

create or replace function publisher_private.is_safe_provider_evidence(p_value jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(p_value) = 'object'
    and p_value <> '{}'::jsonb
    and octet_length(p_value::text) <= 4096
    and p_value::text !~* 'https?://'
    and not exists (
      select 1 from jsonb_object_keys(p_value) k
      where k <> all(array[
        'verification_method', 'verification_result', 'checked_at',
        'provider_reference', 'reviewer_note'
      ])
    )
    and p_value->>'verification_method' in ('api_lookup', 'manual_provider_check')
    and p_value->>'verification_result' in ('published', 'not_found')
    and jsonb_typeof(p_value->'checked_at') = 'string'
    and length(p_value->>'checked_at') between 1 and 64
    and (not (p_value ? 'provider_reference') or (
      jsonb_typeof(p_value->'provider_reference') = 'string'
      and length(p_value->>'provider_reference') between 1 and 512))
    and (not (p_value ? 'reviewer_note') or (
      jsonb_typeof(p_value->'reviewer_note') = 'string'
      and length(p_value->>'reviewer_note') between 1 and 512))
  , false)
$$;

create or replace function publisher_private.checkpoint_publisher_delivery(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_provider_reconciliation_metadata jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner text;
  v_platform text;
begin
  select owner into v_owner
  from public.publisher_queue_ownership
  where source = 'legacy_spp'
  for update;
  if v_owner is distinct from 'replacement' then
    raise exception 'replacement publisher does not own the queue' using errcode = '40001';
  end if;

  select d.platform into v_platform
  from public.publisher_deliveries d
  where d.id = p_delivery_id and d.state = 'leased'
    and d.lease_token = p_lease_token and d.lease_phase = 'pre_dispatch'
    and d.lease_expires_at > statement_timestamp()
  for update;
  if v_platform is null then return false; end if;
  if not publisher_private.is_safe_provider_checkpoint(p_provider_reconciliation_metadata, v_platform) then
    raise exception 'provider reconciliation checkpoint is not safe for delivery platform %', v_platform using errcode = '22023';
  end if;

  update public.publisher_deliveries d
  set provider_reconciliation_metadata = d.provider_reconciliation_metadata || p_provider_reconciliation_metadata,
      updated_at = statement_timestamp()
  where d.id = p_delivery_id;
  return found;
end;
$$;

create or replace function publisher_private.mark_publisher_dispatch_started(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_request_fingerprint_sha256 text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_request_fingerprint_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'request fingerprint must be lowercase SHA-256' using errcode = '22023';
  end if;

  update public.publisher_deliveries
  set lease_phase = 'dispatch_started', updated_at = statement_timestamp()
  where id = p_delivery_id and state = 'leased'
    and lease_token = p_lease_token and lease_phase = 'pre_dispatch'
    and lease_expires_at > statement_timestamp();
  if not found then return false; end if;

  update public.publisher_delivery_attempts
  set state = 'dispatch_started',
      request_fingerprint_sha256 = p_request_fingerprint_sha256,
      dispatch_started_at = statement_timestamp()
  where delivery_id = p_delivery_id and lease_token = p_lease_token and state = 'claimed';
  return found;
end;
$$;

create or replace function publisher_private.complete_publisher_delivery(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_platform_post_id text,
  p_live_url text default null,
  p_provider_response jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(p_platform_post_id), '') is null then
    raise exception 'platform post ID is required for success' using errcode = '22023';
  end if;

  update public.publisher_deliveries
  set state = 'succeeded', platform_post_id = p_platform_post_id,
      live_url = p_live_url, published_at = statement_timestamp(),
      lease_token = null, lease_expires_at = null, lease_phase = null,
      last_error = null, updated_at = statement_timestamp()
  where id = p_delivery_id and state = 'leased'
    and lease_token = p_lease_token and lease_phase = 'dispatch_started';
  if not found then return false; end if;

  update public.publisher_delivery_attempts
  set state = 'succeeded', provider_response = p_provider_response,
      finished_at = statement_timestamp()
  where delivery_id = p_delivery_id and lease_token = p_lease_token
    and state = 'dispatch_started';
  return found;
end;
$$;

create or replace function publisher_private.retry_publisher_delivery(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_error text,
  p_next_attempt_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  update public.publisher_deliveries
  set state = case when attempt_count >= max_attempts then 'dead_letter' else 'retryable' end,
      next_attempt_at = case when attempt_count >= max_attempts then null else p_next_attempt_at end,
      last_error = p_error,
      lease_token = null, lease_expires_at = null, lease_phase = null,
      updated_at = statement_timestamp()
  where id = p_delivery_id and state = 'leased' and lease_token = p_lease_token
    and lease_phase = 'pre_dispatch'
  returning state into v_state;
  if v_state is null then return null; end if;

  update public.publisher_delivery_attempts
  set state = v_state, error = p_error, finished_at = statement_timestamp()
  where delivery_id = p_delivery_id and lease_token = p_lease_token
    and state = 'claimed';
  return v_state;
end;
$$;

create or replace function publisher_private.dead_letter_publisher_delivery(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.publisher_deliveries
  set state = 'dead_letter', next_attempt_at = null, last_error = p_error,
      lease_token = null, lease_expires_at = null, lease_phase = null,
      updated_at = statement_timestamp()
  where id = p_delivery_id and state = 'leased' and lease_token = p_lease_token;
  if not found then return false; end if;

  update public.publisher_delivery_attempts
  set state = 'dead_letter', error = p_error, finished_at = statement_timestamp()
  where delivery_id = p_delivery_id and lease_token = p_lease_token
    and state in ('claimed', 'dispatch_started');
  return found;
end;
$$;

create or replace function publisher_private.mark_publisher_verification_required(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.publisher_deliveries
  set state = 'verification_required', next_attempt_at = null, last_error = p_error,
      lease_token = null, lease_expires_at = null, lease_phase = null,
      updated_at = statement_timestamp()
  where id = p_delivery_id and state = 'leased' and lease_token = p_lease_token
    and lease_phase = 'dispatch_started';
  if not found then return false; end if;

  update public.publisher_delivery_attempts
  set state = 'verification_required', error = p_error, finished_at = statement_timestamp()
  where delivery_id = p_delivery_id and lease_token = p_lease_token
    and state = 'dispatch_started';
  return found;
end;
$$;

create or replace function publisher_private.mark_legacy_spp_dispatch_started(
  p_post_id uuid,
  p_lease_token uuid,
  p_expected_epoch bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner text;
  v_epoch bigint;
begin
  select owner, epoch into v_owner, v_epoch
  from public.publisher_queue_ownership where source = 'legacy_spp' for update;
  if v_owner <> 'legacy' or v_epoch <> p_expected_epoch then
    raise exception 'legacy ownership mismatch: owner %, epoch %', v_owner, v_epoch using errcode = '40001';
  end if;

  update public.scheduled_posts
  set publisher_lease_phase = 'dispatch_started', updated_at = statement_timestamp()
  where id = p_post_id and status = 'publishing'
    and publisher_lease_token = p_lease_token
    and publisher_ownership_epoch = p_expected_epoch
    and publisher_lease_phase = 'pre_dispatch'
    and publisher_lease_expires_at > statement_timestamp();
  return found;
end;
$$;

create or replace function publisher_private.complete_legacy_spp_claim(
  p_post_id uuid,
  p_lease_token uuid,
  p_expected_epoch bigint,
  p_status text,
  p_platform_post_ids jsonb default '{}'::jsonb,
  p_error text default null,
  p_retry_count integer default null,
  p_published_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner text;
  v_epoch bigint;
begin
  if p_status not in ('queued', 'published', 'failed', 'cancelled') then
    raise exception 'invalid legacy completion status' using errcode = '22023';
  end if;
  if p_status = 'published' and p_published_at is null then
    raise exception 'published legacy claim requires published_at' using errcode = '22023';
  end if;

  select owner, epoch into v_owner, v_epoch
  from public.publisher_queue_ownership where source = 'legacy_spp' for update;
  if v_owner <> 'legacy' or v_epoch <> p_expected_epoch then
    raise exception 'legacy ownership mismatch: owner %, epoch %', v_owner, v_epoch using errcode = '40001';
  end if;

  update public.scheduled_posts
  set status = p_status,
      platform_post_ids = coalesce(p_platform_post_ids, '{}'::jsonb),
      error = p_error,
      retry_count = coalesce(p_retry_count, retry_count),
      published_at = case when p_status = 'published' then p_published_at else published_at end,
      publisher_lease_token = null, publisher_lease_expires_at = null,
      publisher_lease_phase = null, publisher_ownership_epoch = null,
      publisher_verification_required = false,
      updated_at = statement_timestamp()
  where id = p_post_id and status = 'publishing'
    and publisher_lease_token = p_lease_token
    and publisher_ownership_epoch = p_expected_epoch;
  return found;
end;
$$;

create or replace function publisher_private.reap_expired_legacy_spp_leases(
  p_expected_epoch bigint,
  p_now timestamptz default statement_timestamp()
)
returns table (post_id uuid, verification_required boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner text;
  v_epoch bigint;
begin
  select owner, epoch into v_owner, v_epoch
  from public.publisher_queue_ownership where source = 'legacy_spp' for update;
  if v_owner <> 'legacy' or v_epoch <> p_expected_epoch then
    raise exception 'legacy ownership mismatch: owner %, epoch %', v_owner, v_epoch using errcode = '40001';
  end if;

  return query
  with expired as (
    select sp.id, sp.publisher_lease_phase
    from public.scheduled_posts sp
    where sp.status = 'publishing' and sp.publisher_lease_expires_at <= p_now
      and sp.publisher_ownership_epoch = p_expected_epoch
    for update skip locked
  )
  update public.scheduled_posts sp
  set status = case when e.publisher_lease_phase = 'dispatch_started' then 'failed' else 'queued' end,
      error = case when e.publisher_lease_phase = 'dispatch_started'
        then 'Legacy lease expired after dispatch began; provider reconciliation required'
        else 'Legacy lease expired before dispatch began' end,
      publisher_verification_required = (e.publisher_lease_phase = 'dispatch_started'),
      publisher_lease_token = null, publisher_lease_expires_at = null,
      publisher_lease_phase = null, publisher_ownership_epoch = null,
      updated_at = p_now
  from expired e where sp.id = e.id
  returning sp.id, sp.publisher_verification_required;
end;
$$;

-- Reaps expired leases conservatively. A pre-dispatch crash is safe to retry;
-- once a provider request may have begun, human/provider reconciliation is
-- required because these APIs do not provide a reliable idempotency key.
create or replace function publisher_private.reap_expired_publisher_leases(
  p_now timestamptz default statement_timestamp()
)
returns table (delivery_id uuid, new_state text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with expired as (
    select d.id, d.lease_token, d.lease_phase,
      case
        when d.lease_phase = 'dispatch_started' then 'verification_required'
        when d.attempt_count >= d.max_attempts then 'dead_letter'
        else 'retryable'
      end as target_state
    from public.publisher_deliveries d
    where d.state = 'leased' and d.lease_expires_at <= p_now
    for update skip locked
  ), attempts as (
    update public.publisher_delivery_attempts a
    set state = e.target_state,
        error = case when e.lease_phase = 'dispatch_started'
          then 'Lease expired after dispatch began; provider reconciliation required'
          else 'Lease expired before dispatch began' end,
        finished_at = p_now
    from expired e
    where a.delivery_id = e.id and a.lease_token = e.lease_token
    returning a.delivery_id
  ), updated as (
    update public.publisher_deliveries d
    set state = e.target_state,
        next_attempt_at = case when e.target_state = 'retryable' then p_now else null end,
        last_error = case when e.lease_phase = 'dispatch_started'
          then 'Lease expired after dispatch began; provider reconciliation required'
          else 'Lease expired before dispatch began' end,
        lease_token = null, lease_expires_at = null, lease_phase = null,
        updated_at = p_now
    from expired e
    join attempts a on a.delivery_id = e.id
    where d.id = e.id
    returning d.id, d.state
  )
  select u.id, u.state from updated u;
end;
$$;

create or replace function publisher_private.resolve_legacy_delivery_verification(
  p_delivery_id uuid,
  p_resolution text,
  p_provider_post_id text,
  p_published_at timestamptz,
  p_actor text,
  p_provider_evidence jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner text;
  v_before jsonb;
  v_content_id uuid;
  v_user_id text;
  v_company_id text;
  v_attestation text;
begin
  if p_resolution is null or p_resolution not in ('confirmed_published', 'confirmed_absent')
    or nullif(btrim(p_actor), '') is null
    or not publisher_private.is_safe_provider_evidence(p_provider_evidence)
    or (p_resolution = 'confirmed_published' and p_provider_evidence->>'verification_result' <> 'published')
    or (p_resolution = 'confirmed_absent' and p_provider_evidence->>'verification_result' <> 'not_found') then
    raise exception 'verification resolution requires an outcome, actor, and provider evidence' using errcode = '22023';
  end if;
  if p_resolution = 'confirmed_published' and (
    nullif(btrim(p_provider_post_id), '') is null
    or lower(btrim(p_provider_post_id)) ~ '^(pending|unknown|failed|error|processing|publishing|queued|n/a|null|none|sent)$'
    or p_published_at is null
  ) then
    raise exception 'confirmed publication requires a durable provider ID and published_at' using errcode = '22023';
  end if;
  if p_resolution = 'confirmed_absent' and (p_provider_post_id is not null or p_published_at is not null) then
    raise exception 'confirmed absence cannot include publication fields' using errcode = '22023';
  end if;

  select owner into v_owner from public.publisher_queue_ownership
  where source = 'legacy_spp' for update;
  if v_owner is distinct from 'legacy' then
    raise exception 'legacy verification is closed after ownership transfer' using errcode = '55000';
  end if;

  select to_jsonb(d), d.content_item_id, ci.user_id, ci.company_id
  into v_before, v_content_id, v_user_id, v_company_id
  from public.publisher_deliveries d
  join public.publisher_content_items ci on ci.id = d.content_item_id
  where d.id = p_delivery_id and d.state = 'verification_required'
    and ci.legacy_spp_id is not null and ci.legacy_status = 'queued'
    and ci.publishability = 'publishable' and ci.content_type <> 'article'
  for update of d;
  if v_before is null then return false; end if;

  update public.publisher_deliveries
  set state = case when p_resolution = 'confirmed_published' then 'succeeded' else 'migration_frozen' end,
      platform_post_id = case when p_resolution = 'confirmed_published' then btrim(p_provider_post_id) else null end,
      published_at = case when p_resolution = 'confirmed_published' then p_published_at else null end,
      next_attempt_at = case when p_resolution = 'confirmed_absent'
        then (select ci.scheduled_at from public.publisher_content_items ci where ci.id=v_content_id) else null end,
      last_error = null,
      updated_at = statement_timestamp()
  where id = p_delivery_id;

  insert into public.publisher_audit_log (
    user_id, company_id, content_item_id, delivery_id, event_type, actor, details
  ) values (
    v_user_id, v_company_id, v_content_id, p_delivery_id,
    'legacy_verification_resolved', btrim(p_actor),
    jsonb_build_object(
      'resolution', p_resolution,
      'before', v_before,
      'after', (select to_jsonb(d) from public.publisher_deliveries d where d.id = p_delivery_id),
      'provider_post_id', case when p_resolution = 'confirmed_published' then btrim(p_provider_post_id) else null end,
      'published_at', p_published_at,
      'provider_evidence', p_provider_evidence
    )
  );

  select encode(extensions.digest(string_agg(
    ci.legacy_spp_id::text || ':' || ci.legacy_payload_sha256 || ':' || d.platform || ':' || d.state || ':' || coalesce(d.platform_post_id, '') || ':' || coalesce(d.published_at::text,'') || ':' || d.provider_reconciliation_metadata::text,
    E'\n' order by ci.legacy_spp_id, d.platform
  ), 'sha256'), 'hex') into v_attestation
  from public.publisher_content_items ci join public.publisher_deliveries d on d.content_item_id = ci.id
  where ci.legacy_spp_id is not null;
  update public.publisher_queue_ownership
  set reconciliation_sha256 = v_attestation, updated_at = statement_timestamp()
  where source = 'legacy_spp' and owner = 'legacy';
  return true;
end;
$$;

create or replace function publisher_private.publisher_cutover_readiness(
  p_rows jsonb,
  p_expected_epoch bigint,
  p_safety_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_owner text;
  v_epoch bigint;
  v_attestation text;
  v_computed_attestation text;
  v_binding text;
  v_next_due timestamptz;
  v_due_legacy integer;
  v_due_replacement integer;
begin
  if jsonb_typeof(p_rows) <> 'array' or p_safety_seconds is null
    or p_safety_seconds < 60 or p_safety_seconds > 86400 then
    raise exception 'invalid cutover readiness input' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) <> 67
    or (select count(*) from jsonb_array_elements(p_rows) r where r->>'status' = 'queued') <> 21
    or (select count(*) from jsonb_array_elements(p_rows) r where r->>'status' <> 'queued') <> 46
    or (select count(*) from jsonb_array_elements(p_rows) r where r->>'status' = 'queued' and lower(r->>'content_type') = 'article') <> 14
    or (select count(*) from jsonb_array_elements(p_rows) r where r->>'status' = 'queued' and lower(r->>'content_type') <> 'article') <> 7
    or (select count(distinct r->>'id') from jsonb_array_elements(p_rows) r) <> 67
    or (select count(distinct (r->>'user_id') || chr(0) || (r->>'company_id')) from jsonb_array_elements(p_rows) r) <> 1 then
    raise exception 'cutover readiness requires the exact approved 67-row shape' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) r
    where nullif(r->>'scheduled_at','') is null
      or nullif(r->>'__migration_payload_sha256','') is null
      or (r->>'__migration_payload_sha256') !~ '^[0-9a-f]{64}$'
  ) then raise exception 'cutover rows require valid timestamps and hashes' using errcode = '22023'; end if;
  perform (r->>'scheduled_at')::timestamptz from jsonb_array_elements(p_rows) r;

  select owner, epoch, reconciliation_sha256 into v_owner, v_epoch, v_attestation
  from public.publisher_queue_ownership where source='legacy_spp' for share;
  if v_owner is distinct from 'legacy' or v_epoch is distinct from p_expected_epoch then
    raise exception 'cutover readiness ownership mismatch' using errcode = '40001';
  end if;

  if (select count(*) from public.scheduled_posts) <> 67
    or (select count(*) from public.publisher_content_items where legacy_spp_id is not null) <> 67
    or exists (
      select 1 from jsonb_array_elements(p_rows) r
      full join public.publisher_content_items ci on ci.legacy_spp_id=(r->>'id')::uuid
      full join public.scheduled_posts sp on sp.id=coalesce(ci.legacy_spp_id,(r->>'id')::uuid)
      where r is null or ci.id is null or sp.id is null
        or (r - '__migration_payload_sha256') is distinct from ci.legacy_payload
        or r->>'__migration_payload_sha256' is distinct from ci.legacy_payload_sha256
        or ci.legacy_payload is distinct from (to_jsonb(sp) - array[
          'publisher_lease_token','publisher_lease_expires_at','publisher_lease_phase',
          'publisher_ownership_epoch','publisher_claim_count','publisher_verification_required'])
    ) then raise exception 'cutover export/source/import binding mismatch' using errcode = '55000'; end if;

  select encode(extensions.digest(string_agg(
    ci.legacy_spp_id::text||':'||ci.legacy_payload_sha256||':'||d.platform||':'||d.state||':'||coalesce(d.platform_post_id,'')||':'||coalesce(d.published_at::text,'')||':'||d.provider_reconciliation_metadata::text,
    E'\n' order by ci.legacy_spp_id,d.platform),'sha256'),'hex') into v_computed_attestation
  from public.publisher_content_items ci join public.publisher_deliveries d on d.content_item_id=ci.id
  where ci.legacy_spp_id is not null;
  if v_attestation is null or v_attestation is distinct from v_computed_attestation then
    raise exception 'database reconciliation attestation is missing or stale' using errcode='55000';
  end if;

  if exists (select 1 from public.publisher_deliveries where state='verification_required')
    or exists (select 1 from public.scheduled_posts where publisher_verification_required)
    or exists (select 1 from public.scheduled_posts where
      (status='publishing') is distinct from (publisher_lease_token is not null and publisher_lease_expires_at is not null and publisher_lease_phase is not null))
    or exists (select 1 from public.publisher_deliveries where
      (state='leased') is distinct from (lease_token is not null and lease_expires_at is not null and lease_phase is not null))
    or exists (select 1 from public.publisher_delivery_attempts where state in ('claimed','dispatch_started'))
    or exists (select 1 from public.publisher_delivery_attempts a join public.publisher_deliveries d on d.id=a.delivery_id
      where a.state in ('claimed','dispatch_started') and (d.state<>'leased' or d.lease_token is distinct from a.lease_token))
    or exists (select 1 from public.scheduled_posts where status='publishing')
    or exists (select 1 from public.publisher_deliveries where state='leased') then
    raise exception 'cutover readiness requires zero verification and well-formed inactive leases' using errcode = '55000';
  end if;

  if exists (
    select 1 from public.publisher_content_items ci
    cross join lateral jsonb_array_elements_text(ci.legacy_payload->'platforms') p(platform)
    full join public.publisher_deliveries d on d.content_item_id=ci.id and d.platform=p.platform
    where ci.legacy_spp_id is not null and (d.id is null
      or d.idempotency_key <> 'legacy-spp:'||ci.legacy_spp_id::text||':'||p.platform)
  ) or exists (
    select 1 from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id
    where ci.legacy_spp_id is not null and not (ci.legacy_payload->'platforms' ? d.platform)
  ) then raise exception 'cutover delivery set mismatch' using errcode = '55000'; end if;

  if exists (
    select 1
    from public.publisher_content_items ci
    cross join lateral jsonb_array_elements_text(ci.legacy_payload->'platforms') p(platform)
    join public.publisher_deliveries d on d.content_item_id=ci.id and d.platform=p.platform
    cross join lateral (select
      nullif(btrim(ci.legacy_payload->'platform_post_ids'->>p.platform),'') provider_id,
      case when p.platform='instagram' then nullif(btrim(ci.legacy_payload->'platform_post_ids'->>'instagram_container'),'') end ig_container,
      case when p.platform='instagram' then nullif(btrim(ci.legacy_payload->'platform_post_ids'->>'instagram_container_since'),'') end ig_since
    ) ids
    cross join lateral (select case
      when ids.ig_container is not null or ids.ig_since is not null then 'ambiguous'
      when ids.provider_id is null then 'empty'
      when lower(ids.provider_id) ~ '^(pending|unknown|failed|error|processing|publishing|queued|n/a|null|none|sent)$' then 'ambiguous'
      else 'durable' end id_class) classed
    where ci.legacy_spp_id is not null and (
      d.provider_reconciliation_metadata is distinct from case
        when p.platform='instagram' and (ids.ig_container is not null or ids.ig_since is not null)
        then jsonb_build_object('instagram_container',to_jsonb(ids.ig_container),'instagram_container_since',to_jsonb(ids.ig_since))
        else '{}'::jsonb end
      or (classed.id_class='durable'
        and (ci.legacy_status='published' or (ci.legacy_status='queued' and ci.content_type<>'article'))
        and (d.state<>'succeeded' or d.platform_post_id is distinct from ids.provider_id
          or d.published_at is distinct from coalesce((ci.legacy_payload->>'published_at')::timestamptz,(ci.legacy_payload->>'updated_at')::timestamptz)))
      or (classed.id_class<>'durable' and ci.legacy_status='queued' and ci.content_type='article' and d.state<>'planning_only')
      or (classed.id_class='empty' and ci.legacy_status='queued' and ci.content_type<>'article' and d.state<>'migration_frozen')
      or (classed.id_class='ambiguous' and ci.legacy_status='queued' and ci.content_type<>'article' and not exists (
        select 1 from public.publisher_audit_log a where a.delivery_id=d.id
          and a.event_type='legacy_verification_resolved'
          and a.details->'after' is not distinct from to_jsonb(d)
          and publisher_private.is_safe_provider_evidence(a.details->'provider_evidence')
          and ((a.details->>'resolution'='confirmed_published' and d.state='succeeded')
            or (a.details->>'resolution'='confirmed_absent' and d.state='migration_frozen'))
      ))
      or (ci.legacy_status='published' and classed.id_class<>'durable' and d.state<>'historical')
      or (ci.legacy_status='cancelled' and d.state<>'cancelled')
      or (ci.legacy_status='failed' and d.state<>'dead_letter')
    )
  ) then raise exception 'cutover delivery projection mismatch' using errcode='55000'; end if;

  select count(*)::integer into v_due_legacy from public.scheduled_posts sp
  join public.publisher_content_items ci on ci.legacy_spp_id=sp.id
  cross join lateral unnest(sp.platforms) p(platform)
  join public.publisher_deliveries d on d.content_item_id=ci.id and d.platform=p.platform and d.state='migration_frozen'
  where sp.status='queued' and lower(sp.content_type)<>'article' and sp.scheduled_at <= v_now;
  select count(*) into v_due_replacement from public.publisher_deliveries d
  join public.publisher_content_items ci on ci.id=d.content_item_id
  where ci.legacy_status='queued' and ci.publishability='publishable'
    and d.state='migration_frozen' and coalesce(d.next_attempt_at,ci.scheduled_at) <= v_now;
  if exists (
    select 1 from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id
    where d.state='migration_frozen' and ci.legacy_spp_id is not null
      and (ci.legacy_status<>'queued' or ci.publishability<>'publishable' or ci.content_type='article'
        or d.next_attempt_at is distinct from ci.scheduled_at)
  ) or exists (
    select 1 from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id
    where ci.legacy_spp_id is null and d.state in ('pending','retryable')
      and coalesce(d.next_attempt_at,ci.scheduled_at) <= v_now
      and d.attempt_count < d.max_attempts and ci.migration_state in ('native','active')
      and ci.approval_state='approved' and ci.publishability='publishable' and ci.content_type<>'article'
  ) then raise exception 'cutover readiness found noncanonical or native claimant work' using errcode='55000'; end if;
  if v_due_legacy <> v_due_replacement then raise exception 'legacy and replacement effective due sets differ' using errcode='55000'; end if;
  select min(candidate_at) into v_next_due from (
    select coalesce(d.next_attempt_at,ci.scheduled_at) candidate_at
    from public.scheduled_posts sp
    join public.publisher_content_items ci on ci.legacy_spp_id=sp.id
    join public.publisher_deliveries d on d.content_item_id=ci.id and d.state='migration_frozen'
    where sp.status='queued' and lower(sp.content_type)<>'article'
      and d.attempt_count < d.max_attempts and ci.approval_state='approved'
      and ci.publishability='publishable' and ci.content_type<>'article'
    union all
    select coalesce(d.next_attempt_at,ci.scheduled_at)
    from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id
    where ci.legacy_spp_id is null and d.state in ('pending','retryable')
      and d.attempt_count < d.max_attempts and ci.migration_state in ('native','active')
      and ci.approval_state='approved' and ci.publishability='publishable' and ci.content_type<>'article'
  ) candidates;
  if v_due_legacy <> 0 or v_next_due is null or v_next_due < v_now + make_interval(secs=>p_safety_seconds) then
    raise exception 'cutover safety window is not clear' using errcode='55000';
  end if;

  select encode(extensions.digest(string_agg(r->>'id'||':'||r->>'__migration_payload_sha256', E'\n' order by r->>'id'),'sha256'),'hex')
  into v_binding from jsonb_array_elements(p_rows) r;
  return jsonb_build_object('ready',true,'server_time',v_now,'owner',v_owner,'epoch',v_epoch,
    'database_attestation_sha256',v_attestation,'export_binding_sha256',v_binding,
    'counts',jsonb_build_object('total',67,'queued',21,'history',46,'queued_articles',14,'queued_publishable',7),
    'next_publishable_at',v_next_due,'checks',jsonb_build_array('binding','delivery_set','leases','due_set','safety_window'));
end;
$$;

create or replace function publisher_private.transfer_publisher_queue_ownership(
  p_rows jsonb,
  p_expected_epoch bigint,
  p_safety_seconds integer
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner text;
  v_epoch bigint;
  v_stored_attestation text;
  v_computed_attestation text;
begin
  select owner, epoch, reconciliation_sha256 into v_owner, v_epoch, v_stored_attestation
  from public.publisher_queue_ownership
  where source = 'legacy_spp'
  for update;

  if v_owner <> 'legacy' or v_epoch <> p_expected_epoch then
    raise exception 'ownership transfer mismatch: owner %, epoch %', v_owner, v_epoch
      using errcode = '40001';
  end if;

  select encode(extensions.digest(string_agg(
    ci.legacy_spp_id::text || ':' || ci.legacy_payload_sha256 || ':' || d.platform || ':' || d.state || ':' || coalesce(d.platform_post_id, '') || ':' || coalesce(d.published_at::text,'') || ':' || d.provider_reconciliation_metadata::text,
    E'\n' order by ci.legacy_spp_id, d.platform
  ), 'sha256'), 'hex')
  into v_computed_attestation
  from public.publisher_content_items ci
  join public.publisher_deliveries d on d.content_item_id = ci.id
  where ci.legacy_spp_id is not null;
  if v_stored_attestation is null or v_computed_attestation is distinct from v_stored_attestation then
    raise exception 'database reconciliation attestation is missing or stale' using errcode = '55000';
  end if;

  if exists (select 1 from public.scheduled_posts where status = 'publishing')
    or exists (select 1 from public.scheduled_posts where publisher_verification_required)
    or exists (select 1 from public.publisher_deliveries where state in ('leased', 'verification_required')) then
    raise exception 'ownership transfer requires zero live leases' using errcode = '55000';
  end if;

  if (select count(*) from public.scheduled_posts) <> 67
    or (select count(*) from public.publisher_content_items where legacy_spp_id is not null) <> 67
    or (select count(*) from public.scheduled_posts where status = 'queued') <> 21
    or (select count(*) from public.publisher_content_items where legacy_status = 'queued') <> 21
    or exists (
    select 1
    from public.scheduled_posts sp
    left join public.publisher_content_items ci on ci.legacy_spp_id = sp.id
    where (
        ci.id is null
        or ci.migration_state <> case when sp.status = 'queued' then 'migration_frozen' else 'historical' end
        or ci.legacy_payload is distinct from (
          to_jsonb(sp) - array[
            'publisher_lease_token', 'publisher_lease_expires_at',
            'publisher_lease_phase', 'publisher_ownership_epoch',
            'publisher_claim_count', 'publisher_verification_required'
          ]
        )
      )
  ) or exists (
    select 1
    from public.publisher_content_items ci
    left join public.scheduled_posts sp on sp.id = ci.legacy_spp_id
    where sp.id is null or sp.status <> ci.legacy_status
  ) then
    raise exception 'ownership transfer requires an exact fresh reconciliation of the complete queued set'
      using errcode = '55000';
  end if;

  if (select count(*) from public.publisher_deliveries d join public.publisher_content_items ci on ci.id = d.content_item_id where ci.legacy_spp_id is not null)
      <> (select sum(jsonb_array_length(ci.legacy_payload->'platforms')) from public.publisher_content_items ci where ci.legacy_spp_id is not null)
    or exists (
      select 1
      from public.publisher_content_items ci
      cross join lateral jsonb_array_elements_text(ci.legacy_payload->'platforms') p(platform)
      left join public.publisher_deliveries d on d.content_item_id = ci.id and d.platform = p.platform
      cross join lateral (
        select
          nullif(btrim(ci.legacy_payload->'platform_post_ids'->>p.platform), '') as provider_id,
          case when p.platform = 'instagram' then nullif(btrim(ci.legacy_payload->'platform_post_ids'->>'instagram_container'), '') end as instagram_container,
          case when p.platform = 'instagram' then nullif(btrim(ci.legacy_payload->'platform_post_ids'->>'instagram_container_since'), '') end as instagram_container_since
      ) ids
      cross join lateral (
        select case
          when ids.instagram_container is not null or ids.instagram_container_since is not null then 'ambiguous'
          when ids.provider_id is not null and lower(ids.provider_id) !~ '^(pending|unknown|failed|error|processing|publishing|queued|n/a|null|none|sent)$' then 'durable'
          when ids.provider_id is not null then 'ambiguous'
          else 'empty'
        end as id_class
      ) classified
      left join lateral (
        select a.details
        from public.publisher_audit_log a
        where a.delivery_id = d.id
          and a.event_type = 'legacy_verification_resolved'
          and nullif(btrim(a.actor), '') is not null
          and a.details->'provider_evidence' is not null
          and publisher_private.is_safe_provider_evidence(a.details->'provider_evidence')
          and a.details->'before'->>'state' = 'verification_required'
          and a.details->'before'->'provider_reconciliation_metadata'
            is not distinct from d.provider_reconciliation_metadata
          and a.details->'after' is not distinct from to_jsonb(d)
          and (
            (a.details->>'resolution' = 'confirmed_published'
              and a.details->'after'->>'state' = 'succeeded'
              and nullif(btrim(a.details->>'provider_post_id'), '') = d.platform_post_id
              and (a.details->>'published_at')::timestamptz is not distinct from d.published_at)
            or
            (a.details->>'resolution' = 'confirmed_absent'
              and a.details->'after'->>'state' = 'migration_frozen'
              and d.platform_post_id is null and d.published_at is null)
          )
        order by a.id desc
        limit 1
      ) resolved on true
      where d.id is null
        or d.idempotency_key <> 'legacy-spp:' || ci.legacy_spp_id::text || ':' || p.platform
        or d.state <> case
          when ci.legacy_status = 'queued' and ci.content_type = 'article' then 'planning_only'
          when ci.legacy_status = 'queued' and classified.id_class = 'durable' then 'succeeded'
          when ci.legacy_status = 'queued' and classified.id_class = 'ambiguous'
            and resolved.details->>'resolution' = 'confirmed_published' then 'succeeded'
          when ci.legacy_status = 'queued' and classified.id_class = 'ambiguous'
            and resolved.details->>'resolution' = 'confirmed_absent' then 'migration_frozen'
          when ci.legacy_status = 'queued' and classified.id_class = 'ambiguous' then 'verification_required'
          when ci.legacy_status = 'queued' then 'migration_frozen'
          when ci.legacy_status = 'published' and classified.id_class = 'durable' then 'succeeded'
          when ci.legacy_status = 'published' then 'historical'
          when ci.legacy_status = 'cancelled' then 'cancelled'
          when ci.legacy_status = 'failed' then 'dead_letter'
          when ci.legacy_status = 'publishing' then 'verification_required'
          else 'historical'
        end
        or (classified.id_class = 'durable' and d.platform_post_id is distinct from ids.provider_id)
        or (classified.id_class = 'ambiguous'
          and resolved.details->>'resolution' = 'confirmed_published'
          and d.platform_post_id is distinct from resolved.details->>'provider_post_id')
        or (classified.id_class = 'ambiguous'
          and resolved.details->>'resolution' = 'confirmed_absent'
          and d.platform_post_id is not null)
        or d.provider_reconciliation_metadata is distinct from case
          when p.platform = 'instagram' and (ids.instagram_container is not null or ids.instagram_container_since is not null)
          then jsonb_build_object(
            'instagram_container', to_jsonb(ids.instagram_container),
            'instagram_container_since', to_jsonb(ids.instagram_container_since)
          ) else '{}'::jsonb end
    ) then
    raise exception 'ownership transfer requires exact per-platform delivery reconciliation'
      using errcode = '55000';
  end if;

  perform publisher_private.publisher_cutover_readiness(p_rows,p_expected_epoch,p_safety_seconds);

  update public.publisher_queue_ownership
  set owner = 'replacement', epoch = epoch + 1, cutoff_at = statement_timestamp(),
      reconciliation_sha256 = v_computed_attestation,
      transferred_at = statement_timestamp(), updated_at = statement_timestamp()
  where source = 'legacy_spp';

  update public.publisher_content_items
  set migration_state = 'active', updated_at = statement_timestamp()
  where migration_state = 'migration_frozen' and legacy_status = 'queued';

  update public.publisher_deliveries d
  set state = 'pending', updated_at = statement_timestamp()
  from public.publisher_content_items ci
  where d.content_item_id = ci.id
    and d.state = 'migration_frozen'
    and ci.migration_state = 'active';

  insert into public.publisher_audit_log (event_type, actor, details)
  values ('ownership_transferred', 'cutover', jsonb_build_object(
    'source', 'legacy_spp', 'from_owner', 'legacy', 'to_owner', 'replacement',
    'from_epoch', v_epoch, 'to_epoch', v_epoch + 1,
    'cutoff_at', statement_timestamp(), 'reconciliation_sha256', v_computed_attestation
  ));

  return v_epoch + 1;
end;
$$;

-- Public Data API wrappers contain no privileged SQL. They explicitly verify
-- the caller, then delegate to locked-search-path implementations in the
-- unexposed publisher_private schema.
create or replace function public.import_legacy_spp_rows(p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin perform publisher_private.assert_service_caller(); return publisher_private.import_legacy_spp_rows(p_rows); end $$;

create or replace function public.claim_legacy_spp_posts(p_expected_epoch bigint, p_limit integer default 5, p_lease_seconds integer default 300, p_now timestamptz default statement_timestamp())
returns setof public.scheduled_posts language plpgsql security invoker set search_path = '' as $$
begin perform publisher_private.assert_service_caller(); return query select * from publisher_private.claim_legacy_spp_posts(p_expected_epoch,p_limit,p_lease_seconds,p_now); end $$;

create or replace function public.claim_publisher_deliveries(p_expected_epoch bigint, p_limit integer default 10, p_lease_seconds integer default 300, p_now timestamptz default statement_timestamp())
returns table (delivery_id uuid, content_item_id uuid, platform text, idempotency_key text, attempt_number integer, lease_token uuid, lease_expires_at timestamptz, user_id text, company_id text, content_type text, caption text, media jsonb, scheduled_at timestamptz, legacy_spp_id uuid, provider_reconciliation_metadata jsonb)
language plpgsql security invoker set search_path = '' as $$
begin perform publisher_private.assert_service_caller(); return query select * from publisher_private.claim_publisher_deliveries(p_expected_epoch,p_limit,p_lease_seconds,p_now); end $$;

create or replace function public.mark_publisher_dispatch_started(p_delivery_id uuid,p_lease_token uuid,p_request_fingerprint_sha256 text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin perform publisher_private.assert_service_caller(); return publisher_private.mark_publisher_dispatch_started(p_delivery_id,p_lease_token,p_request_fingerprint_sha256); end $$;

create or replace function public.checkpoint_publisher_delivery(p_delivery_id uuid,p_lease_token uuid,p_provider_reconciliation_metadata jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin perform publisher_private.assert_service_caller(); return publisher_private.checkpoint_publisher_delivery(p_delivery_id,p_lease_token,p_provider_reconciliation_metadata); end $$;

create or replace function public.complete_publisher_delivery(p_delivery_id uuid,p_lease_token uuid,p_platform_post_id text,p_live_url text default null,p_provider_response jsonb default null)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin perform publisher_private.assert_service_caller(); return publisher_private.complete_publisher_delivery(p_delivery_id,p_lease_token,p_platform_post_id,p_live_url,p_provider_response); end $$;

create or replace function public.retry_publisher_delivery(p_delivery_id uuid,p_lease_token uuid,p_error text,p_next_attempt_at timestamptz)
returns text language plpgsql security invoker set search_path = '' as $$
begin perform publisher_private.assert_service_caller(); return publisher_private.retry_publisher_delivery(p_delivery_id,p_lease_token,p_error,p_next_attempt_at); end $$;

create or replace function public.dead_letter_publisher_delivery(p_delivery_id uuid,p_lease_token uuid,p_error text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin perform publisher_private.assert_service_caller(); return publisher_private.dead_letter_publisher_delivery(p_delivery_id,p_lease_token,p_error); end $$;

create or replace function public.mark_publisher_verification_required(p_delivery_id uuid,p_lease_token uuid,p_error text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin perform publisher_private.assert_service_caller(); return publisher_private.mark_publisher_verification_required(p_delivery_id,p_lease_token,p_error); end $$;

create or replace function public.mark_legacy_spp_dispatch_started(p_post_id uuid,p_lease_token uuid,p_expected_epoch bigint)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin perform publisher_private.assert_service_caller(); return publisher_private.mark_legacy_spp_dispatch_started(p_post_id,p_lease_token,p_expected_epoch); end $$;

create or replace function public.complete_legacy_spp_claim(p_post_id uuid,p_lease_token uuid,p_expected_epoch bigint,p_status text,p_platform_post_ids jsonb default '{}'::jsonb,p_error text default null,p_retry_count integer default null,p_published_at timestamptz default null)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin perform publisher_private.assert_service_caller(); return publisher_private.complete_legacy_spp_claim(p_post_id,p_lease_token,p_expected_epoch,p_status,p_platform_post_ids,p_error,p_retry_count,p_published_at); end $$;

create or replace function public.reap_expired_legacy_spp_leases(p_expected_epoch bigint,p_now timestamptz default statement_timestamp())
returns table (post_id uuid, verification_required boolean) language plpgsql security invoker set search_path = '' as $$
begin perform publisher_private.assert_service_caller(); return query select * from publisher_private.reap_expired_legacy_spp_leases(p_expected_epoch,p_now); end $$;

create or replace function public.reap_expired_publisher_leases(p_now timestamptz default statement_timestamp())
returns table (delivery_id uuid,new_state text) language plpgsql security invoker set search_path = '' as $$
begin perform publisher_private.assert_service_caller(); return query select * from publisher_private.reap_expired_publisher_leases(p_now); end $$;

create or replace function public.resolve_legacy_delivery_verification(p_delivery_id uuid,p_resolution text,p_provider_post_id text,p_published_at timestamptz,p_actor text,p_provider_evidence jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin perform publisher_private.assert_service_caller(); return publisher_private.resolve_legacy_delivery_verification(p_delivery_id,p_resolution,p_provider_post_id,p_published_at,p_actor,p_provider_evidence); end $$;

create or replace function public.publisher_cutover_readiness(p_rows jsonb,p_expected_epoch bigint,p_safety_seconds integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin perform publisher_private.assert_service_caller(); return publisher_private.publisher_cutover_readiness(p_rows,p_expected_epoch,p_safety_seconds); end $$;

create or replace function public.transfer_publisher_queue_ownership(p_rows jsonb,p_expected_epoch bigint,p_safety_seconds integer)
returns bigint language plpgsql security invoker set search_path = '' as $$
begin perform publisher_private.assert_service_caller(); return publisher_private.transfer_publisher_queue_ownership(p_rows,p_expected_epoch,p_safety_seconds); end $$;

alter table public.publisher_queue_ownership enable row level security;
alter table public.publisher_content_items enable row level security;
alter table public.publisher_deliveries enable row level security;
alter table public.publisher_delivery_attempts enable row level security;
alter table public.publisher_audit_log enable row level security;

-- This app authenticates users outside Supabase Auth. Publisher data and RPCs
-- are therefore server-only: no anon/authenticated grants or policies. The
-- service role is used only by server runtimes and bypasses RLS by design.
revoke all on table public.publisher_queue_ownership from public, anon, authenticated, service_role;
revoke all on table public.publisher_content_items from public, anon, authenticated, service_role;
revoke all on table public.publisher_deliveries from public, anon, authenticated, service_role;
revoke all on table public.publisher_delivery_attempts from public, anon, authenticated, service_role;
revoke all on table public.publisher_audit_log from public, anon, authenticated, service_role;
revoke all on sequence public.publisher_audit_log_id_seq from public, anon, authenticated, service_role;

grant select on table public.publisher_queue_ownership to service_role;
grant select on table public.publisher_content_items to service_role;
grant select on table public.publisher_deliveries to service_role;
grant select on table public.publisher_delivery_attempts to service_role;
grant select on table public.publisher_audit_log to service_role;
grant select, update on table public.scheduled_posts to service_role;

revoke all on function public.protect_legacy_publisher_fields() from public, anon, authenticated, service_role;
revoke all on function public.guard_legacy_spp_claim_transition() from public, anon, authenticated, service_role;
revoke all on function public.prevent_publisher_audit_mutation() from public, anon, authenticated, service_role;
revoke all on function public.protect_planning_only_delivery() from public, anon, authenticated, service_role;
revoke all on function public.audit_publisher_delivery_transition() from public, anon, authenticated, service_role;
revoke all on function public.import_legacy_spp_rows(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.claim_legacy_spp_posts(bigint, integer, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.claim_publisher_deliveries(bigint, integer, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.checkpoint_publisher_delivery(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.mark_publisher_dispatch_started(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.complete_publisher_delivery(uuid, uuid, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.retry_publisher_delivery(uuid, uuid, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.dead_letter_publisher_delivery(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.mark_publisher_verification_required(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.mark_legacy_spp_dispatch_started(uuid, uuid, bigint) from public, anon, authenticated, service_role;
revoke all on function public.complete_legacy_spp_claim(uuid, uuid, bigint, text, jsonb, text, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.reap_expired_legacy_spp_leases(bigint, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.reap_expired_publisher_leases(timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.resolve_legacy_delivery_verification(uuid, text, text, timestamptz, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.publisher_cutover_readiness(jsonb, bigint, integer) from public, anon, authenticated, service_role;
revoke all on function public.transfer_publisher_queue_ownership(jsonb, bigint, integer) from public, anon, authenticated, service_role;

grant execute on function public.import_legacy_spp_rows(jsonb) to service_role;
grant execute on function public.claim_legacy_spp_posts(bigint, integer, integer, timestamptz) to service_role;
grant execute on function public.claim_publisher_deliveries(bigint, integer, integer, timestamptz) to service_role;
grant execute on function public.checkpoint_publisher_delivery(uuid, uuid, jsonb) to service_role;
grant execute on function public.mark_publisher_dispatch_started(uuid, uuid, text) to service_role;
grant execute on function public.complete_publisher_delivery(uuid, uuid, text, text, jsonb) to service_role;
grant execute on function public.retry_publisher_delivery(uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.dead_letter_publisher_delivery(uuid, uuid, text) to service_role;
grant execute on function public.mark_publisher_verification_required(uuid, uuid, text) to service_role;
grant execute on function public.mark_legacy_spp_dispatch_started(uuid, uuid, bigint) to service_role;
grant execute on function public.complete_legacy_spp_claim(uuid, uuid, bigint, text, jsonb, text, integer, timestamptz) to service_role;
grant execute on function public.reap_expired_legacy_spp_leases(bigint, timestamptz) to service_role;
grant execute on function public.reap_expired_publisher_leases(timestamptz) to service_role;
grant execute on function public.resolve_legacy_delivery_verification(uuid, text, text, timestamptz, text, jsonb) to service_role;
grant execute on function public.publisher_cutover_readiness(jsonb, bigint, integer) to service_role;
grant execute on function public.transfer_publisher_queue_ownership(jsonb, bigint, integer) to service_role;

revoke all on all functions in schema publisher_private from public, anon, authenticated, service_role;
grant usage on schema publisher_private to service_role;
grant execute on all functions in schema publisher_private to service_role;

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from public;
