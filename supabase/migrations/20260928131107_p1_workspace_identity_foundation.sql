-- P1 foundation only. Existing operational tables and RPCs remain unscoped;
-- do not enable public sign-in until the full isolation migration is verified.

create type public.platform_role as enum ('USER', 'SUPER_ADMIN');
create type public.workspace_kind as enum ('DEMO', 'OWNER');

alter table public.profiles
  add column platform_role public.platform_role not null default 'USER';

-- The old assessment policy exposed every profile to every Auth user.
drop policy if exists profiles_read_authenticated on public.profiles;
create policy profiles_read_self
  on public.profiles for select to authenticated
  using (auth_user_id = (select auth.uid()) and active);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  kind public.workspace_kind not null,
  name text not null check (btrim(name) <> ''),
  generation bigint not null default 1 check (generation > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index workspaces_one_demo_idx
  on public.workspaces (kind) where kind = 'DEMO';

create table public.workspace_memberships (
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  role public.app_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, profile_id)
);

create index workspace_memberships_profile_idx
  on public.workspace_memberships (profile_id, active);

alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;

-- Supabase API table grants are independent of RLS. Only authenticated users
-- may read these tables; server-controlled provisioning performs all writes.
revoke all on public.workspaces from public, anon, authenticated;
revoke all on public.workspace_memberships from public, anon, authenticated;
grant select on public.workspaces to authenticated;
grant select on public.workspace_memberships to authenticated;

create policy workspace_memberships_read_self
  on public.workspace_memberships for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = profile_id
        and p.auth_user_id = (select auth.uid())
        and p.active
    )
  );

create policy workspaces_read_member
  on public.workspaces for select to authenticated
  using (
    active and exists (
      select 1
      from public.workspace_memberships m
      join public.profiles p on p.id = m.profile_id
      where m.workspace_id = id
        and m.active
        and p.active
        and p.auth_user_id = (select auth.uid())
    )
  );
