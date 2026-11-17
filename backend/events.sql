-- Supabase migration: campus event gallery, private media and owner-managed admins.
-- Run in the connected project's SQL Editor as postgres. No admin is added here.
-- Re-running this migration preserves rows and the existing administrator list.
begin;

create table if not exists public.event_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table if not exists public.campus_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120 and title ~ '[^[:space:]]'),
  description text not null default '' check (char_length(description) <= 4000),
  location text not null default '' check (char_length(location) <= 160),
  starts_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'published')),
  live_state text not null default 'off'
    check (live_state in ('off', 'scheduled', 'live', 'ended')),
  youtube_video_id text, -- Legacy only; native broadcasts do not use an external video ID.
  native_live_enabled boolean not null default false,
  native_stream_id uuid,
  native_last_seen_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint campus_events_legacy_video_check check (
    youtube_video_id is null or (not native_live_enabled and youtube_video_id ~ '^[A-Za-z0-9_-]{11}$')
  )
);

-- The helper checks the current verified Auth identity, not a caller-supplied UUID.
-- Explicit qualification and a fixed path avoid search_path hijacking.
create or replace function public.is_event_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select exists (
    select 1
    from public.event_admins as a
    join auth.users as u on u.id = a.user_id
    where a.user_id = auth.uid()
      and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)
  );
$function$;
alter function public.is_event_admin() owner to postgres;
revoke all on function public.is_event_admin() from public, anon, authenticated;
grant execute on function public.is_event_admin() to anon, authenticated;

-- Only a canonical event UUID plus a random file UUID and an allowed extension.
-- CASE prevents casting arbitrary malformed storage names to uuid.
create or replace function public.event_storage_event_id(object_name text)
returns uuid
language sql
immutable
strict
set search_path = pg_catalog
as $function$
  select case when object_name ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|gif|mp4|webm|mov)$'
    then split_part(object_name, '/', 1)::uuid
    else null
  end;
$function$;
revoke all on function public.event_storage_event_id(text) from public, anon, authenticated;
grant execute on function public.event_storage_event_id(text) to authenticated;

create table if not exists public.event_media (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  event_id uuid not null references public.campus_events(id) on delete cascade,
  kind text not null check (kind in ('photo', 'video')),
  storage_path text not null unique,
  mime_type text not null,
  original_name text not null check (char_length(original_name) between 1 and 255),
  created_at timestamptz not null default pg_catalog.now(),
  constraint event_media_path_check check (
    public.event_storage_event_id(storage_path) is not null
    and public.event_storage_event_id(storage_path) = event_id
  ),
  constraint event_media_kind_mime_extension_check check (
    (kind = 'photo' and (
      (mime_type = 'image/jpeg' and storage_path ~ '\.(jpg|jpeg)$')
      or (mime_type = 'image/png' and storage_path ~ '\.png$')
      or (mime_type = 'image/webp' and storage_path ~ '\.webp$')
      or (mime_type = 'image/gif' and storage_path ~ '\.gif$')
    ))
    or (kind = 'video' and (
      (mime_type = 'video/mp4' and storage_path ~ '\.mp4$')
      or (mime_type = 'video/webm' and storage_path ~ '\.webm$')
      or (mime_type = 'video/quicktime' and storage_path ~ '\.mov$')
    ))
  )
);

create index if not exists campus_events_public_dates_idx
  on public.campus_events (status, starts_at desc, created_at desc);
create index if not exists event_media_event_created_idx
  on public.event_media (event_id, created_at);

create or replace function public.touch_campus_event()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if new.id is distinct from old.id then
    raise exception 'The event identifier is immutable';
  end if;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := statement_timestamp();
  return new;
end;
$function$;
revoke all on function public.touch_campus_event() from public, anon, authenticated;
drop trigger if exists campus_events_touch_updated_at on public.campus_events;
create trigger campus_events_touch_updated_at
  before update on public.campus_events
  for each row execute function public.touch_campus_event();

alter table public.event_admins enable row level security;
alter table public.campus_events enable row level security;
alter table public.event_media enable row level security;

-- Supabase defaults may include broad table grants. Replace them explicitly.
revoke all on public.event_admins, public.campus_events, public.event_media
  from public, anon, authenticated;
grant select on public.event_admins to authenticated;
grant select on public.campus_events, public.event_media to anon, authenticated;
grant insert, update, delete on public.campus_events, public.event_media to authenticated;

-- Clients can inspect only their own membership. No client can add an admin.
drop policy if exists campus_event_admin_self_read on public.event_admins;
create policy campus_event_admin_self_read on public.event_admins
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists campus_event_admin_read_guard on public.event_admins;
create policy campus_event_admin_read_guard on public.event_admins
  as restrictive for select to authenticated using (user_id = (select auth.uid()));

-- Public visitors can read published events only; listed admins can read drafts.
drop policy if exists campus_events_read on public.campus_events;
create policy campus_events_read on public.campus_events
  for select to anon, authenticated
  using (status = 'published' or (select public.is_event_admin()));
drop policy if exists campus_events_read_guard on public.campus_events;
create policy campus_events_read_guard on public.campus_events
  as restrictive for select to anon, authenticated
  using (status = 'published' or (select public.is_event_admin()));

drop policy if exists campus_events_admin_insert on public.campus_events;
create policy campus_events_admin_insert on public.campus_events
  for insert to authenticated
  with check ((select public.is_event_admin()) and created_by = (select auth.uid()));
drop policy if exists campus_events_insert_guard on public.campus_events;
create policy campus_events_insert_guard on public.campus_events
  as restrictive for insert to authenticated
  with check ((select public.is_event_admin()) and created_by = (select auth.uid()));

drop policy if exists campus_events_admin_update on public.campus_events;
create policy campus_events_admin_update on public.campus_events
  for update to authenticated
  using ((select public.is_event_admin())) with check ((select public.is_event_admin()));
drop policy if exists campus_events_update_guard on public.campus_events;
create policy campus_events_update_guard on public.campus_events
  as restrictive for update to authenticated
  using ((select public.is_event_admin())) with check ((select public.is_event_admin()));

drop policy if exists campus_events_admin_delete on public.campus_events;
create policy campus_events_admin_delete on public.campus_events
  for delete to authenticated using ((select public.is_event_admin()));
drop policy if exists campus_events_delete_guard on public.campus_events;
create policy campus_events_delete_guard on public.campus_events
  as restrictive for delete to authenticated using ((select public.is_event_admin()));

-- The parent event remains the authority for media visibility.
drop policy if exists event_media_read on public.event_media;
create policy event_media_read on public.event_media
  for select to anon, authenticated
  using ((select public.is_event_admin()) or exists (
    select 1 from public.campus_events as e
    where e.id = event_media.event_id and e.status = 'published'
  ));
drop policy if exists event_media_read_guard on public.event_media;
create policy event_media_read_guard on public.event_media
  as restrictive for select to anon, authenticated
  using ((select public.is_event_admin()) or exists (
    select 1 from public.campus_events as e
    where e.id = event_media.event_id and e.status = 'published'
  ));

drop policy if exists event_media_admin_insert on public.event_media;
create policy event_media_admin_insert on public.event_media
  for insert to authenticated with check ((select public.is_event_admin()));
drop policy if exists event_media_insert_guard on public.event_media;
create policy event_media_insert_guard on public.event_media
  as restrictive for insert to authenticated with check ((select public.is_event_admin()));

drop policy if exists event_media_admin_update on public.event_media;
create policy event_media_admin_update on public.event_media
  for update to authenticated
  using ((select public.is_event_admin())) with check ((select public.is_event_admin()));
drop policy if exists event_media_update_guard on public.event_media;
create policy event_media_update_guard on public.event_media
  as restrictive for update to authenticated
  using ((select public.is_event_admin())) with check ((select public.is_event_admin()));

drop policy if exists event_media_admin_delete on public.event_media;
create policy event_media_admin_delete on public.event_media
  for delete to authenticated using ((select public.is_event_admin()));
drop policy if exists event_media_delete_guard on public.event_media;
create policy event_media_delete_guard on public.event_media
  as restrictive for delete to authenticated using ((select public.is_event_admin()));

-- This migration is intentionally Supabase-specific. Do not silently install
-- an unrestricted Storage bucket if the platform's Storage RLS is disabled.
do $block$
begin
  if not (select relrowsecurity from pg_catalog.pg_class where oid = 'storage.objects'::regclass) then
    raise exception 'Storage RLS must be enabled before installing campus events';
  end if;
end;
$block$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'campus-events', 'campus-events', false, 47185920,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'video/mp4', 'video/webm', 'video/quicktime']::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- A private object may receive a signed URL only if its exact metadata path
-- belongs to a published event, or if the caller is a verified listed admin.
drop policy if exists campus_event_objects_read on storage.objects;
create policy campus_event_objects_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'campus-events' and (
    (select public.is_event_admin()) or exists (
      select 1 from public.event_media as m
      join public.campus_events as e on e.id = m.event_id
      where m.storage_path = storage.objects.name and e.status = 'published'
    )
  ));
drop policy if exists campus_event_objects_read_guard on storage.objects;
create policy campus_event_objects_read_guard on storage.objects
  as restrictive for select to anon, authenticated
  using (bucket_id <> 'campus-events' or (
    (select public.is_event_admin()) or exists (
      select 1 from public.event_media as m
      join public.campus_events as e on e.id = m.event_id
      where m.storage_path = storage.objects.name and e.status = 'published'
    )
  ));

-- INSERT and UPDATE require an existing event and its canonical UUID path.
drop policy if exists campus_event_objects_admin_insert on storage.objects;
create policy campus_event_objects_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'campus-events' and (select public.is_event_admin()) and exists (
    select 1 from public.campus_events as e
    where e.id = public.event_storage_event_id(storage.objects.name)
  ));
drop policy if exists campus_event_objects_insert_guard on storage.objects;
create policy campus_event_objects_insert_guard on storage.objects
  as restrictive for insert to anon, authenticated
  with check (bucket_id <> 'campus-events' or ((select public.is_event_admin()) and exists (
    select 1 from public.campus_events as e
    where e.id = public.event_storage_event_id(storage.objects.name)
  )));

drop policy if exists campus_event_objects_admin_update on storage.objects;
create policy campus_event_objects_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'campus-events' and (select public.is_event_admin()))
  with check (bucket_id = 'campus-events' and (select public.is_event_admin()) and exists (
    select 1 from public.campus_events as e
    where e.id = public.event_storage_event_id(storage.objects.name)
  ));
drop policy if exists campus_event_objects_update_guard on storage.objects;
create policy campus_event_objects_update_guard on storage.objects
  as restrictive for update to anon, authenticated
  using (bucket_id <> 'campus-events' or (select public.is_event_admin()))
  with check (bucket_id <> 'campus-events' or ((select public.is_event_admin()) and exists (
    select 1 from public.campus_events as e
    where e.id = public.event_storage_event_id(storage.objects.name)
  )));

-- DELETE intentionally allows an admin to clean orphan files after an interrupted
-- upload or a parent deletion. It never grants upload/read access to non-admins.
drop policy if exists campus_event_objects_admin_delete on storage.objects;
create policy campus_event_objects_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'campus-events' and (select public.is_event_admin()));
drop policy if exists campus_event_objects_delete_guard on storage.objects;
create policy campus_event_objects_delete_guard on storage.objects
  as restrictive for delete to anon, authenticated
  using (bucket_id <> 'campus-events' or (select public.is_event_admin()));

-- Grants are limited to application tables/functions. Existing policies and
-- grants on other Storage buckets are neither replaced nor broadened.
commit;

-- REQUIRED before exposing native controls: apply backend/native-live.sql.
-- It installs service-role-only session RPCs and guards server-owned live fields.
