"""Two-worker, fictional RPC concurrency checks; optional local psycopg required.

Fixed Test target. SQL claims simulate a trusted actor, NOT actual JWT validation.
The ignored recovery manifest is written before fixture commits. Cleanup is exact
ID scoped; quota restoration is guarded against unrelated concurrent changes.
"""
import concurrent.futures
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import uuid

import psycopg
from psycopg import sql

PROJECT = 'qobhjvrrpajoyvlgrkbx'
OWNER = '4a19bb4b-f81b-420f-a834-b9045d86cd07'
DEMO = 'c0bbac19-df6c-4068-87d0-d43c8d860705'
AUTH = '9d673da9-2374-44e2-9931-799a991c656b'
PROFILE = '09847eb5-142b-4712-86d1-7d7d952ff9cd'
LOCK = 4402271611
run = {key: str(uuid.uuid4()) for key in ('id', 'profile', 'tech', 'customer', 'order', 'key', 'visit1', 'visit2')}
run.update(project=PROJECT, cases=[], cleanup='PENDING', quota=None)
manifest = Path('supabase/.temp') / ('redteam-concurrency-' + run['id'] + '.json')


def save():
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text(json.dumps(run, indent=2, default=str), encoding='utf-8')


def connect():
    return psycopg.connect(host='db.' + PROJECT + '.supabase.co', dbname='postgres',
                           user='postgres', password=os.environ['SEJUK_REDTEAM_DB_PASSWORD'],
                           sslmode='require', connect_timeout=8,
                           application_name='sejuk-bounded-redteam',
                           options='-c statement_timeout=12000 -c lock_timeout=8000 -c idle_in_transaction_session_timeout=15000')


def check(value, label):
    if not value:
        raise RuntimeError(label)


def actor(conn, role):
    if role == 'authenticated':
        conn.execute("select set_config('request.jwt.claim.sub', %s, true), set_config('request.jwt.claims', %s, true)",
                     (AUTH, json.dumps({'sub': AUTH, 'role': role, 'is_anonymous': False})))
    conn.execute(sql.SQL('set local role {}').format(sql.Identifier(role)))


def digest(conn):
    # Aggregate inside PostgreSQL; no private row/credential value leaves it.
    tables = conn.execute("select schemaname,tablename from pg_tables where schemaname in ('public','private') order by 1,2").fetchall()
    result = {}
    for schema, table in tables:
        if table in ('guest_ai_budget_policy', 'guest_ai_budget_counter'):
            continue
        query = sql.SQL("select count(*),md5(coalesce(string_agg(md5(row_to_json(t)::text),',' order by md5(row_to_json(t)::text)),'')) from {}.{} t").format(sql.Identifier(schema), sql.Identifier(table))
        result[schema + '.' + table] = conn.execute(query).fetchone()
    result['auth.ids'] = conn.execute("select count(*),md5(string_agg(id::text,',' order by id)) from auth.users").fetchone()
    return result


def pair(case, query, params, role, advisory=False):
    """Hold the actual DB lock until BOTH backends are observed waiting on it."""
    pids, mutex = [], threading.Lock()
    def worker(index):
        try:
            with connect() as conn:
                pid = conn.execute('select pg_backend_pid()').fetchone()[0]
                actor(conn, role)
                with mutex:
                    pids.append(pid)
                value = conn.execute(query, params(index) if callable(params) else params).fetchone()[0]
                return {'status': 'OK', 'value': value}
        except psycopg.Error as error:
            return {'status': 'SQL_ERROR', 'sqlstate': error.sqlstate}
        except Exception:
            return {'status': 'CLIENT_ERROR'}

    with connect() as blocker, connect() as observer:
        if advisory:
            blocker.execute('select pg_advisory_xact_lock(%s)', (LOCK,))
        else:
            blocker.execute('select id from public.workspace_assignment_proposals where workspace_id=%s and id=%s for update', (OWNER, run['proposal']))
        blocker_pid = blocker.execute('select pg_backend_pid()').fetchone()[0]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(worker, index) for index in range(2)]
            observed = False
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                with mutex:
                    ids = list(pids)
                if len(ids) == 2:
                    # Avoid a cached pg_stat_activity transaction snapshot.
                    observer.commit()
                    count = observer.execute("""with recursive chain(root,pid,path) as (
                      select p,p,array[p] from unnest(%s::integer[]) p
                      union all
                      select c.root,b,array_append(c.path,b) from chain c
                      cross join lateral unnest(pg_blocking_pids(c.pid)) b
                      where not b=any(c.path) and cardinality(c.path)<8
                    ) select count(distinct c.root) from chain c
                      join pg_stat_activity a on a.pid=c.root
                      where c.pid=%s and a.wait_event_type='Lock'""", (ids, blocker_pid)).fetchone()[0]
                    if count == 2:
                        observed = True
                        break
                time.sleep(0.05)
            blocker.commit()
            results = [future.result(timeout=15) for future in futures]
        evidence = {'id': case, 'bothBackendsBlocked': observed, 'results': results}
        run['cases'].append(evidence)
        save()
        check(observed, case + '_OVERLAP_NOT_PROVEN')
        return results


def cleanup():
    counter_conflict = False
    policy_conflict = False
    with connect() as conn:
        quota = run['quota']
        if quota:
            conn.execute('select pg_advisory_xact_lock(%s)', (LOCK,))
            limit = conn.execute('select daily_limit from private.guest_ai_budget_policy where singleton').fetchone()[0]
            current = conn.execute('select attempt_count from private.guest_ai_budget_counter where usage_day=%s', (quota['day'],)).fetchone()
            owned = sum(1 for case in run['cases'] if case['id'] == 'RT03' for result in case['results']
                        if result['status'] == 'OK' and result['value']['allowed'])
            if limit == quota['temporaryLimit']:
                # Keep the global lock throughout compare-and-set restoration.
                conn.execute('update private.guest_ai_budget_policy set daily_limit=%s where singleton', (quota['limit'],))
                expected = (quota['used'] + owned,) if quota['rowExisted'] or owned else None
                counter_conflict = current != expected
                if not counter_conflict and quota['rowExisted']:
                    conn.execute('update private.guest_ai_budget_counter set attempt_count=%s where usage_day=%s and attempt_count=%s', (quota['used'], quota['day'], quota['used'] + owned))
                elif not counter_conflict and owned:
                    conn.execute('delete from private.guest_ai_budget_counter where usage_day=%s and attempt_count=%s', (quota['day'], owned))
                quota['restored'] = not counter_conflict
            elif limit == quota['limit'] and not quota.get('applied'):
                # Fixture transaction rolled back before commit; nothing to undo.
                quota['restored'] = True
            else:
                # Never overwrite someone else's policy; still delete our fixtures.
                policy_conflict = True
        # Every deletion targets freshly generated IDs, never the permanent Owner.
        if run.get('proposal'):
            conn.execute('delete from public.workspace_assignment_proposal_audit where workspace_id=%s and proposal_id=%s', (OWNER, run['proposal']))
            conn.execute('delete from public.workspace_assignment_proposals where workspace_id=%s and id=%s', (OWNER, run['proposal']))
        for table in ('workspace_order_manual_audit', 'workspace_order_activity_audit', 'workspace_order_schedule_audit'):
            conn.execute(sql.SQL('delete from private.{} where workspace_id=%s and order_id=%s').format(sql.Identifier(table)), (OWNER, run['order']))
        conn.execute('delete from public.workspace_orders where workspace_id=%s and id=%s and order_no=%s', (OWNER, run['order'], 'RT-' + run['id']))
        conn.execute('delete from public.workspace_customers where workspace_id=%s and id=%s', (OWNER, run['customer']))
        conn.execute('delete from public.workspace_technicians where workspace_id=%s and id=%s and profile_id=%s', (OWNER, run['tech'], run['profile']))
        conn.execute('delete from public.workspace_memberships where workspace_id=%s and profile_id=%s', (OWNER, run['profile']))
        conn.execute('delete from public.profiles where id=%s and auth_user_id is null and display_name=%s', (run['profile'], 'RT fictional ' + run['id']))
        conn.execute('delete from public.guest_visits where workspace_id=%s and id in (%s,%s)', (DEMO, run['visit1'], run['visit2']))
    run['cleanup'] = 'POLICY_CONFLICT' if policy_conflict else ('COUNTER_CONFLICT' if counter_conflict else 'RESTORED')
    save()
    check(not counter_conflict, 'QUOTA_COUNTER_CHANGED_RESTORE_BLOCKED')
    check(not policy_conflict, 'QUOTA_POLICY_CHANGED_RESTORE_BLOCKED')


def main():
    check(sys.argv[1:] == ['--allow-live'], 'EXPLICIT_OPT_IN_REQUIRED')
    check(bool(os.environ.get('SEJUK_REDTEAM_DB_PASSWORD')), 'DATABASE_CREDENTIAL_REQUIRED')
    run['version'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    save()
    before = None
    try:
        with connect() as conn:
            before = digest(conn)
            check(conn.execute("select count(*) from public.workspaces where (id=%s and kind='OWNER' and active) or (id=%s and kind='DEMO' and active)", (OWNER, DEMO)).fetchone()[0] == 2, 'WORKSPACE_BOUNDARY')
            check(conn.execute("select count(*) from public.profiles p join public.workspace_memberships m on m.profile_id=p.id join auth.users u on u.id=p.auth_user_id where p.id=%s and u.id=%s and u.is_anonymous is false and p.active and not p.demo_principal and m.workspace_id=%s and m.active and m.role='ADMIN'", (PROFILE, AUTH, OWNER)).fetchone()[0] == 1, 'OWNER_ACTOR_BOUNDARY')
            branch = conn.execute('select id from public.workspace_branches where workspace_id=%s and active order by id limit 1', (OWNER,)).fetchone()[0]
            generation = conn.execute('select generation from public.workspaces where id=%s', (DEMO,)).fetchone()[0]
            conn.execute("insert into public.profiles(id,display_name,role,active) values(%s,%s,'TECHNICIAN',true)", (run['profile'], 'RT fictional ' + run['id']))
            conn.execute("insert into public.workspace_memberships(workspace_id,profile_id,role,active) values(%s,%s,'TECHNICIAN',true)", (OWNER, run['profile']))
            conn.execute('insert into public.workspace_technicians(workspace_id,id,profile_id,branch_id) values(%s,%s,%s,%s)', (OWNER, run['tech'], run['profile'], branch))
            conn.execute("insert into public.workspace_customers(workspace_id,id,name,address) values(%s,%s,'RT fictional customer','RT fictional address')", (OWNER, run['customer']))
            updated = conn.execute("insert into public.workspace_orders(workspace_id,id,order_no,branch_id,customer_id,problem_description,service_type,created_by_profile_id) values(%s,%s,%s,%s,%s,'RT fictional repair','RT',%s) returning updated_at", (OWNER, run['order'], 'RT-' + run['id'], branch, run['customer'], PROFILE)).fetchone()[0]
            for visit in ('visit1', 'visit2'):
                token_hash = hashlib.sha256(os.urandom(32)).hexdigest()
                conn.execute("insert into public.guest_visits(id,token_hash,workspace_id,persona,demo_generation,expires_at) values(%s,%s,%s,'ADMIN',%s,clock_timestamp()+interval '10 minutes')", (run[visit], token_hash, DEMO, generation))
            actor(conn, 'authenticated')
            proposal = conn.execute('select to_jsonb(public.workspace_assignment_proposal_create(%s,%s,%s,%s,null,%s))', (OWNER, run['order'], run['tech'], updated, run['key'])).fetchone()[0]
            run['proposal'] = proposal['id']
            save()  # IDs are recoverable before the transaction commits.
        approved = pair('RT01', 'select to_jsonb(public.workspace_assignment_proposal_approve(%s,%s,%s))', (OWNER, run['proposal'], AUTH), 'service_role')
        check(sum(r['status'] == 'OK' and r['value']['status'] == 'APPROVED' for r in approved) == 1 and sum(r.get('sqlstate') == 'P0001' for r in approved) == 1, 'RT01_SINGLE_APPROVAL')
        executed = pair('RT02', 'select to_jsonb(public.workspace_assignment_proposal_execute(%s,%s))', (OWNER, run['proposal']), 'authenticated')
        check(all(r['status'] == 'OK' and r['value']['status'] == 'EXECUTED' for r in executed), 'RT02_IDEMPOTENT_EXECUTION')
        check(executed[0]['value']['result_order_updated_at'] == executed[1]['value']['result_order_updated_at'], 'RT02_SAME_DURABLE_RESULT')
        with connect() as conn:
            audit = dict(conn.execute('select event_type,count(*) from public.workspace_assignment_proposal_audit where workspace_id=%s and proposal_id=%s group by event_type', (OWNER, run['proposal'])).fetchall())
            manual = conn.execute("select count(*) from private.workspace_order_manual_audit where workspace_id=%s and order_id=%s and event_type='ASSIGN'", (OWNER, run['order'])).fetchone()[0]
            # Proposal execution has its own audit, not the manual-command audit.
            check(audit == {'PROPOSED': 1, 'APPROVED': 1, 'EXECUTED': 1} and manual == 0, 'RT02_ONE_EXECUTION_AUDIT')
            order = conn.execute('select status,assigned_technician_id,updated_at from public.workspace_orders where workspace_id=%s and id=%s', (OWNER, run['order'])).fetchone()
            check(order[0] == 'ASSIGNED' and str(order[1]) == run['tech'] and order[2] == datetime.fromisoformat(executed[0]['value']['result_order_updated_at']), 'RT02_DURABLE_ORDER_MATCH')
            run['executionAudit'] = {'proposal': audit, 'manualAuditRows': manual, 'durableOrderMatchesResult': True}
            actor(conn, 'authenticated')
            replay = conn.execute('select to_jsonb(public.workspace_assignment_proposal_execute(%s,%s))', (OWNER, run['proposal'])).fetchone()[0]
            check(replay == executed[0]['value'], 'RT02_SERIAL_REPLAY_UNCHANGED')
        with connect() as conn:
            conn.execute('select pg_advisory_xact_lock(%s)', (LOCK,))
            day, seconds = conn.execute("select (clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date, extract(epoch from (((clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date+1)::timestamp at time zone 'Asia/Kuala_Lumpur')-clock_timestamp())").fetchone()
            check(seconds > 120, 'MIDNIGHT_WINDOW_OUT_OF_SCOPE')
            limit = conn.execute('select daily_limit from private.guest_ai_budget_policy where singleton').fetchone()[0]
            counter = conn.execute('select attempt_count from private.guest_ai_budget_counter where usage_day=%s', (day,)).fetchone()
            used = counter[0] if counter else 0
            check(used < 999, 'QUOTA_FIXTURE_LIMIT')
            run['quota'] = {'day': str(day), 'limit': limit, 'used': used, 'rowExisted': counter is not None, 'temporaryLimit': used + 1, 'applied': False}
            save()
            conn.execute('update private.guest_ai_budget_policy set daily_limit=%s where singleton', (used + 1,))
        run['quota']['applied'] = True
        save()
        reserved = pair('RT03', 'select public.guest_ai_budget_reserve(%s,%s,%s)', lambda index: (run['visit1' if index == 0 else 'visit2'], DEMO, generation), 'service_role', advisory=True)
        check(all(r['status'] == 'OK' for r in reserved) and sum(r['value']['allowed'] for r in reserved) == 1, 'RT03_ONE_LAST_SLOT')
        check(all(r['value']['used'] == used + 1 and r['value']['remaining'] == 0 for r in reserved), 'RT03_NO_OVERSPEND')
        run['decision'] = 'PROCEED'
    finally:
        cleanup()
        if before is not None:
            with connect() as conn:
                check(digest(conn) == before, 'UNRELATED_DATA_CHANGED')
                quota = run['quota']
                if quota:
                    check(conn.execute('select daily_limit from private.guest_ai_budget_policy where singleton').fetchone()[0] == quota['limit'], 'POLICY_RESTORE')
                    current = conn.execute('select attempt_count from private.guest_ai_budget_counter where usage_day=%s', (quota['day'],)).fetchone()
                    check(current == ((quota['used'],) if quota['rowExisted'] else None), 'COUNTER_RESTORE')
            run['unrelatedDataUnchanged'] = True
        save()
    print(json.dumps({'decision': run['decision'], 'cases': [dict(id=c['id'], bothBackendsBlocked=c['bothBackendsBlocked']) for c in run['cases']], 'executionAudit': run['executionAudit'], 'cleanup': run['cleanup'], 'unrelatedDataUnchanged': run['unrelatedDataUnchanged'], 'manifest': str(manifest)}, ensure_ascii=True))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        run['decision'] = 'REPAIR'
        run['error'] = error.sqlstate if isinstance(error, psycopg.Error) else (str(error) if isinstance(error, RuntimeError) else type(error).__name__)
        save()
        print(json.dumps({'decision': 'REPAIR', 'error': run['error'], 'cleanup': run['cleanup'], 'manifest': str(manifest)}))
        sys.exit(1)
