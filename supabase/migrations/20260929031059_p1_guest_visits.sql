-- Server-issued, short-lived Guest visits. Browser callers only receive an
-- opaque cookie; neither its bearer value nor service-role credentials enter
-- this table or any client-side code. Reset invalidates visits by generation.
-- The three fixed Demo Auth principals are server-side adapters for existing
-- Auth/RLS business contracts. They can never acquire platform or Owner scope.
alter table public.profiles
  add column demo_principal boolean not null default false,
  add constraint profiles_demo_principal_not_platform_admin
    check (not demo_principal or platform_role = 'USER');

create function private.demo_principal_profile_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.demo_principal and exists (
    select 1 from public.workspace_memberships m
    join public.workspaces w on w.id = m.workspace_id
    where m.profile_id = new.id and w.kind = 'OWNER'
  ) then
    raise exception 'Demo principal cannot have Owner membership'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger demo_principal_profile_guard
  before insert or update of demo_principal, platform_role on public.profiles
  for each row execute function private.demo_principal_profile_guard();

create function private.demo_principal_membership_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.profiles p
    join public.workspaces w on w.id = new.workspace_id
    where p.id = new.profile_id and p.demo_principal and w.kind = 'OWNER'
    for share of p
  ) then
    raise exception 'Demo principal cannot join Owner workspace'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger demo_principal_membership_guard
  before insert or update of workspace_id, profile_id, active
  on public.workspace_memberships for each row
  execute function private.demo_principal_membership_guard();

revoke execute on function private.demo_principal_profile_guard(),
  private.demo_principal_membership_guard()
  from public, anon, authenticated;

create table public.guest_visits (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  persona public.app_role not null,
  demo_generation bigint not null check (demo_generation > 0),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index guest_visits_expiry_idx on public.guest_visits (expires_at);
create index guest_visits_workspace_generation_idx
  on public.guest_visits (workspace_id, demo_generation);

-- This trigger closes the read-then-insert race with Demo reset. Both take a
-- lock on the workspace row, so a visit can only be issued for one generation.
create function private.guest_visit_validate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.expires_at <= pg_catalog.clock_timestamp()
     or not exists (
       select 1 from public.workspaces w
       where w.id = new.workspace_id and w.kind = 'DEMO' and w.active
         and w.generation = new.demo_generation for share
     ) then
    raise exception 'Guest visit scope is invalid or stale' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger guest_visit_validate_insert_update
  before insert or update of workspace_id, demo_generation, expires_at
  on public.guest_visits for each row execute function private.guest_visit_validate();

alter table public.guest_visits enable row level security;
revoke all on public.guest_visits from public, anon, authenticated;
grant select, insert, update, delete on public.guest_visits to service_role;
revoke execute on function private.guest_visit_validate()
  from public, anon, authenticated;
