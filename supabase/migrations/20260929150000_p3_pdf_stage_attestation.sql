-- P3: PDF_TEXT can only come from the server's bounded PDF parser. A caller
-- may stage plain text, but may not assert PDF page provenance through a
-- directly callable text[] RPC.

create table private.knowledge_pdf_stage_attestations (
  token uuid primary key default gen_random_uuid(),
  actor_auth_user_id uuid not null,
  workspace_id uuid not null,
  generation bigint not null check (generation > 0),
  document_id uuid not null,
  pages_sha256 text not null check (pages_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null
);
alter table private.knowledge_pdf_stage_attestations enable row level security;
revoke all on private.knowledge_pdf_stage_attestations from public, anon, authenticated, service_role;

-- Only the application server's service-role client can issue an attestation
-- after parsing real PDF bytes. The table is never exposed through the API.
create function private.knowledge_issue_pdf_attestation(
  p_actor_auth_user_id uuid, p_workspace_id uuid, p_generation bigint,
  p_document_id uuid, p_pages text[]
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_token uuid; v_count integer; v_i integer;
begin
  if p_actor_auth_user_id is null or p_workspace_id is null or
     p_document_id is null or p_generation is null or p_generation < 1 then
    raise exception 'KNOWLEDGE_INPUT_INVALID' using errcode = '22023';
  end if;
  v_count := coalesce(array_length(p_pages, 1), 0);
  if v_count not between 1 and 12 or
     char_length(array_to_string(p_pages, E'\f')) not between 1 and 100000 then
    raise exception 'KNOWLEDGE_INPUT_INVALID' using errcode = '22023';
  end if;
  for v_i in 1..v_count loop
    if p_pages[v_i] is null or char_length(p_pages[v_i]) > 100000 then
      raise exception 'KNOWLEDGE_INPUT_INVALID' using errcode = '22023';
    end if;
  end loop;
  -- A stale or unrelated actor/document must not receive a usable claim.
  if not exists (
    select 1 from public.knowledge_documents d
    join public.workspaces w on w.id = d.workspace_id
    join public.workspace_memberships m
      on m.workspace_id = d.workspace_id and m.profile_id = d.created_by_profile_id
    join public.profiles p on p.id = m.profile_id
    join auth.users u on u.id = p.auth_user_id
    where d.workspace_id = p_workspace_id and d.id = p_document_id
      and d.generation = p_generation and d.state <> 'ARCHIVED'
      and w.active and w.generation = p_generation
      and m.active and m.role in ('ADMIN', 'MANAGER')
      and p.active and p.auth_user_id = p_actor_auth_user_id
      and not u.is_anonymous
  ) then
    raise exception 'KNOWLEDGE_FORBIDDEN' using errcode = '42501';
  end if;
  delete from private.knowledge_pdf_stage_attestations
    where expires_at <= clock_timestamp();
  insert into private.knowledge_pdf_stage_attestations
    (actor_auth_user_id, workspace_id, generation, document_id, pages_sha256, expires_at)
  values (p_actor_auth_user_id, p_workspace_id, p_generation, p_document_id,
    encode(extensions.digest(convert_to(to_jsonb(p_pages)::text, 'UTF8'), 'sha256'), 'hex'),
    clock_timestamp() + interval '2 minutes')
  returning token into v_token;
  return v_token;
end;
$$;

create function public.knowledge_issue_pdf_attestation(
  p_actor_auth_user_id uuid, p_workspace_id uuid, p_generation bigint,
  p_document_id uuid, p_pages text[]
)
returns uuid language sql security invoker set search_path = '' as $$
  select private.knowledge_issue_pdf_attestation(
    p_actor_auth_user_id, p_workspace_id, p_generation, p_document_id, p_pages);
$$;

-- The Auth caller must present the exact page array attested by the server.
-- The claim stores only a digest, not temporarily retained document text.
-- Existing knowledge_editor checks re-resolve current authority.
create function private.knowledge_consume_pdf_attestation(p_token uuid, p_pages text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_claim private.knowledge_pdf_stage_attestations; v_version_id uuid;
begin
  if p_token is null or (select auth.uid()) is null then
    raise exception 'KNOWLEDGE_FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_claim from private.knowledge_pdf_stage_attestations
    where token = p_token for update;
  if v_claim.token is null or v_claim.actor_auth_user_id <> (select auth.uid())
     or v_claim.expires_at <= clock_timestamp()
     or coalesce(array_length(p_pages, 1), 0) not between 1 and 12
     or char_length(array_to_string(p_pages, E'\f')) not between 1 and 100000
     or v_claim.pages_sha256 is distinct from encode(
       extensions.digest(convert_to(to_jsonb(p_pages)::text, 'UTF8'), 'sha256'), 'hex') then
    raise exception 'KNOWLEDGE_FORBIDDEN' using errcode = '42501';
  end if;
  v_version_id := private.knowledge_stage_pages(
    v_claim.workspace_id, v_claim.generation, v_claim.document_id,
    'PDF_TEXT', p_pages);
  delete from private.knowledge_pdf_stage_attestations where token = p_token;
  return v_version_id;
end;
$$;

create function public.knowledge_consume_pdf_attestation(p_token uuid, p_pages text[])
returns uuid language sql security invoker set search_path = '' as $$
  select private.knowledge_consume_pdf_attestation(p_token, p_pages);
$$;

-- Remove both old signatures; leaving either callable would permit a forged
-- PDF_TEXT version through direct PostgREST RPC access.
revoke execute on function public.knowledge_stage_pdf_text(uuid,bigint,uuid,text[])
  from public, anon, authenticated, service_role;
revoke execute on function private.knowledge_stage_pdf_text(uuid,bigint,uuid,text[])
  from public, anon, authenticated, service_role;
drop function public.knowledge_stage_pdf_text(uuid,bigint,uuid,text[]);
drop function private.knowledge_stage_pdf_text(uuid,bigint,uuid,text[]);

revoke execute on function private.knowledge_issue_pdf_attestation(uuid,uuid,bigint,uuid,text[]),
  public.knowledge_issue_pdf_attestation(uuid,uuid,bigint,uuid,text[]),
  private.knowledge_consume_pdf_attestation(uuid,text[]),
  public.knowledge_consume_pdf_attestation(uuid,text[])
  from public, anon, authenticated, service_role;
grant usage on schema private to service_role;
grant execute on function private.knowledge_issue_pdf_attestation(uuid,uuid,bigint,uuid,text[]),
  public.knowledge_issue_pdf_attestation(uuid,uuid,bigint,uuid,text[])
  to service_role;
grant execute on function private.knowledge_consume_pdf_attestation(uuid,text[]),
  public.knowledge_consume_pdf_attestation(uuid,text[])
  to authenticated;

-- Demo reset already removes chunks before versions. Pages must follow their
-- version when that reset deletes versions; the earlier RESTRICT FK made any
-- Demo knowledge version block the reset. No client has direct DELETE grants.
alter table public.knowledge_version_pages
  drop constraint knowledge_version_pages_workspace_id_document_id_version_i_fkey;
alter table public.knowledge_version_pages
  add constraint knowledge_version_pages_workspace_id_document_id_version_i_fkey
  foreign key (workspace_id, document_id, version_id)
  references public.knowledge_versions(workspace_id, document_id, id)
  on delete cascade;
