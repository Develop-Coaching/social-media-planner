-- Add YouTube Shorts to the active replacement publisher. This migration is
-- forward-only: legacy payload projection and imported rows remain unchanged.

alter table public.publisher_deliveries
  drop constraint publisher_deliveries_platform_check,
  add constraint publisher_deliveries_platform_check
    check (platform in ('instagram', 'facebook', 'linkedin', 'youtube'));

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

  if p_content_type in ('reel', 'video') or 'youtube' = any(p_platforms) then
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
    or exists (select 1 from unnest(v_platforms) platform where platform <> all(array['instagram','facebook','linkedin','youtube'])) then
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
        'linkedin_video_urn', 'linkedin_image_urns', 'linkedin_media_kind',
        'youtube_media_kind', 'youtube_source_tag'
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
    and (not (p_value ? 'youtube_media_kind') or p_value->>'youtube_media_kind' = 'short')
    and (not (p_value ? 'youtube_source_tag') or (
      jsonb_typeof(p_value->'youtube_source_tag') = 'string'
      and p_value->>'youtube_source_tag' ~ '^dcsrc_[0-9a-f]{24}$'))
    and (
      (p_platform = 'instagram'
        and p_value ?| array['instagram_creation_id', 'instagram_media_kind']
        and not p_value ?| array['linkedin_video_urn', 'linkedin_image_urns', 'linkedin_media_kind', 'youtube_media_kind', 'youtube_source_tag'])
      or
      (p_platform = 'linkedin'
        and p_value ?| array['linkedin_video_urn', 'linkedin_image_urns', 'linkedin_media_kind']
        and not p_value ?| array['instagram_creation_id', 'instagram_media_kind', 'youtube_media_kind', 'youtube_source_tag'])
      or
      (p_platform = 'youtube'
        and p_value->>'youtube_media_kind' = 'short'
        and p_value->>'youtube_source_tag' ~ '^dcsrc_[0-9a-f]{24}$'
        and not p_value ?| array['instagram_creation_id', 'instagram_media_kind', 'linkedin_video_urn', 'linkedin_image_urns', 'linkedin_media_kind'])
    )
  , false)
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
        or d.platform not in ('instagram','facebook','linkedin','youtube')))
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
