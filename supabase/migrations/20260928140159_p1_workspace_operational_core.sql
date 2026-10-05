-- Additive P1 business core. Legacy assessment tables and RPCs remain in place
-- until their callers are replaced; this migration does not enable public sign-in.

create type public.service_order_status as enum (
  'NEW', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED'
);

create table public.workspace_branches (
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  code text not null check (btrim(code) <> ''),
  name text not null check (btrim(name) <> ''),
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  unique (workspace_id, code)
);

create table public.workspace_technicians (
  workspace_id uuid not null,
  id uuid not null default gen_random_uuid(),
  profile_id uuid not null,
  branch_id uuid not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  unique (workspace_id, profile_id),
  foreign key (workspace_id, profile_id)
    references public.workspace_memberships(workspace_id, profile_id) on delete restrict,
  foreign key (workspace_id, branch_id)
    references public.workspace_branches(workspace_id, id) on delete restrict
);

create table public.workspace_customers (
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  phone text,
  address text not null check (btrim(address) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create table public.workspace_orders (
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  order_no text not null check (btrim(order_no) <> ''),
  branch_id uuid not null,
  customer_id uuid not null,
  assigned_technician_id uuid,
  problem_description text not null check (btrim(problem_description) <> ''),
  service_type text not null check (btrim(service_type) <> ''),
  status public.service_order_status not null default 'NEW',
  scheduled_at timestamptz,
  created_by_profile_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  unique (workspace_id, order_no),
  foreign key (workspace_id, branch_id)
    references public.workspace_branches(workspace_id, id) on delete restrict,
  foreign key (workspace_id, customer_id)
    references public.workspace_customers(workspace_id, id) on delete restrict,
  foreign key (workspace_id, assigned_technician_id)
    references public.workspace_technicians(workspace_id, id) on delete restrict,
  foreign key (workspace_id, created_by_profile_id)
    references public.workspace_memberships(workspace_id, profile_id) on delete restrict,
  constraint workspace_order_assignment_required check (
    status = 'NEW' or assigned_technician_id is not null
  )
);

create index workspace_orders_status_idx
  on public.workspace_orders (workspace_id, status, created_at desc);
create index workspace_orders_technician_idx
  on public.workspace_orders (workspace_id, assigned_technician_id, scheduled_at);
create index workspace_orders_customer_idx
  on public.workspace_orders (workspace_id, customer_id, assigned_technician_id);

alter table public.workspace_branches enable row level security;
alter table public.workspace_technicians enable row level security;
alter table public.workspace_customers enable row level security;
alter table public.workspace_orders enable row level security;

-- Writes are withheld from API roles until actor-bound mutation services exist.
revoke all on public.workspace_branches from public, anon, authenticated;
revoke all on public.workspace_technicians from public, anon, authenticated;
revoke all on public.workspace_customers from public, anon, authenticated;
revoke all on public.workspace_orders from public, anon, authenticated;
grant select on public.workspace_branches to authenticated;
grant select on public.workspace_technicians to authenticated;
grant select on public.workspace_customers to authenticated;
grant select on public.workspace_orders to authenticated;

-- Anonymous Auth users have the authenticated Postgres role, so the workspace
-- kind check is essential even if a bad provisioner creates an Owner membership.
create policy workspace_branches_read_member
  on public.workspace_branches for select to authenticated
  using (exists (
    select 1 from public.workspace_memberships m
    join public.profiles p on p.id = m.profile_id
    join public.workspaces w on w.id = m.workspace_id
    where m.workspace_id = workspace_branches.workspace_id
      and m.active and p.active and w.active
      and p.auth_user_id = (select auth.uid())
      and (
        (select (auth.jwt()->>'is_anonymous')::boolean) is false
        or w.kind = 'DEMO'
      )
  ));

create policy workspace_technicians_read_member
  on public.workspace_technicians for select to authenticated
  using (exists (
    select 1 from public.workspace_memberships m
    join public.profiles p on p.id = m.profile_id
    join public.workspaces w on w.id = m.workspace_id
    where m.workspace_id = workspace_technicians.workspace_id
      and m.active and p.active and w.active
      and p.auth_user_id = (select auth.uid())
      and (
        (select (auth.jwt()->>'is_anonymous')::boolean) is false
        or w.kind = 'DEMO'
      )
  ));

create policy workspace_orders_read_member
  on public.workspace_orders for select to authenticated
  using (exists (
    select 1 from public.workspace_memberships m
    join public.profiles p on p.id = m.profile_id
    join public.workspaces w on w.id = m.workspace_id
    where m.workspace_id = workspace_orders.workspace_id
      and m.active and p.active and w.active
      and p.auth_user_id = (select auth.uid())
      and (
        (select (auth.jwt()->>'is_anonymous')::boolean) is false
        or w.kind = 'DEMO'
      )
      and (
        m.role in ('ADMIN', 'MANAGER')
        or exists (
          select 1 from public.workspace_technicians t
          where t.workspace_id = workspace_orders.workspace_id
            and t.id = workspace_orders.assigned_technician_id
            and t.profile_id = m.profile_id
            and t.active
        )
      )
  ));

create policy workspace_customers_read_member
  on public.workspace_customers for select to authenticated
  using (exists (
    select 1 from public.workspace_memberships m
    join public.profiles p on p.id = m.profile_id
    join public.workspaces w on w.id = m.workspace_id
    where m.workspace_id = workspace_customers.workspace_id
      and m.active and p.active and w.active
      and p.auth_user_id = (select auth.uid())
      and (
        (select (auth.jwt()->>'is_anonymous')::boolean) is false
        or w.kind = 'DEMO'
      )
      and (
        m.role in ('ADMIN', 'MANAGER')
        or exists (
          select 1 from public.workspace_orders o
          join public.workspace_technicians t
            on t.workspace_id = o.workspace_id
           and t.id = o.assigned_technician_id
          where o.workspace_id = workspace_customers.workspace_id
            and o.customer_id = workspace_customers.id
            and t.profile_id = m.profile_id
            and t.active
        )
      )
  ));
