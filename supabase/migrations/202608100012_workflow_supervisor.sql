-- Phase 8: deterministic Workflow Supervisor rules and optional, auditable AI
-- explanations. Rule generation is atomic with the order transition to JOB_DONE.

create table public.workflow_supervisor_settings (
  id boolean primary key default true check (id),
  amount_variance_ratio numeric(8, 4) not null default 0.50
    check (amount_variance_ratio >= 0),
  amount_variance_minimum numeric(12, 2) not null default 100
    check (amount_variance_minimum >= 0),
  unusual_extra_charge_ratio numeric(8, 4) not null default 1.00
    check (unusual_extra_charge_ratio >= 0),
  unusual_extra_charge_minimum numeric(12, 2) not null default 250
    check (unusual_extra_charge_minimum >= 0),
  updated_at timestamptz not null default now()
);

comment on column public.workflow_supervisor_settings.amount_variance_ratio is
  'HIGH_AMOUNT_VARIANCE threshold: variance must be >= 50% and >= RM100 by default.';
comment on column public.workflow_supervisor_settings.unusual_extra_charge_ratio is
  'UNUSUAL_EXTRA_CHARGE threshold: extra charge is >= 100% of quote or >= RM250 by default.';

insert into public.workflow_supervisor_settings (id) values (true)
on conflict (id) do nothing;

alter table public.workflow_supervisor_settings enable row level security;

alter table public.ai_flags
  add column completion_revision integer not null default 1
    check (completion_revision > 0),
  add column severity text not null default 'WARNING'
    check (severity in ('WARNING', 'CRITICAL')),
  add column title text not null default 'Workflow review required'
    check (btrim(title) <> ''),
  add column deterministic_summary text not null default 'Review the deterministic workflow facts.'
    check (btrim(deterministic_summary) <> ''),
  add column explanation_status text not null default 'NOT_REQUESTED'
    check (explanation_status in ('NOT_REQUESTED', 'AVAILABLE', 'UNAVAILABLE')),
  add column explanation_summary text,
  add column explanation_recommendation text,
  add column explanation_error_code text,
  add column explanation_generated_at timestamptz,
  add column explanation_provider_config_id uuid
    references public.ai_provider_configs(id) on delete set null,
  add column updated_at timestamptz not null default now(),
  add constraint ai_flags_explanation_state_consistent check (
    (explanation_status = 'NOT_REQUESTED'
      and explanation_summary is null
      and explanation_recommendation is null
      and explanation_error_code is null
      and explanation_generated_at is null)
    or (explanation_status = 'AVAILABLE'
      and nullif(btrim(explanation_summary), '') is not null
      and nullif(btrim(explanation_recommendation), '') is not null
      and explanation_error_code is null
      and explanation_generated_at is not null)
    or (explanation_status = 'UNAVAILABLE'
      and explanation_summary is null
      and explanation_recommendation is null
      and nullif(btrim(explanation_error_code), '') is not null
      and explanation_generated_at is not null)
  );

create table public.workflow_flag_explanation_requests (
  request_key uuid primary key,
  flag_id uuid not null references public.ai_flags(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'AVAILABLE', 'UNAVAILABLE')),
  outcome jsonb,
  started_at timestamptz not null default now(),
  lease_expires_at timestamptz not null default (now() + interval '5 minutes'),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint workflow_flag_explanation_request_state check (
    (status = 'PENDING' and outcome is null and completed_at is null)
    or (status in ('AVAILABLE', 'UNAVAILABLE')
      and outcome is not null and completed_at is not null)
  ),
  constraint workflow_flag_explanation_lease_valid check (
    lease_expires_at > started_at
  )
);

alter table public.workflow_flag_explanation_requests enable row level security;

create unique index workflow_flag_one_pending_explanation_idx
  on public.workflow_flag_explanation_requests(flag_id)
  where status = 'PENDING';

update public.ai_flags
set
  severity = case when rule_code = 'HIGH_AMOUNT_VARIANCE' then 'CRITICAL' else 'WARNING' end,
  title = case rule_code
    when 'HIGH_AMOUNT_VARIANCE' then 'Final amount is significantly above quote'
    when 'MISSING_EVIDENCE' then 'Completed job has no service evidence'
    when 'UNUSUAL_EXTRA_CHARGE' then 'Extra charges require review'
    else 'Workflow review required'
  end,
  deterministic_summary = case rule_code
    when 'HIGH_AMOUNT_VARIANCE' then 'The final amount exceeded the configured quoted-price variance threshold.'
    when 'MISSING_EVIDENCE' then 'The job reached JOB_DONE without an attached service evidence file.'
    when 'UNUSUAL_EXTRA_CHARGE' then 'The extra charge exceeded the configured amount or quoted-price ratio threshold.'
    else 'Review the deterministic workflow facts.'
  end;

alter table public.ai_flags
  drop constraint ai_flags_order_id_rule_code_key;

alter table public.ai_flags
  add constraint ai_flags_order_revision_rule_key
  unique (order_id, completion_revision, rule_code);

create index ai_flags_open_order_idx
  on public.ai_flags(order_id, completion_revision, created_at desc)
  where status = 'OPEN';

create or replace function public.workflow_supervisor_generate_flags(
  p_order_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_status public.order_status;
  v_quoted_price numeric(12, 2);
  v_report_id uuid;
  v_revision integer;
  v_extra_charges numeric(12, 2);
  v_final_amount numeric(12, 2);
  v_attachment_count integer;
  v_variance_amount numeric(12, 2);
  v_variance_ratio numeric;
  v_extra_ratio numeric;
  v_settings public.workflow_supervisor_settings%rowtype;
begin
  select o.status, sr.quoted_price_snapshot, sr.id, sr.completion_revision,
         sr.extra_charges, sr.final_amount,
         (select count(*)::integer
            from public.service_attachments sa
           where sa.service_report_id = sr.id)
  into v_order_status, v_quoted_price, v_report_id, v_revision,
       v_extra_charges, v_final_amount, v_attachment_count
  from public.orders o
  join public.service_reports sr on sr.order_id = o.id
  where o.id = p_order_id;

  if v_order_status is distinct from 'JOB_DONE' or v_report_id is null then
    return;
  end if;

  select * into strict v_settings
  from public.workflow_supervisor_settings where id = true;

  v_variance_amount := greatest(v_final_amount - v_quoted_price, 0);
  v_variance_ratio := case when v_quoted_price > 0
    then v_variance_amount / v_quoted_price else null end;
  v_extra_ratio := case when v_quoted_price > 0
    then v_extra_charges / v_quoted_price else null end;

  -- Prior completion flags stay as audit history, but no longer count as open
  -- decisions after a clarification/re-completion creates a newer revision.
  update public.ai_flags set
    status = 'RESOLVED',
    resolved_by = null,
    resolved_at = coalesce(resolved_at, clock_timestamp()),
    updated_at = clock_timestamp()
  where order_id = p_order_id
    and completion_revision < v_revision
    and status = 'OPEN';

  if v_variance_amount >= v_settings.amount_variance_minimum
     and (v_quoted_price = 0
       or v_variance_ratio >= v_settings.amount_variance_ratio) then
    insert into public.ai_flags (
      id, order_id, completion_revision, rule_code, severity, title,
      deterministic_summary, details
    ) values (
      gen_random_uuid(), p_order_id, v_revision, 'HIGH_AMOUNT_VARIANCE',
      'CRITICAL', 'Final amount is significantly above quote',
      'The final amount exceeded the configured quoted-price variance threshold.',
      jsonb_build_object(
        'serviceReportId', v_report_id,
        'quotedPrice', v_quoted_price,
        'extraCharges', v_extra_charges,
        'finalAmount', v_final_amount,
        'varianceAmount', v_variance_amount,
        'varianceRatio', v_variance_ratio,
        'configuredMinimum', v_settings.amount_variance_minimum,
        'configuredRatio', v_settings.amount_variance_ratio
      )
    ) on conflict (order_id, completion_revision, rule_code) do update set
      severity = excluded.severity,
      title = excluded.title,
      deterministic_summary = excluded.deterministic_summary,
      details = excluded.details,
      updated_at = clock_timestamp();
  end if;

  if v_attachment_count = 0 then
    insert into public.ai_flags (
      id, order_id, completion_revision, rule_code, severity, title,
      deterministic_summary, details
    ) values (
      gen_random_uuid(), p_order_id, v_revision, 'MISSING_EVIDENCE',
      'WARNING', 'Completed job has no service evidence',
      'The job reached JOB_DONE without an attached service evidence file.',
      jsonb_build_object(
        'serviceReportId', v_report_id,
        'attachmentCount', v_attachment_count
      )
    ) on conflict (order_id, completion_revision, rule_code) do update set
      severity = excluded.severity,
      title = excluded.title,
      deterministic_summary = excluded.deterministic_summary,
      details = excluded.details,
      updated_at = clock_timestamp();
  end if;

  if v_extra_charges >= v_settings.unusual_extra_charge_minimum
     or (v_quoted_price > 0
       and v_extra_ratio >= v_settings.unusual_extra_charge_ratio) then
    insert into public.ai_flags (
      id, order_id, completion_revision, rule_code, severity, title,
      deterministic_summary, details
    ) values (
      gen_random_uuid(), p_order_id, v_revision, 'UNUSUAL_EXTRA_CHARGE',
      'WARNING', 'Extra charges require review',
      'The extra charge exceeded the configured amount or quoted-price ratio threshold.',
      jsonb_build_object(
        'serviceReportId', v_report_id,
        'quotedPrice', v_quoted_price,
        'extraCharges', v_extra_charges,
        'finalAmount', v_final_amount,
        'extraChargeRatio', v_extra_ratio,
        'configuredMinimum', v_settings.unusual_extra_charge_minimum,
        'configuredRatio', v_settings.unusual_extra_charge_ratio
      )
    ) on conflict (order_id, completion_revision, rule_code) do update set
      severity = excluded.severity,
      title = excluded.title,
      deterministic_summary = excluded.deterministic_summary,
      details = excluded.details,
      updated_at = clock_timestamp();
  end if;
end;
$$;

create or replace function public.workflow_supervisor_on_job_done()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.workflow_supervisor_generate_flags(new.id);
  return new;
end;
$$;

create trigger orders_generate_workflow_flags
after update of status on public.orders
for each row
when (new.status = 'JOB_DONE' and old.status is distinct from new.status)
execute function public.workflow_supervisor_on_job_done();

create or replace function public.workflow_supervisor_flag_json(
  p_flag public.ai_flags
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', (p_flag).id,
    'orderId', (p_flag).order_id,
    'ruleCode', (p_flag).rule_code,
    'completionRevision', (p_flag).completion_revision,
    'severity', (p_flag).severity,
    'title', (p_flag).title,
    'deterministicSummary', (p_flag).deterministic_summary,
    'details', (p_flag).details,
    'status', (p_flag).status,
    'explanation', jsonb_build_object(
      'status', (p_flag).explanation_status,
      'summary', (p_flag).explanation_summary,
      'recommendation', (p_flag).explanation_recommendation,
      'errorCode', (p_flag).explanation_error_code,
      'generatedAt', (p_flag).explanation_generated_at
    ),
    'createdAt', (p_flag).created_at
  );
$$;

create or replace function public.manager_get_workflow_flag(
  p_actor_profile_id uuid,
  p_flag_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_flag public.ai_flags%rowtype;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_profile_id and p.role = 'MANAGER' and p.active
  ) then
    raise exception 'INVALID_MANAGER_ACTOR' using errcode = 'P0001';
  end if;
  select * into v_flag from public.ai_flags where id = p_flag_id;
  if not found then
    raise exception 'WORKFLOW_FLAG_NOT_FOUND' using errcode = 'P0001';
  end if;
  return public.workflow_supervisor_flag_json(v_flag);
end;
$$;

create or replace function public.manager_begin_workflow_flag_explanation(
  p_actor_profile_id uuid,
  p_flag_id uuid,
  p_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_flag public.ai_flags%rowtype;
  v_request public.workflow_flag_explanation_requests%rowtype;
  v_outcome jsonb;
  v_inserted integer;
  v_now timestamptz;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_profile_id and p.role = 'MANAGER' and p.active
  ) then
    raise exception 'INVALID_MANAGER_ACTOR' using errcode = 'P0001';
  end if;
  -- Serialize lease acquisition for this flag so different request keys cannot
  -- race into multiple provider calls.
  select * into v_flag from public.ai_flags where id = p_flag_id for update;
  if not found then
    raise exception 'WORKFLOW_FLAG_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_now := clock_timestamp();

  select * into v_request
  from public.workflow_flag_explanation_requests
  where request_key = p_request_key;
  if found then
    if v_request.flag_id <> p_flag_id
       or v_request.requested_by <> p_actor_profile_id then
      raise exception 'WORKFLOW_EXPLANATION_IDEMPOTENCY_CONFLICT'
        using errcode = 'P0001';
    end if;
    if v_request.status = 'PENDING' then
      if v_request.lease_expires_at > v_now then
        raise exception 'WORKFLOW_EXPLANATION_IN_PROGRESS' using errcode = 'P0001';
      end if;
      -- The same idempotency key may resume after its bounded lease expires.
      update public.workflow_flag_explanation_requests set
        started_at = v_now,
        lease_expires_at = v_now + interval '5 minutes'
      where request_key = p_request_key;
      return jsonb_build_object(
        'action', 'EXECUTE',
        'flag', public.workflow_supervisor_flag_json(v_flag),
        'replayed', false
      );
    end if;
    return jsonb_build_object(
      'action', 'REPLAY', 'flag', v_request.outcome, 'replayed', true
    );
  end if;

  -- A different non-stale request key cannot create parallel spend. If the
  -- prior attempt is stale, persist a safe unavailable outcome before allowing
  -- the fresh request to acquire the flag lease.
  select * into v_request
  from public.workflow_flag_explanation_requests
  where flag_id = p_flag_id and status = 'PENDING'
  for update;
  if found then
    if v_request.lease_expires_at > v_now then
      raise exception 'WORKFLOW_EXPLANATION_IN_PROGRESS' using errcode = 'P0001';
    end if;
    update public.ai_flags set
      explanation_status = 'UNAVAILABLE',
      explanation_summary = null,
      explanation_recommendation = null,
      explanation_error_code = 'AI_TIMEOUT',
      explanation_generated_at = v_now,
      explanation_provider_config_id = null,
      updated_at = v_now
    where id = p_flag_id
    returning * into v_flag;
    v_outcome := public.workflow_supervisor_flag_json(v_flag);
    update public.workflow_flag_explanation_requests set
      status = 'UNAVAILABLE', outcome = v_outcome, completed_at = v_now
    where request_key = v_request.request_key;
    insert into public.audit_logs (
      id, order_id, actor_profile_id, event_type, metadata_json, created_at
    ) values (
      gen_random_uuid(), v_flag.order_id, p_actor_profile_id,
      'WORKFLOW_FLAG_EXPLANATION_UNAVAILABLE',
      jsonb_build_object(
        'flagId', v_flag.id,
        'ruleCode', v_flag.rule_code,
        'completionRevision', v_flag.completion_revision,
        'errorCode', 'AI_TIMEOUT',
        'staleRequestKey', v_request.request_key
      ), v_now
    );
  end if;

  if v_flag.explanation_status = 'AVAILABLE' then
    v_outcome := public.workflow_supervisor_flag_json(v_flag);
    insert into public.workflow_flag_explanation_requests (
      request_key, flag_id, requested_by, status, outcome,
      started_at, lease_expires_at, completed_at
    ) values (
      p_request_key, p_flag_id, p_actor_profile_id, 'AVAILABLE',
      v_outcome, v_now, v_now + interval '5 minutes', v_now
    ) on conflict (request_key) do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 0 then
      select * into strict v_request
      from public.workflow_flag_explanation_requests
      where request_key = p_request_key;
      if v_request.flag_id <> p_flag_id
         or v_request.requested_by <> p_actor_profile_id then
        raise exception 'WORKFLOW_EXPLANATION_IDEMPOTENCY_CONFLICT'
          using errcode = 'P0001';
      end if;
      if v_request.status = 'PENDING' then
        raise exception 'WORKFLOW_EXPLANATION_IN_PROGRESS' using errcode = 'P0001';
      end if;
      return jsonb_build_object(
        'action', 'REPLAY', 'flag', v_request.outcome, 'replayed', true
      );
    end if;
    return jsonb_build_object(
      'action', 'CACHED', 'flag', v_outcome, 'replayed', false
    );
  end if;

  insert into public.workflow_flag_explanation_requests (
    request_key, flag_id, requested_by, started_at, lease_expires_at
  ) values (
    p_request_key, p_flag_id, p_actor_profile_id,
    v_now, v_now + interval '5 minutes'
  )
  on conflict (request_key) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select * into strict v_request
    from public.workflow_flag_explanation_requests
    where request_key = p_request_key;
    if v_request.flag_id <> p_flag_id
       or v_request.requested_by <> p_actor_profile_id then
      raise exception 'WORKFLOW_EXPLANATION_IDEMPOTENCY_CONFLICT'
        using errcode = 'P0001';
    end if;
    if v_request.status = 'PENDING' then
      raise exception 'WORKFLOW_EXPLANATION_IN_PROGRESS' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'action', 'REPLAY', 'flag', v_request.outcome, 'replayed', true
    );
  end if;
  return jsonb_build_object(
    'action', 'EXECUTE',
    'flag', public.workflow_supervisor_flag_json(v_flag),
    'replayed', false
  );
end;
$$;

create or replace function public.manager_store_workflow_flag_explanation(
  p_actor_profile_id uuid,
  p_flag_id uuid,
  p_request_key uuid,
  p_explanation_status text,
  p_summary text,
  p_recommendation text,
  p_error_code text,
  p_provider_config_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_flag public.ai_flags%rowtype;
  v_request public.workflow_flag_explanation_requests%rowtype;
  v_outcome jsonb;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_profile_id and p.role = 'MANAGER' and p.active
  ) then
    raise exception 'INVALID_MANAGER_ACTOR' using errcode = 'P0001';
  end if;
  if p_explanation_status not in ('AVAILABLE', 'UNAVAILABLE') then
    raise exception 'INVALID_WORKFLOW_EXPLANATION' using errcode = 'P0001';
  end if;
  if p_explanation_status = 'AVAILABLE' and (
    nullif(btrim(p_summary), '') is null
    or nullif(btrim(p_recommendation), '') is null
    or p_error_code is not null
  ) then
    raise exception 'INVALID_WORKFLOW_EXPLANATION' using errcode = 'P0001';
  end if;
  if p_explanation_status = 'UNAVAILABLE' and (
    p_summary is not null or p_recommendation is not null
    or nullif(btrim(p_error_code), '') is null
  ) then
    raise exception 'INVALID_WORKFLOW_EXPLANATION' using errcode = 'P0001';
  end if;

  -- Match the begin RPC lock order (flag, then request) to avoid a deadlock
  -- between lease acquisition and completion persistence.
  select * into v_flag
  from public.ai_flags where id = p_flag_id
  for update;
  if not found then
    raise exception 'WORKFLOW_FLAG_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into v_request
  from public.workflow_flag_explanation_requests
  where request_key = p_request_key
  for update;
  if not found or v_request.flag_id <> p_flag_id
     or v_request.requested_by <> p_actor_profile_id then
    raise exception 'WORKFLOW_EXPLANATION_IDEMPOTENCY_CONFLICT'
      using errcode = 'P0001';
  end if;
  if v_request.status <> 'PENDING' then
    return jsonb_build_object(
      'flag', v_request.outcome, 'replayed', true
    );
  end if;

  update public.ai_flags set
    explanation_status = p_explanation_status,
    explanation_summary = case when p_explanation_status = 'AVAILABLE'
      then btrim(p_summary) else null end,
    explanation_recommendation = case when p_explanation_status = 'AVAILABLE'
      then btrim(p_recommendation) else null end,
    explanation_error_code = case when p_explanation_status = 'UNAVAILABLE'
      then btrim(p_error_code) else null end,
    explanation_generated_at = clock_timestamp(),
    explanation_provider_config_id = p_provider_config_id,
    updated_at = clock_timestamp()
  where id = p_flag_id
  returning * into v_flag;
  if not found then
    raise exception 'WORKFLOW_FLAG_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_outcome := public.workflow_supervisor_flag_json(v_flag);
  update public.workflow_flag_explanation_requests set
    status = p_explanation_status,
    outcome = v_outcome,
    completed_at = clock_timestamp()
  where request_key = p_request_key;

  insert into public.audit_logs (
    id, order_id, actor_profile_id, event_type, metadata_json
  ) values (
    gen_random_uuid(), v_flag.order_id, p_actor_profile_id,
    case when p_explanation_status = 'AVAILABLE'
      then 'WORKFLOW_FLAG_EXPLANATION_AVAILABLE'
      else 'WORKFLOW_FLAG_EXPLANATION_UNAVAILABLE' end,
    jsonb_build_object(
      'flagId', v_flag.id,
      'ruleCode', v_flag.rule_code,
      'completionRevision', v_flag.completion_revision,
      'providerConfigId', p_provider_config_id,
      'errorCode', v_flag.explanation_error_code
    )
  );
  return jsonb_build_object('flag', v_outcome, 'replayed', false);
end;
$$;

do $$
declare
  v_order_id uuid;
begin
  for v_order_id in select id from public.orders where status = 'JOB_DONE' loop
    perform public.workflow_supervisor_generate_flags(v_order_id);
  end loop;
end;
$$;

revoke all on table public.workflow_supervisor_settings from public, anon, authenticated;
revoke all on table public.workflow_flag_explanation_requests from public, anon, authenticated;
revoke all on function public.workflow_supervisor_generate_flags(uuid) from public, anon, authenticated;
revoke all on function public.workflow_supervisor_on_job_done() from public, anon, authenticated;
revoke all on function public.workflow_supervisor_flag_json(public.ai_flags) from public, anon, authenticated;
revoke all on function public.manager_get_workflow_flag(uuid, uuid) from public, anon, authenticated;
revoke all on function public.manager_begin_workflow_flag_explanation(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.manager_store_workflow_flag_explanation(uuid, uuid, uuid, text, text, text, text, uuid) from public, anon, authenticated;

grant select on table public.workflow_supervisor_settings to service_role;
grant execute on function public.manager_get_workflow_flag(uuid, uuid) to service_role;
grant execute on function public.manager_begin_workflow_flag_explanation(uuid, uuid, uuid) to service_role;
grant execute on function public.manager_store_workflow_flag_explanation(uuid, uuid, uuid, text, text, text, text, uuid) to service_role;

comment on function public.workflow_supervisor_generate_flags(uuid) is
  'Creates duplicate-safe deterministic flags for the current completion revision.';
comment on function public.manager_store_workflow_flag_explanation(uuid, uuid, uuid, text, text, text, text, uuid) is
  'Stores optional bounded AI decision-support output; never changes operational state.';
