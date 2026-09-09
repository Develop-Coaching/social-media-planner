-- Idempotent native publisher ingestion (issue #33).
-- Existing legacy/native rows remain valid; all rows created through this
-- contract carry immutable tenant-scoped source provenance.

alter table public.publisher_content_items
  add column source_system text,
  add column source_id text,
  add column media_state text not null default 'ready'
    check (media_state in ('ready', 'blocked')),
  add column media_block_reason text,
  add column content_state text not null default 'ready'
    check (content_state in ('ready', 'blocked')),
  add column content_block_reason text,
  add column source_metadata jsonb not null default '{}'::jsonb,
  add column ingestion_envelope jsonb,
  add column ingestion_fingerprint_sha256 text,
  add column lifecycle_version bigint not null default 0 check (lifecycle_version >= 0),
  add column last_release_fingerprint_sha256 text,
  add column last_release_response jsonb,
  add constraint publisher_content_items_source_pair check (
    (source_system is null and source_id is null)
    or (nullif(btrim(source_system), '') is not null and nullif(btrim(source_id), '') is not null)
  ),
  add constraint publisher_content_items_native_source_shape check (
    source_system is null or (
      source_system ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'
      and length(source_id) between 1 and 200
      and source_id !~ '[[:cntrl:]]'
    )
  ),
  add constraint publisher_content_items_media_block_shape check (
    (media_state = 'ready' and media_block_reason is null)
    or (media_state = 'blocked' and nullif(btrim(media_block_reason), '') is not null and length(media_block_reason) <= 500)
  ),
  add constraint publisher_content_items_content_block_shape check (
    (content_state = 'ready' and content_block_reason is null)
    or (content_state = 'blocked' and nullif(btrim(content_block_reason), '') is not null and length(content_block_reason) <= 500)
  ),
  add constraint publisher_content_items_source_metadata_shape check (
    jsonb_typeof(source_metadata) = 'object' and octet_length(source_metadata::text) <= 8192
  ),
  add constraint publisher_content_items_ingestion_identity_shape check (
    (ingestion_envelope is null and ingestion_fingerprint_sha256 is null)
    or (jsonb_typeof(ingestion_envelope) = 'object'
      and ingestion_fingerprint_sha256 ~ '^[0-9a-f]{64}$')
  ),
  add constraint publisher_content_items_release_replay_shape check (
    (last_release_fingerprint_sha256 is null and last_release_response is null)
    or (last_release_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
      and jsonb_typeof(last_release_response) = 'object')
  );

create unique index publisher_content_items_native_source_uidx
  on public.publisher_content_items (user_id, company_id, source_system, source_id)
  where source_system is not null;

create or replace function public.protect_native_source_provenance()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.source_system is not null and (
    new.source_system is distinct from old.source_system or new.source_id is distinct from old.source_id
    or new.ingestion_envelope is distinct from old.ingestion_envelope
    or new.ingestion_fingerprint_sha256 is distinct from old.ingestion_fingerprint_sha256
  ) then
    raise exception 'native source provenance is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger protect_native_source_provenance
before update on public.publisher_content_items
for each row execute function public.protect_native_source_provenance();

alter table public.publisher_deliveries
  drop constraint publisher_deliveries_state_check,
  add constraint publisher_deliveries_state_check check (state in (
    'migration_frozen', 'planning_only', 'blocked_media', 'blocked_content', 'stale_schedule', 'pending', 'leased', 'retryable',
    'verification_required', 'succeeded', 'dead_letter', 'cancelled', 'historical'
  ));

create or replace function publisher_private.native_media_is_ready(
  p_user_id text,
  p_company_id text,
  p_content_type text,
  p_platforms text[],
  p_media jsonb
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_image_count integer := 0;
  v_upload_count integer := 0;
  v_has_video boolean := false;
begin
  if jsonb_typeof(p_media) <> 'object' or octet_length(p_media::text) > 65536 then
    return false;
  end if;
  if exists (select 1 from jsonb_object_keys(p_media) key where key <> all(array[
    'saved_content_id','image_keys','upload_paths','cover_path','media_urls','video_url'
  ])) then return false; end if;
  if p_media ? 'media_urls' then
    if jsonb_typeof(p_media->'media_urls') <> 'array'
      or jsonb_array_length(p_media->'media_urls') > 0 then
      return false;
    end if;
    v_image_count := jsonb_array_length(p_media->'media_urls');
  end if;
  if p_media ? 'upload_paths' then
    if jsonb_typeof(p_media->'upload_paths') <> 'array'
      or exists (select 1 from jsonb_array_elements(p_media->'upload_paths') v where jsonb_typeof(v) <> 'string'
        or (v #>> '{}') ~ '(^/|\\|\.\.|[[:cntrl:]])'
        or not (left((v #>> '{}'), length(p_user_id || '/' || p_company_id || '/')) = p_user_id || '/' || p_company_id || '/'
          or left((v #>> '{}'), length('uploads/' || p_user_id || '/' || p_company_id || '/')) = 'uploads/' || p_user_id || '/' || p_company_id || '/')) then
      return false;
    end if;
    v_upload_count := jsonb_array_length(p_media->'upload_paths');
  end if;
  if p_media ? 'cover_path' and nullif(btrim(p_media->>'cover_path'), '') is not null and (
    (p_media->>'cover_path') ~ '(^/|\\|\.\.|[[:cntrl:]])'
    or not (left((p_media->>'cover_path'), length(p_user_id || '/' || p_company_id || '/')) = p_user_id || '/' || p_company_id || '/'
      or left((p_media->>'cover_path'), length('uploads/' || p_user_id || '/' || p_company_id || '/')) = 'uploads/' || p_user_id || '/' || p_company_id || '/')
  ) then return false; end if;
  if p_media ? 'image_keys' then
    if jsonb_typeof(p_media->'image_keys') <> 'array'
      or exists (select 1 from jsonb_array_elements(p_media->'image_keys') v where jsonb_typeof(v) <> 'string' or nullif(btrim(v #>> '{}'), '') is null)
      or (jsonb_array_length(p_media->'image_keys') > 0 and nullif(btrim(p_media->>'saved_content_id'), '') is null) then
      return false;
    end if;
    v_image_count := v_image_count + jsonb_array_length(p_media->'image_keys');
  end if;
  v_has_video := false;
  if nullif(btrim(p_media->>'video_url'), '') is not null then return false; end if;

  if p_content_type in ('reel', 'video') then
    return v_has_video or v_upload_count > 0;
  end if;
  if p_content_type = 'carousel' then
    return v_image_count + v_upload_count >= 2;
  end if;
  if 'instagram' = any(p_platforms) then
    return v_has_video or v_image_count + v_upload_count > 0;
  end if;
  return true;
end;
$$;

create or replace function publisher_private.ingest_native_publisher_content(
  p_user_id text,
  p_company_id text,
  p_source_system text,
  p_source_id text,
  p_content_type text,
  p_caption text,
  p_media jsonb,
  p_scheduled_at timestamptz,
  p_platforms text[],
  p_media_state text,
  p_media_block_reason text default null,
  p_content_state text default 'ready',
  p_content_block_reason text default null,
  p_source_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_content_type text := lower(btrim(p_content_type));
  v_source_system text := lower(btrim(p_source_system));
  v_source_id text := btrim(p_source_id);
  v_platforms text[];
  v_existing public.publisher_content_items%rowtype;
  v_item public.publisher_content_items%rowtype;
  v_expected_state text;
  v_publishability text;
  v_created boolean := false;
  v_delivery jsonb;
  v_ingestion_envelope jsonb;
  v_ingestion_fingerprint text;
begin
  perform publisher_private.assert_service_caller();
  if nullif(btrim(p_user_id), '') is null or nullif(btrim(p_company_id), '') is null
    or v_source_system is null or v_source_id is null or v_content_type is null
    or v_source_system !~ '^[a-z0-9][a-z0-9_.-]{0,63}$'
    or length(v_source_id) < 1 or length(v_source_id) > 200
    or v_source_id ~ '[[:cntrl:]]'
    or v_content_type <> all(array['post','carousel','reel','video','quote','article'])
    or p_scheduled_at is null
    or jsonb_typeof(coalesce(p_media, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_source_metadata, '{}'::jsonb)) <> 'object'
    or octet_length(coalesce(p_source_metadata, '{}'::jsonb)::text) > 8192
    or p_media_state is null or p_media_state <> all(array['ready','blocked'])
    or p_content_state is null or p_content_state <> all(array['ready','blocked']) then
    raise exception 'invalid native publisher ingestion payload' using errcode = '22023';
  end if;
  select array_agg(distinct lower(btrim(platform)) order by lower(btrim(platform)))
    into v_platforms from unnest(p_platforms) platform;
  if coalesce(array_length(v_platforms, 1), 0) < 1
    or exists (select 1 from unnest(v_platforms) platform where platform <> all(array['instagram','facebook','linkedin'])) then
    raise exception 'invalid publisher platforms' using errcode = '22023';
  end if;

  if exists (select 1 from jsonb_object_keys(coalesce(p_source_metadata, '{}'::jsonb)) key
      where key <> all(array['graphic_prompt','audit','audit_index','originally_scheduled_for','content_fingerprint_sha256']))
    or (p_source_metadata ? 'graphic_prompt' and (jsonb_typeof(p_source_metadata->'graphic_prompt') <> 'string' or length(p_source_metadata->>'graphic_prompt') > 4000))
    or (p_source_metadata ? 'audit' and (jsonb_typeof(p_source_metadata->'audit') <> 'string' or length(p_source_metadata->>'audit') > 500))
    or (p_source_metadata ? 'audit_index' and (jsonb_typeof(p_source_metadata->'audit_index') <> 'number' or (p_source_metadata->>'audit_index') !~ '^[0-9]+$'))
    or (p_source_metadata ? 'originally_scheduled_for' and (jsonb_typeof(p_source_metadata->'originally_scheduled_for') <> 'string' or (p_source_metadata->>'originally_scheduled_for') !~ '^20[0-9]{2}-'))
    or (p_source_metadata ? 'content_fingerprint_sha256' and (jsonb_typeof(p_source_metadata->'content_fingerprint_sha256') <> 'string' or (p_source_metadata->>'content_fingerprint_sha256') !~ '^[0-9a-f]{64}$')) then
    raise exception 'invalid source metadata' using errcode = '22023';
  end if;
  if p_content_state = 'blocked' then
    if nullif(btrim(p_content_block_reason), '') is null or length(p_content_block_reason) > 500 then
      raise exception 'blocked content requires a reason' using errcode = '22023';
    end if;
  elsif p_content_block_reason is not null then
    raise exception 'ready content cannot have a block reason' using errcode = '22023';
  end if;
  if v_content_type <> 'article' and 'linkedin' = any(v_platforms)
    and length(coalesce(p_caption, '')) > 3000 and p_content_state <> 'blocked' then
    raise exception 'LinkedIn captions cannot exceed 3000 characters unless content is blocked' using errcode = '22023';
  end if;

  if v_content_type = 'article' then
    if v_platforms <> array['linkedin']::text[] or p_media_state <> 'ready' or p_media_block_reason is not null or p_content_state <> 'ready' then
      raise exception 'native articles must be LinkedIn planning-only inventory' using errcode = '22023';
    end if;
    v_publishability := 'planning_only';
    v_expected_state := 'planning_only';
  else
    v_publishability := 'publishable';
    if p_media_state = 'blocked' then
      if nullif(btrim(p_media_block_reason), '') is null then
        raise exception 'blocked media requires a reason' using errcode = '22023';
      end if;
    else
      if p_media_block_reason is not null
        or not publisher_private.native_media_is_ready(p_user_id, p_company_id, v_content_type, v_platforms, coalesce(p_media, '{}'::jsonb)) then
        raise exception 'ready media does not satisfy the platform requirements' using errcode = '22023';
      end if;
    end if;
    if p_content_state = 'blocked' then
      v_expected_state := 'blocked_content';
    elsif p_media_state = 'blocked' then
      v_expected_state := 'blocked_media';
    else
      v_expected_state := 'pending';
    end if;
  end if;

  v_ingestion_envelope := jsonb_build_object(
    'user_id', p_user_id, 'company_id', p_company_id,
    'source_system', v_source_system, 'source_id', v_source_id,
    'content_type', v_content_type, 'caption', coalesce(p_caption, ''),
    'media', coalesce(p_media, '{}'::jsonb), 'scheduled_at', to_jsonb(p_scheduled_at),
    'platforms', to_jsonb(v_platforms),
    'media_state', case when v_content_type = 'article' then 'ready' else p_media_state end,
    'media_block_reason', case when p_media_state = 'blocked' then btrim(p_media_block_reason) else null end,
    'content_state', p_content_state,
    'content_block_reason', case when p_content_state = 'blocked' then btrim(p_content_block_reason) else null end,
    'source_metadata', coalesce(p_source_metadata, '{}'::jsonb)
  );
  v_ingestion_fingerprint := encode(extensions.digest(v_ingestion_envelope::text, 'sha256'), 'hex');

  if not exists (select 1 from public.companies c where c.user_id = p_user_id and c.id = p_company_id) then
    raise exception 'publisher tenant does not exist' using errcode = '23503';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_user_id || chr(31) || p_company_id || chr(31) || v_source_system || chr(31) || v_source_id, 0
  ));
  select * into v_existing from public.publisher_content_items ci
    where ci.user_id = p_user_id and ci.company_id = p_company_id
      and ci.source_system = v_source_system and ci.source_id = v_source_id;

  if found then
    if v_existing.ingestion_fingerprint_sha256 is distinct from v_ingestion_fingerprint
      or v_existing.ingestion_envelope is distinct from v_ingestion_envelope then
      raise exception 'source provenance already exists with different content' using errcode = '23505';
    end if;
    v_item := v_existing;
  else
    if v_publishability = 'publishable' and p_scheduled_at <= statement_timestamp() then
      raise exception 'native publishable content must be scheduled in the future' using errcode = '22023';
    end if;
    insert into public.publisher_content_items (
      user_id, company_id, source_system, source_id, content_type, caption, media,
      scheduled_at, approval_state, publishability, migration_state, media_state, media_block_reason,
      content_state, content_block_reason, source_metadata, ingestion_envelope, ingestion_fingerprint_sha256
    ) values (
      p_user_id, p_company_id, v_source_system, v_source_id, v_content_type, coalesce(p_caption, ''),
      coalesce(p_media, '{}'::jsonb), p_scheduled_at, 'approved', v_publishability, 'native',
      case when v_content_type = 'article' then 'ready' else p_media_state end,
      case when p_media_state = 'blocked' then btrim(p_media_block_reason) else null end,
      p_content_state,
      case when p_content_state = 'blocked' then btrim(p_content_block_reason) else null end,
      coalesce(p_source_metadata, '{}'::jsonb), v_ingestion_envelope, v_ingestion_fingerprint
    ) returning * into v_item;

    insert into public.publisher_deliveries (
      content_item_id, platform, state, idempotency_key, next_attempt_at
    )
    select v_item.id, platform, v_expected_state,
      'native:' || encode(extensions.digest(
        p_user_id || chr(31) || p_company_id || chr(31) || v_source_system || chr(31) || v_source_id || chr(31) || platform,
        'sha256'
      ), 'hex'),
      case when v_expected_state = 'pending' then p_scheduled_at else null end
    from unnest(v_platforms) platform;
    v_created := true;
    insert into public.publisher_audit_log (user_id, company_id, content_item_id, event_type, actor, details)
    values (p_user_id, p_company_id, v_item.id, 'native_content_ingested', 'native_ingestion_rpc',
      jsonb_build_object('source_system', v_source_system, 'source_id', v_source_id, 'media_state', v_item.media_state));
  end if;

  select jsonb_agg(jsonb_build_object('id', d.id, 'platform', d.platform, 'state', d.state) order by d.platform)
    into v_delivery from public.publisher_deliveries d where d.content_item_id = v_item.id;
  return jsonb_build_object(
    'content_item_id', v_item.id,
    'created', v_created,
    'publishability', v_item.publishability,
    'media_state', v_item.media_state,
    'deliveries', coalesce(v_delivery, '[]'::jsonb)
  );
end;
$$;

create or replace function publisher_private.attach_native_publisher_media(
  p_user_id text,
  p_company_id text,
  p_source_system text,
  p_source_id text,
  p_media jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.publisher_content_items%rowtype;
  v_platforms text[];
begin
  perform publisher_private.assert_service_caller();
  select * into v_item from public.publisher_content_items ci
    where ci.user_id = p_user_id and ci.company_id = p_company_id
      and ci.source_system = lower(btrim(p_source_system)) and ci.source_id = btrim(p_source_id)
    for update;
  if not found then raise exception 'native content source was not found' using errcode = 'P0002'; end if;
  if v_item.publishability <> 'publishable' or v_item.migration_state <> 'native' or v_item.media_state <> 'blocked' then
    raise exception 'content is not eligible for native media attachment' using errcode = '22023';
  end if;
  select array_agg(d.platform order by d.platform) into v_platforms
    from public.publisher_deliveries d where d.content_item_id = v_item.id;
  if exists (select 1 from public.publisher_deliveries d where d.content_item_id = v_item.id and (d.state not in ('blocked_media','blocked_content') or d.attempt_count <> 0)) then
    raise exception 'media can only be attached before any delivery is claimable' using errcode = '55000';
  end if;
  if v_item.scheduled_at <= statement_timestamp() then
    raise exception 'blocked media schedule is stale; create a future schedule before release' using errcode = '55000';
  end if;
  if not publisher_private.native_media_is_ready(p_user_id, p_company_id, v_item.content_type, v_platforms, p_media) then
    raise exception 'attached media does not satisfy the platform requirements' using errcode = '22023';
  end if;
  update public.publisher_content_items set media = p_media, media_state = 'ready', media_block_reason = null,
    lifecycle_version = lifecycle_version + 1, updated_at = statement_timestamp() where id = v_item.id;
  update public.publisher_deliveries set
    state = case when v_item.content_state = 'blocked' then 'blocked_content' else 'pending' end,
    next_attempt_at = case when v_item.content_state = 'blocked' then null else v_item.scheduled_at end,
    updated_at = statement_timestamp() where content_item_id = v_item.id;
  insert into public.publisher_audit_log (user_id, company_id, content_item_id, event_type, actor, details)
    values (p_user_id, p_company_id, v_item.id, 'native_media_attached', 'native_ingestion_rpc',
      jsonb_build_object('source_system', v_item.source_system, 'source_id', v_item.source_id));
  return jsonb_build_object('content_item_id', v_item.id, 'media_state', 'ready');
end;
$$;

create or replace function publisher_private.release_native_publisher_content(
  p_user_id text,
  p_company_id text,
  p_source_system text,
  p_source_id text,
  p_scheduled_at timestamptz,
  p_expected_lifecycle_version bigint,
  p_caption text default null,
  p_media jsonb default null,
  p_actor text default 'native_release_rpc'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.publisher_content_items%rowtype;
  v_platforms text[];
  v_caption text;
  v_media jsonb;
  v_delivery jsonb;
  v_release_envelope jsonb;
  v_release_fingerprint text;
  v_release_response jsonb;
begin
  perform publisher_private.assert_service_caller();
  if p_scheduled_at is null or p_scheduled_at <= statement_timestamp()
    or p_expected_lifecycle_version is null or p_expected_lifecycle_version < 0
    or nullif(btrim(p_actor), '') is null or length(p_actor) > 200 then
    raise exception 'release requires a future schedule, lifecycle version, and bounded actor' using errcode = '22023';
  end if;
  select * into v_item from public.publisher_content_items ci
  where ci.user_id = p_user_id and ci.company_id = p_company_id
    and ci.source_system = lower(btrim(p_source_system)) and ci.source_id = btrim(p_source_id)
  for update;
  if not found then raise exception 'native content source was not found' using errcode = 'P0002'; end if;
  if v_item.publishability <> 'publishable' or v_item.migration_state <> 'native' then
    raise exception 'content is not eligible for native release' using errcode = '22023';
  end if;
  v_release_envelope := jsonb_build_object(
    'user_id',p_user_id,'company_id',p_company_id,'source_system',lower(btrim(p_source_system)),
    'source_id',btrim(p_source_id),'scheduled_at',to_jsonb(p_scheduled_at),
    'expected_lifecycle_version',p_expected_lifecycle_version,'caption',p_caption,'media',p_media
  );
  v_release_fingerprint := encode(extensions.digest(v_release_envelope::text,'sha256'),'hex');
  if v_item.last_release_fingerprint_sha256 = v_release_fingerprint then
    return jsonb_set(v_item.last_release_response,'{released}','false'::jsonb);
  end if;
  perform 1 from public.publisher_deliveries d where d.content_item_id = v_item.id for update;
  select array_agg(d.platform order by d.platform) into v_platforms
    from public.publisher_deliveries d where d.content_item_id = v_item.id;
  if exists (select 1 from public.publisher_deliveries d where d.content_item_id = v_item.id and d.attempt_count <> 0)
    or exists (select 1 from public.publisher_delivery_attempts a join public.publisher_deliveries d on d.id=a.delivery_id where d.content_item_id=v_item.id) then
    raise exception 'attempted content cannot be released or rescheduled' using errcode = '55000';
  end if;

  v_caption := coalesce(p_caption, v_item.caption);
  v_media := coalesce(p_media, v_item.media);
  if v_item.content_state = 'blocked' and p_caption is null then
    raise exception 'blocked content requires corrected caption on release' using errcode = '22023';
  elsif v_item.content_state = 'ready' and p_caption is not null and p_caption is distinct from v_item.caption then
    raise exception 'release cannot rewrite content that was not blocked' using errcode = '22023';
  end if;
  if 'linkedin' = any(v_platforms) and length(v_caption) > 3000 then
    raise exception 'LinkedIn captions cannot exceed 3000 characters' using errcode = '22023';
  end if;
  if v_item.media_state = 'blocked' and p_media is null then
    raise exception 'blocked media requires tenant-owned media on release' using errcode = '22023';
  elsif v_item.media_state = 'ready' and p_media is not null and p_media is distinct from v_item.media then
    raise exception 'release cannot replace media that was not blocked' using errcode = '22023';
  end if;
  if not publisher_private.native_media_is_ready(p_user_id,p_company_id,v_item.content_type,v_platforms,v_media) then
    raise exception 'release media does not satisfy tenant and platform requirements' using errcode = '22023';
  end if;

  if not exists (select 1 from public.publisher_deliveries d where d.content_item_id=v_item.id and d.state <> 'pending')
    and v_item.content_state='ready' and v_item.media_state='ready'
    and v_item.scheduled_at=p_scheduled_at and v_item.caption=v_caption and v_item.media=v_media then
    select jsonb_agg(jsonb_build_object('id',d.id,'platform',d.platform,'state',d.state) order by d.platform)
      into v_delivery from public.publisher_deliveries d where d.content_item_id=v_item.id;
    return jsonb_build_object('content_item_id',v_item.id,'released',false,'scheduled_at',v_item.scheduled_at,
      'lifecycle_version',v_item.lifecycle_version,'deliveries',v_delivery);
  end if;
  if v_item.lifecycle_version <> p_expected_lifecycle_version then
    raise exception 'publisher lifecycle version conflict' using errcode = '40001';
  end if;
  if exists (select 1 from public.publisher_deliveries d where d.content_item_id=v_item.id
      and d.state not in ('blocked_media','blocked_content','stale_schedule')) then
    raise exception 'only blocked or stale content can be released' using errcode = '55000';
  end if;

  select jsonb_agg(jsonb_build_object('id',d.id,'platform',d.platform,'state','pending') order by d.platform)
    into v_delivery from public.publisher_deliveries d where d.content_item_id=v_item.id;
  v_release_response := jsonb_build_object('content_item_id',v_item.id,'released',true,
    'scheduled_at',p_scheduled_at,'lifecycle_version',v_item.lifecycle_version+1,
    'deliveries',coalesce(v_delivery,'[]'::jsonb));
  update public.publisher_content_items set caption=v_caption, media=v_media, scheduled_at=p_scheduled_at,
    content_state='ready', content_block_reason=null, media_state='ready', media_block_reason=null,
    last_release_fingerprint_sha256=v_release_fingerprint, last_release_response=v_release_response,
    lifecycle_version=lifecycle_version+1, updated_at=statement_timestamp() where id=v_item.id
    returning * into v_item;
  update public.publisher_deliveries set state='pending', next_attempt_at=p_scheduled_at,
    last_error=null, updated_at=statement_timestamp() where content_item_id=v_item.id;
  insert into public.publisher_audit_log (user_id,company_id,content_item_id,event_type,actor,details)
  values (p_user_id,p_company_id,v_item.id,'native_content_released',btrim(p_actor),
    jsonb_build_object('source_system',v_item.source_system,'source_id',v_item.source_id,'scheduled_at',p_scheduled_at));
  return v_release_response;
end;
$$;

-- The claim gate is repeated here deliberately: blocked media remains
-- unclaimable even if a delivery state is corrupted outside the RPC contract.
create or replace function publisher_private.claim_publisher_deliveries(
  p_expected_epoch bigint,
  p_limit integer default 10,
  p_lease_seconds integer default 300,
  p_now timestamptz default statement_timestamp()
)
returns table (
  delivery_id uuid, content_item_id uuid, platform text, idempotency_key text,
  attempt_number integer, lease_token uuid, lease_expires_at timestamptz,
  user_id text, company_id text, content_type text, caption text, media jsonb,
  scheduled_at timestamptz, legacy_spp_id uuid, provider_reconciliation_metadata jsonb
)
language plpgsql security definer set search_path = '' as $$
declare v_owner text; v_epoch bigint;
begin
  if p_limit < 1 or p_limit > 100 or p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'invalid claim bounds' using errcode = '22023';
  end if;
  select owner, epoch into v_owner, v_epoch from public.publisher_queue_ownership
    where source = 'legacy_spp' for update;
  if v_owner <> 'replacement' or v_epoch <> p_expected_epoch then
    raise exception 'replacement ownership mismatch: owner %, epoch %', v_owner, v_epoch using errcode = '40001';
  end if;
  with stale_candidates as (
    select d.id, ci.id as content_item_id
    from public.publisher_content_items ci
    join public.publisher_deliveries d on d.content_item_id = ci.id
    where ci.source_system is not null and d.state in ('pending','retryable')
      and coalesce(d.next_attempt_at, ci.scheduled_at) < p_now - interval '15 minutes'
    order by ci.id, d.id for update of ci,d
  ), stale as (
    update public.publisher_deliveries d
    set state = 'stale_schedule', next_attempt_at = null,
      last_error = 'Native schedule missed the 15 minute dispatch safety window', updated_at = p_now
    from stale_candidates c where d.id = c.id returning c.content_item_id
  ), affected as (select distinct s.content_item_id from stale s)
  update public.publisher_content_items ci
    set lifecycle_version = lifecycle_version + 1, updated_at = p_now
  from affected a where ci.id = a.content_item_id;
  return query
  with candidates as (
    select d.id from public.publisher_deliveries d
    join public.publisher_content_items ci on ci.id = d.content_item_id
    where d.state in ('pending','retryable')
      and coalesce(d.next_attempt_at, ci.scheduled_at) <= p_now
      and d.attempt_count < d.max_attempts
      and ci.migration_state in ('native','active')
      and ci.approval_state = 'approved' and ci.publishability = 'publishable'
      and ci.media_state = 'ready' and ci.content_state = 'ready' and ci.content_type <> 'article'
    order by coalesce(d.next_attempt_at, ci.scheduled_at), d.id
    for update of d skip locked limit p_limit
  ), claimed as (
    update public.publisher_deliveries d set state='leased', attempt_count=d.attempt_count+1,
      lease_token=gen_random_uuid(), lease_expires_at=p_now+make_interval(secs=>p_lease_seconds),
      lease_phase='pre_dispatch', updated_at=p_now
    from candidates c where d.id=c.id returning d.*
  ), attempts as (
    insert into public.publisher_delivery_attempts as inserted_attempt
      (delivery_id,attempt_number,idempotency_key,lease_token,state,claimed_at)
    select c.id,c.attempt_count,c.idempotency_key||':attempt:'||c.attempt_count::text,c.lease_token,'claimed',p_now
      from claimed c returning inserted_attempt.delivery_id
  )
  select c.id,c.content_item_id,c.platform,c.idempotency_key,c.attempt_count,c.lease_token,c.lease_expires_at,
    ci.user_id,ci.company_id,ci.content_type,ci.caption,ci.media,ci.scheduled_at,ci.legacy_spp_id,c.provider_reconciliation_metadata
  from claimed c join attempts a on a.delivery_id=c.id
  join public.publisher_content_items ci on ci.id=c.content_item_id;
end;
$$;

create or replace function public.ingest_native_publisher_content(
  p_user_id text, p_company_id text, p_source_system text, p_source_id text,
  p_content_type text, p_caption text, p_media jsonb, p_scheduled_at timestamptz,
  p_platforms text[], p_media_state text, p_media_block_reason text default null,
  p_content_state text default 'ready', p_content_block_reason text default null,
  p_source_metadata jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  perform publisher_private.assert_service_caller();
  return publisher_private.ingest_native_publisher_content(p_user_id,p_company_id,p_source_system,p_source_id,
    p_content_type,p_caption,p_media,p_scheduled_at,p_platforms,p_media_state,p_media_block_reason,
    p_content_state,p_content_block_reason,p_source_metadata);
end;
$$;

create or replace function public.attach_native_publisher_media(
  p_user_id text, p_company_id text, p_source_system text, p_source_id text, p_media jsonb
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  perform publisher_private.assert_service_caller();
  return publisher_private.attach_native_publisher_media(p_user_id,p_company_id,p_source_system,p_source_id,p_media);
end;
$$;

create or replace function public.release_native_publisher_content(
  p_user_id text, p_company_id text, p_source_system text, p_source_id text,
  p_scheduled_at timestamptz, p_expected_lifecycle_version bigint,
  p_caption text default null, p_media jsonb default null,
  p_actor text default 'native_release_rpc'
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  perform publisher_private.assert_service_caller();
  return publisher_private.release_native_publisher_content(
    p_user_id,p_company_id,p_source_system,p_source_id,p_scheduled_at,p_expected_lifecycle_version,p_caption,p_media,p_actor
  );
end;
$$;

revoke all on function publisher_private.native_media_is_ready(text,text,text,text[],jsonb) from public,anon,authenticated,service_role;
revoke all on function publisher_private.ingest_native_publisher_content(text,text,text,text,text,text,jsonb,timestamptz,text[],text,text,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function publisher_private.attach_native_publisher_media(text,text,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.ingest_native_publisher_content(text,text,text,text,text,text,jsonb,timestamptz,text[],text,text,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.attach_native_publisher_media(text,text,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function publisher_private.release_native_publisher_content(text,text,text,text,timestamptz,bigint,text,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.release_native_publisher_content(text,text,text,text,timestamptz,bigint,text,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.protect_native_source_provenance() from public,anon,authenticated,service_role;
grant execute on function public.ingest_native_publisher_content(text,text,text,text,text,text,jsonb,timestamptz,text[],text,text,text,text,jsonb) to service_role;
grant execute on function public.attach_native_publisher_media(text,text,text,text,jsonb) to service_role;
grant execute on function public.release_native_publisher_content(text,text,text,text,timestamptz,bigint,text,jsonb,text) to service_role;
grant execute on function publisher_private.ingest_native_publisher_content(text,text,text,text,text,text,jsonb,timestamptz,text[],text,text,text,text,jsonb) to service_role;
grant execute on function publisher_private.attach_native_publisher_media(text,text,text,text,jsonb) to service_role;
grant execute on function publisher_private.release_native_publisher_content(text,text,text,text,timestamptz,bigint,text,jsonb,text) to service_role;
