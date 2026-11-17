-- Apply AFTER events.sql, as postgres, for existing or new Supabase projects.
-- All media/session authority belongs to the Edge Function's service role.
begin;
alter table public.campus_events add column if not exists native_live_enabled boolean not null default false;
alter table public.campus_events add column if not exists native_stream_id uuid;
alter table public.campus_events add column if not exists native_last_seen_at timestamptz;
alter table public.campus_events drop constraint if exists campus_events_youtube_state_check;
alter table public.campus_events drop constraint if exists campus_events_legacy_video_check;
alter table public.campus_events add constraint campus_events_legacy_video_check check (
  youtube_video_id is null or (not native_live_enabled and youtube_video_id ~ '^[A-Za-z0-9_-]{11}$')
);

create table if not exists public.campus_live_sessions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  event_id uuid not null references public.campus_events(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete restrict,
  room_name text not null unique,
  state text not null default 'reserved' check (state in ('reserved','live','ended')),
  heartbeat_at timestamptz not null default pg_catalog.now(),
  created_at timestamptz not null default pg_catalog.now(),
  ended_at timestamptz,
  constraint campus_live_room_name_check check (room_name = 'campus-' || event_id::text || '-' || id::text)
);
create unique index if not exists campus_live_one_active_event_idx
  on public.campus_live_sessions(event_id) where state in ('reserved','live');
create index if not exists campus_live_sessions_owner_id_idx
  on public.campus_live_sessions(owner_id);
alter table public.campus_live_sessions enable row level security;
revoke all on public.campus_live_sessions from public, anon, authenticated, service_role;

create or replace function public.campus_live_assert_owner(p_owner_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog as $fn$
begin
  if not exists (
    select 1 from public.event_admins a join auth.users u on u.id=a.user_id
    where a.user_id=p_owner_id and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)
  ) then raise exception using message='stream_forbidden', errcode='42501'; end if;
end;
$fn$;
alter function public.campus_live_assert_owner(uuid) owner to postgres;
revoke all on function public.campus_live_assert_owner(uuid) from public,anon,authenticated,service_role;

-- An ordinary administrator may edit content and enable native streaming before
-- starting. They cannot forge LIVE, a heartbeat or a session UUID via REST PATCH.
create or replace function public.campus_live_guard_event()
returns trigger language plpgsql security definer set search_path = pg_catalog as $fn$
declare trusted boolean := session_user in ('postgres','supabase_admin') or coalesce(auth.role()='service_role',false);
begin
  if trusted then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if tg_op='INSERT' then
    if new.live_state<>'off' or new.native_stream_id is not null or new.native_last_seen_at is not null then
      raise exception using message='Live state is controlled by the streaming server',errcode='42501';
    end if;
    return new;
  end if;
  if exists (select 1 from public.campus_live_sessions s where s.id=old.native_stream_id and s.state in ('reserved','live')) then
    if tg_op='DELETE' then raise exception 'Stop the native stream before deleting its event'; end if;
    if new.status is distinct from old.status or new.native_live_enabled is distinct from old.native_live_enabled then
      raise exception 'Stop the native stream before hiding or disabling its event';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  if new.live_state is distinct from old.live_state or new.native_stream_id is distinct from old.native_stream_id
    or new.native_last_seen_at is distinct from old.native_last_seen_at then
    raise exception using message='Live state is controlled by the streaming server',errcode='42501';
  end if;
  return new;
end;
$fn$;
alter function public.campus_live_guard_event() owner to postgres;
revoke all on function public.campus_live_guard_event() from public,anon,authenticated;
drop trigger if exists campus_live_guard_event on public.campus_events;
create trigger campus_live_guard_event before insert or update or delete on public.campus_events
  for each row execute function public.campus_live_guard_event();

create or replace function public.campus_live_reserve(p_event_id uuid,p_owner_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $fn$
declare e public.campus_events%rowtype; s public.campus_live_sessions%rowtype; next_id uuid;
  stale_rooms jsonb := '[]'::jsonb; stale_sessions jsonb := '[]'::jsonb;
begin
  perform public.campus_live_assert_owner(p_owner_id);
  select * into e from public.campus_events where id=p_event_id for update;
  if not found or e.status<>'published' or not e.native_live_enabled or e.youtube_video_id is not null then
    raise exception using message='event_unavailable',errcode='P0001';
  end if;
  select * into s from public.campus_live_sessions where event_id=p_event_id and state in ('reserved','live') for update;
  if found then
    if s.heartbeat_at > statement_timestamp()-interval '75 seconds' then
      raise exception using message='stream_active',errcode='23505';
    end if;
    stale_rooms:=jsonb_build_array(s.room_name);
    stale_sessions:=jsonb_build_array(jsonb_build_object('event_id',s.event_id,'stream_id',s.id,'owner_id',s.owner_id,'room_name',s.room_name,'state','ended'));
    update public.campus_live_sessions set state='ended',ended_at=statement_timestamp() where id=s.id;
  end if;
  next_id:=pg_catalog.gen_random_uuid();
  insert into public.campus_live_sessions(id,event_id,owner_id,room_name)
  values(next_id,p_event_id,p_owner_id,'campus-'||p_event_id::text||'-'||next_id::text) returning * into s;
  update public.campus_events set live_state='scheduled',native_stream_id=s.id,native_last_seen_at=null where id=p_event_id;
  return jsonb_build_object('event_id',s.event_id,'stream_id',s.id,'owner_id',s.owner_id,'room_name',s.room_name,
    'state',s.state,'heartbeat_at',s.heartbeat_at,'stale_rooms',stale_rooms,'stale_sessions',stale_sessions);
end;
$fn$;

create or replace function public.campus_live_get_session(p_event_id uuid,p_stream_id uuid,p_owner_id uuid)
returns jsonb language plpgsql security definer stable set search_path = pg_catalog as $fn$
declare s public.campus_live_sessions%rowtype; e public.campus_events%rowtype;
begin
  perform public.campus_live_assert_owner(p_owner_id);
  select * into e from public.campus_events where id=p_event_id;
  if not found then raise exception using message='event_unavailable',errcode='P0001'; end if;
  select * into s from public.campus_live_sessions where id=coalesce(p_stream_id,e.native_stream_id) and event_id=p_event_id;
  if not found then raise exception using message='stream_missing',errcode='P0001'; end if;
  if s.owner_id<>p_owner_id then raise exception using message='stream_forbidden',errcode='42501'; end if;
  return jsonb_build_object('event_id',s.event_id,'stream_id',s.id,'owner_id',s.owner_id,'room_name',s.room_name,
    'state',s.state,'heartbeat_at',s.heartbeat_at);
end;
$fn$;

create or replace function public.campus_live_transition(p_event_id uuid,p_stream_id uuid,p_owner_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $fn$
declare s public.campus_live_sessions%rowtype; e public.campus_events%rowtype;
begin
  perform public.campus_live_assert_owner(p_owner_id);
  if p_action is null or p_action not in ('confirm','heartbeat','finish') then raise exception 'invalid_transition'; end if;
  select * into e from public.campus_events where id=p_event_id for update;
  if not found then raise exception 'event_unavailable'; end if;
  select * into s from public.campus_live_sessions where id=p_stream_id and event_id=p_event_id for update;
  if not found then raise exception 'stream_missing'; end if;
  if s.owner_id<>p_owner_id then raise exception using message='stream_forbidden',errcode='42501'; end if;
  if p_action='finish' then
    update public.campus_live_sessions set state='ended',ended_at=coalesce(ended_at,statement_timestamp()) where id=s.id;
    if e.native_stream_id=s.id then
      update public.campus_events set live_state='ended',native_last_seen_at=null where id=e.id;
    end if;
    return jsonb_build_object('event_id',s.event_id,'stream_id',s.id,'owner_id',s.owner_id,'room_name',s.room_name,'state','ended');
  end if;
  if e.native_stream_id is distinct from s.id or not e.native_live_enabled or e.status<>'published' then raise exception 'stream_stale'; end if;
  if s.state='ended' or s.heartbeat_at<=statement_timestamp()-interval '75 seconds' then raise exception 'stream_stale'; end if;
  if p_action='heartbeat' and s.state<>'live' then raise exception 'invalid_transition'; end if;
  update public.campus_live_sessions set state='live',heartbeat_at=statement_timestamp() where id=s.id;
  update public.campus_events set live_state='live',native_last_seen_at=statement_timestamp() where id=e.id;
  return jsonb_build_object('event_id',s.event_id,'stream_id',s.id,'owner_id',s.owner_id,'room_name',s.room_name,
    'state','live','heartbeat_at',statement_timestamp());
end;
$fn$;

create or replace function public.campus_live_get_view(p_event_id uuid)
returns jsonb language plpgsql security definer stable set search_path = pg_catalog as $fn$
declare s public.campus_live_sessions%rowtype; e public.campus_events%rowtype;
begin
  select * into e from public.campus_events where id=p_event_id and status='published' and native_live_enabled
    and live_state='live' and native_last_seen_at>statement_timestamp()-interval '75 seconds';
  if not found then raise exception 'event_unavailable'; end if;
  select * into s from public.campus_live_sessions where id=e.native_stream_id and event_id=e.id
    and state='live' and heartbeat_at>statement_timestamp()-interval '75 seconds';
  if not found then raise exception 'event_unavailable'; end if;
  perform public.campus_live_assert_owner(s.owner_id);
  return jsonb_build_object('event_id',s.event_id,'stream_id',s.id,'owner_id',s.owner_id,'room_name',s.room_name,
    'state',s.state,'heartbeat_at',s.heartbeat_at,'status',e.status,'native_live_enabled',e.native_live_enabled,
    'live_state',e.live_state,'native_last_seen_at',e.native_last_seen_at);
end;
$fn$;

alter function public.campus_live_reserve(uuid,uuid) owner to postgres;
alter function public.campus_live_get_session(uuid,uuid,uuid) owner to postgres;
alter function public.campus_live_transition(uuid,uuid,uuid,text) owner to postgres;
alter function public.campus_live_get_view(uuid) owner to postgres;
revoke all on function public.campus_live_reserve(uuid,uuid), public.campus_live_get_session(uuid,uuid,uuid),
  public.campus_live_transition(uuid,uuid,uuid,text), public.campus_live_get_view(uuid) from public,anon,authenticated;
grant execute on function public.campus_live_reserve(uuid,uuid), public.campus_live_get_session(uuid,uuid,uuid),
  public.campus_live_transition(uuid,uuid,uuid,text), public.campus_live_get_view(uuid) to service_role;
commit;
