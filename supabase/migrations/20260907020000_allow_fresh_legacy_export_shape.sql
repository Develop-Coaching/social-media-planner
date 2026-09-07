-- Issue #27: permit a fresh complete legacy export after the legacy claimant has
-- legitimately moved queued rows into terminal history. Completeness is derived
-- from exact bidirectional source/export/import binding rather than a stale
-- point-in-time status distribution. This migration is forward-only and leaves
-- the already-applied base migration unchanged.

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
    or (select count(distinct r->>'id') from jsonb_array_elements(p_rows) r) <> 67
    or (select count(distinct ((r->>'user_id'), (r->>'company_id'))) from jsonb_array_elements(p_rows) r) <> 1
    or exists (
      select 1 from jsonb_array_elements(p_rows) r
      where not (r ?& array['id','user_id','company_id','content_type','platforms','scheduled_at','status'])
        or r->>'status' not in ('queued','publishing','published','failed','cancelled')
        or jsonb_typeof(r->'platforms') <> 'array'
        or jsonb_array_length(r->'platforms') = 0
        or exists (
          select 1 from jsonb_array_elements_text(r->'platforms') p(value)
          where p.value not in ('instagram','facebook','linkedin')
        )
    ) then
    raise exception 'legacy import must contain all 67 unique rows for one tenant with valid statuses and platforms'
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

  if (select count(*) from public.publisher_content_items where legacy_spp_id is not null) <> jsonb_array_length(p_rows)
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
    or (select count(distinct r->>'id') from jsonb_array_elements(p_rows) r) <> 67
    or (select count(distinct ((r->>'user_id'), (r->>'company_id'))) from jsonb_array_elements(p_rows) r) <> 1
    or exists (
      select 1 from jsonb_array_elements(p_rows) r
      where not (r ?& array['id','user_id','company_id','content_type','platforms','scheduled_at','status'])
        or r->>'status' not in ('queued','publishing','published','failed','cancelled')
        or jsonb_typeof(r->'platforms') <> 'array'
        or jsonb_array_length(r->'platforms') = 0
        or exists (
          select 1 from jsonb_array_elements_text(r->'platforms') p(value)
          where p.value not in ('instagram','facebook','linkedin')
        )
    ) then
    raise exception 'cutover readiness requires a valid complete single-tenant export' using errcode = '22023';
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

  if (select count(*) from public.scheduled_posts) <> jsonb_array_length(p_rows)
    or (select count(*) from public.publisher_content_items where legacy_spp_id is not null) <> jsonb_array_length(p_rows)
    or exists (
      select 1 from jsonb_array_elements(p_rows) r
      full join (
        select * from public.publisher_content_items where legacy_spp_id is not null
      ) ci on ci.legacy_spp_id=(r->>'id')::uuid
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
      (publisher_lease_token is null) is distinct from (publisher_lease_expires_at is null)
      or (publisher_lease_token is null) is distinct from (publisher_lease_phase is null))
    or exists (select 1 from public.scheduled_posts where
      (status='publishing') is distinct from (publisher_lease_token is not null and publisher_lease_expires_at is not null and publisher_lease_phase is not null))
    or exists (select 1 from public.publisher_deliveries where
      (lease_token is null) is distinct from (lease_expires_at is null)
      or (lease_token is null) is distinct from (lease_phase is null))
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

  select encode(extensions.digest(string_agg((r->>'id')||':'||(r->>'__migration_payload_sha256'), E'\n' order by r->>'id'),'sha256'),'hex')
  into v_binding from jsonb_array_elements(p_rows) r;
  return jsonb_build_object('ready',true,'server_time',v_now,'owner',v_owner,'epoch',v_epoch,
    'database_attestation_sha256',v_attestation,'export_binding_sha256',v_binding,
    'counts',jsonb_build_object(
      'total',jsonb_array_length(p_rows),
      'queued',(select count(*) from jsonb_array_elements(p_rows) r where r->>'status'='queued'),
      'history',(select count(*) from jsonb_array_elements(p_rows) r where r->>'status'<>'queued'),
      'queued_articles',(select count(*) from jsonb_array_elements(p_rows) r where r->>'status'='queued' and lower(r->>'content_type')='article'),
      'queued_publishable',(select count(*) from jsonb_array_elements(p_rows) r where r->>'status'='queued' and lower(r->>'content_type')<>'article')
    ),
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

  if (select count(*) from public.scheduled_posts) <> jsonb_array_length(p_rows)
    or (select count(*) from public.publisher_content_items where legacy_spp_id is not null) <> jsonb_array_length(p_rows)
    or (select count(*) from public.scheduled_posts where status = 'queued') <> (select count(*) from jsonb_array_elements(p_rows) r where r->>'status' = 'queued')
    or (select count(*) from public.publisher_content_items where legacy_status = 'queued') <> (select count(*) from jsonb_array_elements(p_rows) r where r->>'status' = 'queued')
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
    where ci.legacy_spp_id is not null
      and (sp.id is null or sp.status <> ci.legacy_status)
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
