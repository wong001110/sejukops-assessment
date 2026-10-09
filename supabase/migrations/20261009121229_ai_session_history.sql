-- Additive, server-authored conversation records. No changes to business tables,
-- existing grants/functions/triggers, credentials, seed data or Demo reset.
create table public.ai_chat_sessions (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  profile_id uuid not null references public.profiles(id),
  workspace_kind text not null check (workspace_kind in ('DEMO','OWNER')),
  generation integer not null check (generation >= 1),
  scope_key text not null check (char_length(scope_key) between 40 and 200),
  role text not null check (role in ('ADMIN','MANAGER','TECHNICIAN')),
  surface text not null check (surface in ('CHATBOT','WORKSPACE')),
  title text not null check (char_length(title) between 1 and 100),
  turn_count integer not null default 0 check (turn_count between 0 and 50),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index ai_chat_sessions_scope_idx on public.ai_chat_sessions(scope_key,workspace_id,generation,id);
create index ai_chat_sessions_workspace_idx on public.ai_chat_sessions(workspace_id,generation,id);
create index ai_chat_sessions_profile_idx on public.ai_chat_sessions(profile_id);
create table public.ai_chat_turns (
  id uuid primary key,
  session_id uuid not null references public.ai_chat_sessions(id),
  question text not null check (char_length(question) between 1 and 1000),
  status text not null default 'RUNNING' check (status in ('RUNNING','COMPLETED','FAILED','INTERRUPTED')),
  answer text check (char_length(answer) <= 6000),
  workspace_snapshot jsonb,
  activity jsonb not null default '[]'::jsonb check (jsonb_typeof(activity)='array' and jsonb_array_length(activity) <= 12),
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  check (octet_length(coalesce(workspace_snapshot::text,'')) <= 131072),
  check ((status='RUNNING' and completed_at is null) or (status<>'RUNNING' and completed_at is not null))
);
create index ai_chat_turns_session_idx on public.ai_chat_turns(session_id,created_at,id);
alter table public.ai_chat_sessions enable row level security;
alter table public.ai_chat_turns enable row level security;
revoke all on public.ai_chat_sessions,public.ai_chat_turns from public,anon,authenticated;
grant select,insert,update on public.ai_chat_sessions,public.ai_chat_turns to service_role;

-- service_role-only, SECURITY INVOKER: browser Auth cannot invent transcripts.
create function public.ai_session_turn_begin(p_session_id uuid,p_turn_id uuid,p_workspace_id uuid,p_profile_id uuid,
  p_scope_key text,p_role text,p_surface text,p_generation integer,p_question text)
returns text language plpgsql security invoker set search_path = '' as $$
declare v_session public.ai_chat_sessions; v_kind text;
begin
  if p_role not in ('ADMIN','MANAGER','TECHNICIAN') or p_surface not in ('CHATBOT','WORKSPACE')
    or (p_role='TECHNICIAN' and p_surface='WORKSPACE') or p_scope_key is null
    or char_length(p_scope_key) not between 40 and 200 or char_length(btrim(p_question)) not between 1 and 1000 then
    return 'FORBIDDEN';
  end if;
  -- Small per-session transaction lock prevents duplicate starts and turn cap races.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_session_id::text,0));
  select w.kind::text into v_kind from public.workspaces w
    join public.workspace_memberships m on m.workspace_id=w.id and m.profile_id=p_profile_id
    join public.profiles p on p.id=m.profile_id
    where w.id=p_workspace_id and w.active and w.generation=p_generation and m.active and p.active and m.role::text=p_role;
  if v_kind is null then return 'FORBIDDEN'; end if;
  insert into public.ai_chat_sessions(id,workspace_id,profile_id,workspace_kind,generation,scope_key,role,surface,title)
    values(p_session_id,p_workspace_id,p_profile_id,v_kind,p_generation,p_scope_key,p_role,p_surface,left(btrim(p_question),100))
    on conflict(id) do nothing;
  select * into v_session from public.ai_chat_sessions where id=p_session_id for update;
  if (v_session.workspace_id,v_session.profile_id,v_session.generation,v_session.scope_key,v_session.role,v_session.surface)
    is distinct from (p_workspace_id,p_profile_id,p_generation,p_scope_key,p_role,p_surface) then return 'FORBIDDEN'; end if;
  if v_session.turn_count >= 50 then return 'LIMIT'; end if;
  if exists(select 1 from public.ai_chat_turns where session_id=p_session_id and status='RUNNING'
    and created_at > clock_timestamp()-interval '65 seconds') then return 'BUSY'; end if;
  update public.ai_chat_turns set status='INTERRUPTED',completed_at=clock_timestamp()
    where session_id=p_session_id and status='RUNNING';
  insert into public.ai_chat_turns(id,session_id,question) values(p_turn_id,p_session_id,p_question);
  update public.ai_chat_sessions set turn_count=turn_count+1,updated_at=clock_timestamp() where id=p_session_id;
  return 'RECORDED';
end;
$$;
create function public.ai_session_turn_finish(p_turn_id uuid,p_session_id uuid,p_scope_key text,p_generation integer,
  p_status text,p_answer text,p_workspace_snapshot jsonb,p_activity jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_count integer;
begin
  if p_status not in ('COMPLETED','FAILED','INTERRUPTED') then return false; end if;
  update public.ai_chat_turns t set status=p_status,answer=p_answer,workspace_snapshot=p_workspace_snapshot,
    activity=p_activity,completed_at=clock_timestamp()
    from public.ai_chat_sessions s,public.workspaces w
    where t.id=p_turn_id and t.session_id=p_session_id and t.status='RUNNING'
      and s.id=t.session_id and s.scope_key=p_scope_key and s.generation=p_generation
      and w.id=s.workspace_id and w.active and w.generation=s.generation;
  get diagnostics v_count = row_count;
  if v_count=1 then update public.ai_chat_sessions set updated_at=clock_timestamp() where id=p_session_id; end if;
  return v_count=1;
end;
$$;
revoke all on function public.ai_session_turn_begin(uuid,uuid,uuid,uuid,text,text,text,integer,text) from public,anon,authenticated;
revoke all on function public.ai_session_turn_finish(uuid,uuid,text,integer,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ai_session_turn_begin(uuid,uuid,uuid,uuid,text,text,text,integer,text) to service_role;
grant execute on function public.ai_session_turn_finish(uuid,uuid,text,integer,text,text,jsonb,jsonb) to service_role;
