// Exact-ID fixture ledger and SQL for the single reviewed Test acceptance batch.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
export const TEST_REF = "qobhjvrrpajoyvlgrkbx";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function id(value) { if (!uuidPattern.test(value)) throw new Error("Fixture UUID invalid"); return value; }
export function literal(value) { if (typeof value !== "string" || value.length > 200 || /[\0\r\n]/.test(value)) throw new Error("Fixture text invalid"); return `'${value.replaceAll("'", "''")}'`; }
const ids = (values) => `array[${values.map((value) => `${literal(id(value))}::uuid`).join(",")}]::uuid[]`;
export function validateLedger(ledger) {
  id(ledger.runId); id(ledger.workspaceId); id(ledger.owner.authUserId); id(ledger.owner.profileId);
  if (ledger.projectRef !== TEST_REF || ledger.marker !== `accept-${ledger.runId}` || ledger.users.length > 7 || ledger.branches.length > 2 || ledger.customers.length > 2 || ledger.orders.length > 4 || ledger.imports.length > 4 || ledger.operations.length > 7 || ledger.resets.length > 2) throw new Error("Fixture budget or resource mismatch");
  const allowedEmail = new RegExp(`^accept-${ledger.runId}-(owner|admin|manager|tech-a|tech-b|import-a|import-b)@example\\.invalid$`);
  if (new Set(ledger.users.map((row) => row.email)).size !== ledger.users.length || new Set(ledger.operations).size !== ledger.operations.length) throw new Error("Duplicate fixture identity");
  for (const field of ["authUserId", "profileId"]) { const values = ledger.users.map((row) => row[field]).filter(Boolean); if (new Set(values).size !== values.length) throw new Error("Duplicate fixture identity UUID"); }
  for (const user of ledger.users) { if (!allowedEmail.test(user.email) || user.email !== `${ledger.marker}-${user.label}@example.invalid`) throw new Error("Fixture email mismatch"); if (Boolean(user.authUserId) !== Boolean(user.profileId)) throw new Error("Incomplete fixture identity pair"); if (user.authUserId) id(user.authUserId); if (user.profileId) id(user.profileId); if (user.operationId && !ledger.operations.includes(id(user.operationId))) throw new Error("Untracked staff operation"); }
  const owner = ledger.users.find((row) => row.label === "owner");
  if (owner && (owner.authUserId !== ledger.owner.authUserId || owner.profileId !== ledger.owner.profileId)) throw new Error("Reserved Owner identity pair mismatch");
  for (const row of [...ledger.branches, ...ledger.customers]) id(row.id);
  for (const row of ledger.orders) { if (row.id) id(row.id); id(row.createdByProfileId); if (!ledger.users.some((user) => user.profileId === row.createdByProfileId) || !row.orderNo.startsWith(ledger.marker + "-")) throw new Error("Order marker or creator mismatch"); }
  for (const value of [...ledger.operations, ...ledger.resets, ...ledger.imports]) id(value);
}
export async function persistLedger(file, ledger) { validateLedger(ledger); const temporary = `${file}.tmp`; await fs.writeFile(temporary, JSON.stringify(ledger, null, 2), { mode: 0o600 }); await fs.rename(temporary, file); }
export function newLedger(runId, workspaceId) {
  return { version: 1, projectRef: TEST_REF, runId: id(runId), marker: `accept-${runId}`, workspaceId: id(workspaceId), startedAt: new Date().toISOString(), state: "PLANNED", owner: { authUserId: randomUUID(), profileId: randomUUID() }, users: [], branches: [], customers: [], orders: [], operations: [], resets: [], imports: [], baseline: null };
}
export async function sql(environment, statement, { readOnly = false, timeout = 30_000 } = {}) {
  const command = process.platform === "win32" ? "C:/Program Files/PostgreSQL/17/bin/psql.exe" : "psql";
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["--no-psqlrc", "--no-password", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-h", `db.${TEST_REF}.supabase.co`, "-U", "postgres", "-d", "postgres", "-f", "-"], { windowsHide: true, env: { ...process.env, PGPASSWORD: environment.SUPABASE_DB_PASSWORD, PGSSLMODE: "require", PGCONNECT_TIMEOUT: "10", PGOPTIONS: `-c statement_timeout=20000${readOnly ? " -c default_transaction_read_only=on" : ""}` }, stdio: ["pipe", "pipe", "pipe"] });
    let output = ""; let size = 0;
    const timer = setTimeout(() => { child.kill(); reject(new Error("Fixture SQL timeout")); }, timeout);
    child.stdout.on("data", (chunk) => { size += chunk.length; if (size > 500_000) child.kill(); else output += chunk; });
    // Database diagnostics are deliberately discarded: no SQL/body/credential logs.
    child.stderr.on("data", () => {});
    child.on("error", () => { clearTimeout(timer); reject(new Error("Fixture SQL unavailable")); });
    child.on("close", (code) => { clearTimeout(timer); if (code !== 0 || size > 500_000) reject(new Error("Fixture SQL rejected")); else resolve(output.trim()); });
    child.stdin.end(statement);
  });
}
export const baselineSql = `do $$ declare r record; v jsonb := '{}'::jsonb; h text; n bigint; begin
  for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','p') order by 1,2 loop
    execute format('select count(*),md5(coalesce(string_agg(row_to_json(t)::text,E''\\n'' order by row_to_json(t)::text),'''')) from %I.%I t',r.nspname,r.relname) into n,h;
    v := v || jsonb_build_object(r.nspname||'.'||r.relname,jsonb_build_object('count',n,'hash',h));
  end loop;
  perform set_config('accept.baseline',v::text,false);
end $$; select jsonb_build_object('tables',current_setting('accept.baseline')::jsonb,'authIds',(select coalesce(jsonb_agg(id order by id),'[]'::jsonb) from auth.users),'authHash',(select md5(coalesce(string_agg(jsonb_build_object('id',id,'email',email,'app',raw_app_meta_data,'user',raw_user_meta_data,'password',encrypted_password)::text,E'\\n' order by id),'')) from auth.users),'ownerWorkspaces',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'generation',generation) order by id),'[]'::jsonb) from public.workspaces where kind='OWNER' and active));`;
export function setupSql(ledger) {
  validateLedger(ledger); const ws = literal(ledger.workspaceId); const owner = ledger.users.find((row) => row.label === "owner");
  if (!owner || ledger.branches.length !== 2 || ledger.customers.length !== 2) throw new Error("Fixture setup incomplete");
  return `begin; set local lock_timeout='5s';
    do $$ begin if not exists(select 1 from auth.users where id=${literal(ledger.owner.authUserId)}::uuid and email=${literal(owner.email)} and raw_app_meta_data->>'sejukops_acceptance_run'=${literal(ledger.runId)}) then raise exception 'fixture Owner mismatch'; end if; end $$;
    insert into public.profiles(id,auth_user_id,display_name,role,platform_role) values(${literal(ledger.owner.profileId)}::uuid,${literal(ledger.owner.authUserId)}::uuid,${literal(ledger.marker + " Owner")},'ADMIN','SUPER_ADMIN');
    insert into public.workspace_memberships(workspace_id,profile_id,role) values(${ws}::uuid,${literal(ledger.owner.profileId)}::uuid,'ADMIN');
    insert into public.workspace_branches(workspace_id,id,code,name) values ${ledger.branches.map((row) => `(${ws}::uuid,${literal(row.id)}::uuid,${literal(row.code)},${literal(row.name)})`).join(",")};
    insert into public.workspace_customers(workspace_id,id,name,address) values ${ledger.customers.map((row) => `(${ws}::uuid,${literal(row.id)}::uuid,${literal(row.name)},'Fictional acceptance address')`).join(",")}; commit;`;
}
// Reuses only the four identities from the cleaned, already authorized batch.
// FAILED rows reserve their old IDs; the UI must still run real Auth creation
// and the unchanged Owner/session-authorized reserve/finalize product flow.
export function reseedProvisioningSql(ledger) {
  validateLedger(ledger);
  const reviewed = {
    runId: "fe33e24d-2790-467f-bbf6-4ce8538704f5",
    workspaceId: "4a19bb4b-f81b-420f-a834-b9045d86cd07",
    ownerAuthUserId: "aa044039-54af-4709-9477-649935e14f53",
    ownerProfileId: "c44cc010-468a-455f-b54a-6488ebae1680",
    branches: [
      { id: "f95f7fd8-633b-472f-a839-03b1909a4318", code: "AC_fe33e24d_A" },
      { id: "1f117acf-b505-455a-ab66-2921ba97b9f7", code: "AC_fe33e24d_B" },
    ],
    staff: [
      { label: "admin", role: "ADMIN", branchCode: null, authUserId: "8b9e8aae-4562-41b9-879d-6bf64fe68b2d", profileId: "4f2c3f5b-cee3-4e3b-8184-df0ea4fa1aac", operationId: "42a3d4d6-0ef5-4ac2-8038-5e9a2ad65034" },
      { label: "manager", role: "MANAGER", branchCode: null, authUserId: "70549968-781c-442e-bd62-8bf0bc4e86fe", profileId: "549286fc-4de6-4feb-85a1-b01e3ea57144", operationId: "13c4907e-4fcc-42ab-948f-99d6afd070ee" },
      { label: "tech-a", role: "TECHNICIAN", branchCode: "AC_fe33e24d_A", authUserId: "e61d099b-9ffb-4bce-908e-fa7f23799300", profileId: "d99433c3-98eb-4b98-b7ca-e154551f80d8", operationId: "b408a921-ece2-4785-9f68-ab06b7d8a040" },
      { label: "tech-b", role: "TECHNICIAN", branchCode: "AC_fe33e24d_B", authUserId: "39ecabab-ad9e-4bcd-a65e-6ecb3ef6060a", profileId: "06410855-a2c1-495c-a64b-098fe7bd27d9", operationId: "871e68d1-940c-4856-b68f-6c244d2c9caf" },
    ],
  };
  const owner = ledger.users.find((row) => row.label === "owner");
  if (ledger.runId !== reviewed.runId || ledger.workspaceId !== reviewed.workspaceId
    || ledger.owner.authUserId !== reviewed.ownerAuthUserId || ledger.owner.profileId !== reviewed.ownerProfileId
    || !owner || ledger.imports.length !== 0 || ledger.resets.length !== 0 || ledger.operations.length !== 4
    || ledger.branches.length !== 2 || !reviewed.branches.every((expected) => ledger.branches.some((row) => row.id === expected.id && row.code === expected.code))
    || ledger.users.filter((row) => row.authUserId).length !== 5
    || ledger.users.some((row) => !["owner", "admin", "manager", "tech-a", "tech-b", "import-a", "import-b"].includes(row.label)
      || (["import-a", "import-b"].includes(row.label) && (row.authUserId || row.profileId || row.operationId)))
    || owner.operationId
    || !reviewed.staff.every((expected) => {
      const actual = ledger.users.find((row) => row.label === expected.label);
      return actual && actual.authUserId === expected.authUserId && actual.profileId === expected.profileId
        && actual.operationId === expected.operationId && ledger.operations.includes(expected.operationId);
    })) throw new Error("Only the four reviewed cleaned staff identity pairs may be reseeded");
  const staff = reviewed.staff.map((row) => ({ ...row,
    email: `${ledger.marker}-${row.label}@example.invalid`,
    input: { name: `${ledger.marker} ${row.label}`, email: `${ledger.marker}-${row.label}@example.invalid`, role: row.role, branchCode: row.branchCode },
  }));
  const emails = `array[${staff.map((row) => literal(row.email)).join(",")}]::text[]`;
  const authIds = ids(staff.map((row) => row.authUserId));
  const profileIds = ids(staff.map((row) => row.profileId));
  const operationIds = ids(staff.map((row) => row.operationId));
  const ws = `${literal(ledger.workspaceId)}::uuid`;
  const ownerProfile = `${literal(ledger.owner.profileId)}::uuid`;
  return `begin; set local lock_timeout='5s'; set local statement_timeout='20s';
    do $$ declare v_now timestamptz := clock_timestamp(); v_email text; begin
      perform 1 from public.profiles p join auth.users u on u.id=p.auth_user_id
        join public.workspace_memberships m on m.profile_id=p.id and m.workspace_id=${ws}
        join public.workspaces w on w.id=m.workspace_id
        where p.id=${ownerProfile} and p.auth_user_id=${literal(ledger.owner.authUserId)}::uuid
          and p.display_name=${literal(ledger.marker + " Owner")} and p.active and not p.demo_principal
          and p.platform_role='SUPER_ADMIN' and m.active and m.role='ADMIN' and w.active and w.kind='OWNER'
          and u.email=${literal(owner.email)} and u.is_anonymous is false and u.email_confirmed_at is not null
          and u.raw_app_meta_data->>'sejukops_acceptance_run'=${literal(ledger.runId)} for share of p,m,w;
      if not found then raise exception 'fixture reseed Owner mismatch'; end if;
      ${reviewed.branches.map((row) => `perform 1 from public.workspace_branches where id=${literal(row.id)}::uuid and workspace_id=${ws} and code=${literal(row.code)} and active for share;
      if not found then raise exception 'fixture reseed branch mismatch'; end if;`).join("\n      ")}
      for v_email in select unnest(${emails}) order by 1 loop
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staff-email:'||v_email,0));
      end loop;
      if exists(select 1 from auth.users where id=any(${authIds}) or lower(btrim(email))=any(${emails}))
        or exists(select 1 from public.profiles where id=any(${profileIds}) or auth_user_id=any(${authIds}))
        or exists(select 1 from private.staff_accounts where profile_id=any(${profileIds}) or auth_user_id=any(${authIds}) or email=any(${emails}))
        or exists(select 1 from private.staff_provisioning where id=any(${operationIds}) or email=any(${emails})
          or target_auth_user_id=any(${authIds}) or target_profile_id=any(${profileIds})) then
        raise exception 'fixture reseed identity or reservation already exists'; end if;
      insert into private.staff_provisioning(id,owner_profile_id,workspace_id,input_hash,email,target_auth_user_id,target_profile_id,
        input,state,claim_expires_at,last_error_code,created_at,updated_at)
        select r.operation_id,${ownerProfile},${ws},encode(extensions.digest(r.input::text,'sha256'),'hex'),r.input->>'email',
          r.auth_user_id,r.profile_id,r.input,'FAILED',v_now+interval '2 minutes','PROVISIONING_FAILED',v_now,v_now
        from (values ${staff.map((row) => `(${literal(row.operationId)}::uuid,${literal(row.authUserId)}::uuid,${literal(row.profileId)}::uuid,jsonb_build_object('name',${literal(row.input.name)},'email',${literal(row.input.email)},'role',${literal(row.input.role)},'branchCode',${row.input.branchCode === null ? "null::text" : literal(row.input.branchCode)}))`).join(",")}) r(operation_id,auth_user_id,profile_id,input);
    end $$; commit;`;
}
export function reconcileSql(ledger) {
  validateLedger(ledger);
  return `select jsonb_build_object('provisioning',(select coalesce(jsonb_agg(jsonb_build_object('operationId',id,'authUserId',target_auth_user_id,'profileId',target_profile_id,'email',email)),'[]') from private.staff_provisioning where id=any(${ids(ledger.operations)}) and owner_profile_id=${literal(ledger.owner.profileId)}::uuid and workspace_id=${literal(ledger.workspaceId)}::uuid),'orders',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'orderNo',order_no,'createdByProfileId',created_by_profile_id)),'[]') from public.workspace_orders where workspace_id=${literal(ledger.workspaceId)}::uuid and order_no=any(array[${ledger.orders.map((row) => literal(row.orderNo)).join(",")}]::text[]) and created_by_profile_id=any(${ids(ledger.users.map((row) => row.profileId).filter(Boolean))})));`;
}
export function cleanupSql(ledger) {
  validateLedger(ledger);
  const profiles = ids(ledger.users.map((row) => row.profileId).filter(Boolean));
  const auth = ids(ledger.users.map((row) => row.authUserId).filter(Boolean));
  const orders = ids(ledger.orders.map((row) => row.id).filter(Boolean));
  const ws = `${literal(ledger.workspaceId)}::uuid`;
  const pairs = ledger.users.filter((row) => row.authUserId).map((row) => `(${literal(row.profileId)}::uuid,${literal(row.authUserId)}::uuid,${literal(row.email)},${literal(ledger.marker + " " + (row.label === "owner" ? "Owner" : row.label))})`).join(",");
  const orderPairs = ledger.orders.filter((row) => row.id).map((row) => `(${literal(row.id)}::uuid,${literal(row.orderNo)},${literal(row.createdByProfileId)}::uuid)`).join(",");
  // All predicates use the tracked exact UUID sets. Identity validation runs first
  // in the same transaction; any mismatch rolls the entire cleanup back.
  return `begin; set local lock_timeout='5s';
    do $$ declare r record; begin
      for r in select * from auth.users where id=any(${auth}) loop
        if not exists(select 1 from (values ${pairs}) expected(profile_id,auth_user_id,email,display_name) where expected.auth_user_id=r.id and expected.email=r.email) then raise exception 'fixture Auth identity pair mismatch'; end if;
        if r.id=${literal(ledger.owner.authUserId)}::uuid then
          if r.raw_app_meta_data->>'sejukops_acceptance_run' is distinct from ${literal(ledger.runId)} then raise exception 'fixture Owner marker mismatch'; end if;
        elsif not exists(select 1 from private.staff_provisioning p where p.id=any(${ids(ledger.operations)}) and p.target_auth_user_id=r.id and p.owner_profile_id=${literal(ledger.owner.profileId)}::uuid and p.email=r.email and r.raw_app_meta_data->>'sejukops_staff_operation'=p.id::text) then raise exception 'fixture staff operation mismatch'; end if;
      end loop;
      if exists(select 1 from public.profiles p where p.id=any(${profiles}) and not exists(select 1 from (values ${pairs}) expected(profile_id,auth_user_id,email,display_name) where expected.profile_id=p.id and expected.auth_user_id=p.auth_user_id and expected.display_name=p.display_name)) then raise exception 'fixture profile pair mismatch'; end if;
      ${orderPairs ? `if exists(select 1 from public.workspace_orders o where o.id=any(${orders}) and (o.workspace_id is distinct from ${ws} or not exists(select 1 from (values ${orderPairs}) expected(id,order_no,creator) where expected.id=o.id and expected.order_no=o.order_no and expected.creator=o.created_by_profile_id))) then raise exception 'fixture order pair mismatch'; end if;` : ""}
      if exists(select 1 from public.workspace_branches where id=any(${ids(ledger.branches.map((row) => row.id))}) and (workspace_id<>${ws} or name<>all(array[${ledger.branches.map((row) => literal(row.name)).join(",")}]::text[]))) then raise exception 'fixture branch mismatch'; end if;
      if exists(select 1 from public.workspace_customers where id=any(${ids(ledger.customers.map((row) => row.id))}) and (workspace_id<>${ws} or name<>all(array[${ledger.customers.map((row) => literal(row.name)).join(",")}]::text[]))) then raise exception 'fixture customer mismatch'; end if;
      if exists(select 1 from private.staff_imports where id=any(${ids(ledger.imports)}) and (owner_profile_id is distinct from ${literal(ledger.owner.profileId)}::uuid or workspace_id is distinct from ${ws})) then raise exception 'fixture import mismatch'; end if;
      if exists(select 1 from private.staff_provisioning p where p.id=any(${ids(ledger.operations)}) and (p.owner_profile_id<>${literal(ledger.owner.profileId)}::uuid or p.workspace_id<>${ws} or not exists(select 1 from (values ${pairs}) expected(profile_id,auth_user_id,email,display_name) where expected.profile_id=p.target_profile_id and expected.auth_user_id=p.target_auth_user_id and expected.email=p.email and expected.display_name=p.input->>'name'))) then raise exception 'fixture operation pair mismatch'; end if;
      if exists(select 1 from private.staff_password_resets p where p.id=any(${ids(ledger.resets)}) and (p.owner_profile_id is distinct from ${literal(ledger.owner.profileId)}::uuid or p.workspace_id is distinct from ${ws} or not exists(select 1 from (values ${pairs}) expected(profile_id,auth_user_id,email,display_name) where expected.profile_id=p.profile_id and expected.auth_user_id=p.auth_user_id))) then raise exception 'fixture reset pair mismatch'; end if;
    end $$;
    delete from private.owner_previews where owner_profile_id=${literal(ledger.owner.profileId)}::uuid and auth_user_id=${literal(ledger.owner.authUserId)}::uuid;
    delete from public.workspace_assignment_proposal_audit where workspace_id=${ws} and target_order_id=any(${orders}) and initiator_profile_id=any(${profiles});
    delete from public.workspace_assignment_proposals where workspace_id=${ws} and target_order_id=any(${orders}) and initiated_by_profile_id=any(${profiles});
    delete from private.workspace_order_manual_audit where workspace_id=${ws} and order_id=any(${orders}) and actor_profile_id=any(${profiles});
    delete from private.workspace_order_schedule_audit where workspace_id=${ws} and order_id=any(${orders}) and actor_profile_id=any(${profiles});
    delete from private.workspace_order_activity_audit where workspace_id=${ws} and order_id=any(${orders}) and actor_profile_id=any(${profiles});
    delete from public.workspace_orders where workspace_id=${ws} and id=any(${orders});
    delete from private.staff_import_rows where import_id=any(${ids(ledger.imports)});
    delete from private.staff_imports where id=any(${ids(ledger.imports)}) and owner_profile_id=${literal(ledger.owner.profileId)}::uuid;
    delete from private.staff_password_resets where id=any(${ids(ledger.resets)}) and owner_profile_id=${literal(ledger.owner.profileId)}::uuid;
    delete from private.staff_provisioning where id=any(${ids(ledger.operations)}) and owner_profile_id=${literal(ledger.owner.profileId)}::uuid;
    delete from public.workspace_technicians where workspace_id=${ws} and profile_id=any(${profiles});
    delete from public.workspace_memberships where workspace_id=${ws} and profile_id=any(${profiles});
    delete from private.staff_accounts where workspace_id=${ws} and profile_id=any(${profiles});
    delete from public.audit_logs where actor_profile_id=any(${profiles});
    delete from public.profiles where id=any(${profiles}) and auth_user_id=any(${auth});
    delete from public.workspace_customers where workspace_id=${ws} and id=any(${ids(ledger.customers.map((row) => row.id))});
    delete from public.workspace_branches where workspace_id=${ws} and id=any(${ids(ledger.branches.map((row) => row.id))});
    commit;`;
}
export function ledgerPath(root, runId) { return path.join(root, ".agent", `staff-live-${id(runId)}.local.json`); }
