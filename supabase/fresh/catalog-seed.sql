-- Fixed configuration for an empty post-retirement schema. Run once after
-- the schema-only baseline and before p1-bootstrap-fresh.mjs. No Test IDs,
-- Auth users, provider secrets, customer records, or orders belong here.
begin;

insert into public.workspaces (kind, name)
values ('DEMO', 'Demo'), ('OWNER', 'Owner')
on conflict (kind) do nothing;

insert into public.workspace_branches (workspace_id, code, name, address)
select id, 'DEMO-HQ', 'Demo Service Hub', 'Fictional service area'
from public.workspaces where kind = 'DEMO' and active
on conflict (workspace_id, code) do nothing;

insert into public.workspace_branches (workspace_id, code, name)
select id, 'OWNER-HQ', 'Owner Service Hub'
from public.workspaces where kind = 'OWNER' and active
on conflict (workspace_id, code) do nothing;

insert into private.guest_ai_budget_policy (singleton, daily_limit)
values (true, 20)
on conflict (singleton) do nothing;

commit;
