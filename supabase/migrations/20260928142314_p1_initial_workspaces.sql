-- P1 initial workspace catalog only. Auth users, profiles, memberships, and
-- operational records are deliberately not created by this migration.
-- Keep public entry disabled while legacy global-role RLS and Storage paths
-- remain reachable through the assessment-era application.

-- The existing partial index enforces one Demo workspace. The full unique
-- index also enforces one Owner workspace and is the conflict target below.
create unique index workspaces_one_per_kind_idx
  on public.workspaces (kind);

-- IDs come from the table default, not a hardcoded deployment-specific UUID.
-- Re-running this data step leaves existing workspace IDs and names intact.
insert into public.workspaces (kind, name)
values
  ('DEMO', 'Demo'),
  ('OWNER', 'Owner')
on conflict (kind) do nothing;
