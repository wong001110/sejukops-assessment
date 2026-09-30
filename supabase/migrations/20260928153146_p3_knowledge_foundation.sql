-- P3 text-only knowledge foundation. This migration is intentionally local
-- until P1 isolation and the P3 release gate are accepted.
create type public.knowledge_document_state as enum ('DRAFT', 'PUBLISHED', 'ARCHIVED');
create type public.knowledge_index_state as enum ('PENDING', 'PROCESSING', 'READY', 'FAILED');

create table public.knowledge_documents (
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  generation bigint not null check (generation > 0),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  source_label text not null check (char_length(btrim(source_label)) between 1 and 160),
  created_by_profile_id uuid not null,
  state public.knowledge_document_state not null default 'DRAFT',
  published_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, created_by_profile_id)
    references public.workspace_memberships(workspace_id, profile_id) on delete restrict,
  constraint knowledge_document_publication_consistent check (
    (state = 'DRAFT' and published_version_id is null)
    or (state in ('PUBLISHED', 'ARCHIVED') and published_version_id is not null)
  )
);

create table public.knowledge_versions (
  workspace_id uuid not null,
  document_id uuid not null,
  id uuid not null default gen_random_uuid(),
  version_no integer not null check (version_no > 0),
  generation bigint not null check (generation > 0),
  source_text text not null check (char_length(source_text) between 1 and 100000),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  index_state public.knowledge_index_state not null default 'PENDING',
  index_error text,
  chunk_count integer not null default 0 check (chunk_count between 0 and 64),
  created_by_profile_id uuid not null,
  reviewed_by_profile_id uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, document_id, id),
  unique (workspace_id, document_id, version_no),
  unique (workspace_id, document_id, sha256),
  foreign key (workspace_id, document_id)
    references public.knowledge_documents(workspace_id, id) on delete restrict,
  foreign key (workspace_id, created_by_profile_id)
    references public.workspace_memberships(workspace_id, profile_id) on delete restrict,
  foreign key (workspace_id, reviewed_by_profile_id)
    references public.workspace_memberships(workspace_id, profile_id) on delete restrict,
  constraint knowledge_review_pair check ((reviewed_at is null) = (reviewed_by_profile_id is null))
);

alter table public.knowledge_documents
  add constraint knowledge_document_published_version_fkey
  foreign key (workspace_id, id, published_version_id)
  references public.knowledge_versions(workspace_id, document_id, id) on delete restrict;

create table public.knowledge_chunks (
  workspace_id uuid not null,
  document_id uuid not null,
  version_id uuid not null,
  ordinal integer not null check (ordinal between 1 and 64),
  section_label text not null check (char_length(btrim(section_label)) between 1 and 80),
  content text not null check (char_length(btrim(content)) between 1 and 2000),
  primary key (workspace_id, document_id, version_id, ordinal),
  foreign key (workspace_id, document_id, version_id)
    references public.knowledge_versions(workspace_id, document_id, id) on delete restrict
);

create index knowledge_documents_creator_idx
  on public.knowledge_documents(workspace_id, created_by_profile_id, state);
create index knowledge_chunks_lookup_idx
  on public.knowledge_chunks(workspace_id, document_id, version_id);

alter table public.knowledge_documents enable row level security;
alter table public.knowledge_versions enable row level security;
alter table public.knowledge_chunks enable row level security;

-- The Data API can read only. All state changes go through bounded RPCs that
-- re-resolve auth.uid(), membership, generation and ownership in the database.
revoke all on public.knowledge_documents, public.knowledge_versions,
  public.knowledge_chunks from public, anon, authenticated, service_role;
grant select on public.knowledge_documents, public.knowledge_versions,
  public.knowledge_chunks to authenticated;
-- Keep writes in the bounded definer functions. A future service-role adapter
-- must not bypass publication, generation, and creator checks with table DML.

create policy knowledge_documents_read_scoped
  on public.knowledge_documents for select to authenticated
  using (exists (
    select 1 from public.workspace_memberships m
    join public.profiles p on p.id = m.profile_id
    join public.workspaces w on w.id = m.workspace_id
    where m.workspace_id = knowledge_documents.workspace_id
      and m.active and p.active and w.active
      and w.generation = knowledge_documents.generation
      and p.auth_user_id = (select auth.uid())
      and ((select (auth.jwt()->>'is_anonymous')::boolean) is false or w.kind = 'DEMO')
      and (knowledge_documents.created_by_profile_id = p.id
        or knowledge_documents.state = 'PUBLISHED')
  ));

create policy knowledge_versions_read_scoped
  on public.knowledge_versions for select to authenticated
  using (exists (
    select 1 from public.knowledge_documents d
    join public.workspace_memberships m
      on m.workspace_id = d.workspace_id
    join public.profiles p on p.id = m.profile_id
    where d.workspace_id = knowledge_versions.workspace_id
      and d.id = knowledge_versions.document_id
      and d.generation = knowledge_versions.generation
      and m.active and p.active and p.auth_user_id = (select auth.uid())
      and (d.created_by_profile_id = p.id
        or (d.state = 'PUBLISHED'
          and d.published_version_id = knowledge_versions.id
          and knowledge_versions.index_state = 'READY'))
  ));

create policy knowledge_chunks_read_scoped
  on public.knowledge_chunks for select to authenticated
  using (exists (
    select 1 from public.knowledge_versions v
    where v.workspace_id = knowledge_chunks.workspace_id
      and v.document_id = knowledge_chunks.document_id
      and v.id = knowledge_chunks.version_id
  ));

create schema if not exists private;
grant usage on schema private to authenticated;

create function private.knowledge_editor(p_workspace_id uuid, p_generation bigint)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_profile_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'KNOWLEDGE_FORBIDDEN' using errcode = '42501';
  end if;
  select p.id into v_profile_id
  from public.profiles p
  join public.workspace_memberships m on m.profile_id = p.id
  join public.workspaces w on w.id = m.workspace_id
  where p.auth_user_id = (select auth.uid()) and p.active
    and m.workspace_id = p_workspace_id and m.active
    and m.role in ('ADMIN', 'MANAGER')
    and w.active and w.generation = p_generation
    and ((select (auth.jwt()->>'is_anonymous')::boolean) is false or w.kind = 'DEMO')
  for share of w;
  if v_profile_id is null then
    raise exception 'KNOWLEDGE_FORBIDDEN_OR_STALE' using errcode = '42501';
  end if;
  return v_profile_id;
end;
$$;

create function private.knowledge_create_document(
  p_workspace_id uuid, p_generation bigint, p_title text, p_source_label text
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_profile_id uuid; v_id uuid;
begin
  v_profile_id := private.knowledge_editor(p_workspace_id, p_generation);
  if p_title is null or char_length(btrim(p_title)) not between 1 and 160
    or p_source_label is null or char_length(btrim(p_source_label)) not between 1 and 160 then
    raise exception 'KNOWLEDGE_INPUT_INVALID' using errcode = '22023';
  end if;
  insert into public.knowledge_documents
    (workspace_id, generation, title, source_label, created_by_profile_id)
  values (p_workspace_id, p_generation, btrim(p_title), btrim(p_source_label), v_profile_id)
  returning id into v_id;
  return v_id;
end;
$$;

-- A text import and its keyword chunks become READY atomically. A failed
-- replacement never changes the document's published_version_id pointer.
create function private.knowledge_stage_text(
  p_workspace_id uuid, p_generation bigint, p_document_id uuid,
  p_source_text text, p_chunks text[]
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_profile_id uuid; v_version_id uuid; v_version_no integer;
  v_document public.knowledge_documents; v_count integer; v_chunk text; v_ordinal integer;
begin
  v_profile_id := private.knowledge_editor(p_workspace_id, p_generation);
  select * into v_document from public.knowledge_documents d
  where d.workspace_id = p_workspace_id and d.id = p_document_id
    and d.generation = p_generation and d.state <> 'ARCHIVED'
  for update;
  if v_document.id is null or v_document.created_by_profile_id <> v_profile_id then
    raise exception 'KNOWLEDGE_FORBIDDEN' using errcode = '42501';
  end if;
  v_count := coalesce(array_length(p_chunks, 1), 0);
  if p_source_text is null or char_length(p_source_text) not between 1 and 100000
    or v_count not between 1 and 64 then
    raise exception 'KNOWLEDGE_INPUT_INVALID' using errcode = '22023';
  end if;
  for v_ordinal in 1..v_count loop
    v_chunk := p_chunks[v_ordinal];
    if v_chunk is null or char_length(btrim(v_chunk)) not between 1 and 2000 then
      raise exception 'KNOWLEDGE_INPUT_INVALID' using errcode = '22023';
    end if;
  end loop;
  if array_to_string(p_chunks, '') <> p_source_text then
    raise exception 'KNOWLEDGE_INPUT_INVALID' using errcode = '22023';
  end if;
  select coalesce(max(v.version_no), 0) + 1 into v_version_no
  from public.knowledge_versions v
  where v.workspace_id = p_workspace_id and v.document_id = p_document_id;
  insert into public.knowledge_versions (
    workspace_id, document_id, version_no, generation, source_text, sha256,
    index_state, chunk_count, created_by_profile_id
  ) values (
    p_workspace_id, p_document_id, v_version_no, p_generation, p_source_text,
    encode(extensions.digest(convert_to(p_source_text, 'UTF8'), 'sha256'), 'hex'),
    'PROCESSING', v_count, v_profile_id
  ) returning id into v_version_id;
  for v_ordinal in 1..v_count loop
    insert into public.knowledge_chunks
      (workspace_id, document_id, version_id, ordinal, section_label, content)
    values (p_workspace_id, p_document_id, v_version_id, v_ordinal,
      'Section ' || v_ordinal, p_chunks[v_ordinal]);
  end loop;
  update public.knowledge_versions
    set index_state = 'READY', updated_at = clock_timestamp()
    where workspace_id = p_workspace_id and document_id = p_document_id
      and id = v_version_id;
  return v_version_id;
end;
$$;

create function private.knowledge_publish(
  p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid
)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_profile_id uuid; v_document public.knowledge_documents;
  v_version public.knowledge_versions;
begin
  v_profile_id := private.knowledge_editor(p_workspace_id, p_generation);
  select * into v_document from public.knowledge_documents d
  where d.workspace_id = p_workspace_id and d.id = p_document_id
    and d.generation = p_generation and d.state <> 'ARCHIVED'
  for update;
  if v_document.id is null or v_document.created_by_profile_id <> v_profile_id then
    raise exception 'KNOWLEDGE_FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_version from public.knowledge_versions v
  where v.workspace_id = p_workspace_id and v.document_id = p_document_id
    and v.id = p_version_id and v.generation = p_generation
  for update;
  if v_version.id is null or v_version.index_state <> 'READY'
    or v_version.chunk_count < 1 then
    raise exception 'KNOWLEDGE_VERSION_NOT_READY' using errcode = '22023';
  end if;
  update public.knowledge_versions
    set reviewed_by_profile_id = v_profile_id, reviewed_at = clock_timestamp(),
      updated_at = clock_timestamp()
    where workspace_id = p_workspace_id and document_id = p_document_id
      and id = p_version_id;
  update public.knowledge_documents
    set state = 'PUBLISHED', published_version_id = p_version_id,
      updated_at = clock_timestamp()
    where workspace_id = p_workspace_id and id = p_document_id;
end;
$$;

create function private.knowledge_archive(
  p_workspace_id uuid, p_generation bigint, p_document_id uuid
)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_profile_id uuid;
begin
  v_profile_id := private.knowledge_editor(p_workspace_id, p_generation);
  update public.knowledge_documents
    set state = 'ARCHIVED', updated_at = clock_timestamp()
    where workspace_id = p_workspace_id and id = p_document_id
      and generation = p_generation and state = 'PUBLISHED'
      and created_by_profile_id = v_profile_id;
  if not found then
    raise exception 'KNOWLEDGE_FORBIDDEN_OR_NOT_PUBLISHED' using errcode = '42501';
  end if;
end;
$$;

create function public.knowledge_create_document(
  p_workspace_id uuid, p_generation bigint, p_title text, p_source_label text
)
returns uuid language sql security invoker set search_path = ''
as $$ select private.knowledge_create_document(p_workspace_id, p_generation, p_title, p_source_label); $$;

create function public.knowledge_stage_text(
  p_workspace_id uuid, p_generation bigint, p_document_id uuid,
  p_source_text text, p_chunks text[]
)
returns uuid language sql security invoker set search_path = ''
as $$ select private.knowledge_stage_text(p_workspace_id, p_generation, p_document_id, p_source_text, p_chunks); $$;

create function public.knowledge_publish(
  p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid
)
returns void language sql security invoker set search_path = ''
as $$ select private.knowledge_publish(p_workspace_id, p_generation, p_document_id, p_version_id); $$;

create function public.knowledge_archive(
  p_workspace_id uuid, p_generation bigint, p_document_id uuid
)
returns void language sql security invoker set search_path = ''
as $$ select private.knowledge_archive(p_workspace_id, p_generation, p_document_id); $$;

-- Keyword-only retrieval; no embedding model or vector space is assumed.
-- Published READY current versions only. Content is untrusted source data.
create function public.knowledge_search_keyword(
  p_workspace_id uuid, p_query text, p_limit integer default 10
)
returns table (
  workspace_id uuid, document_id uuid, version_id uuid, ordinal integer,
  title text, source_label text, section_label text, content text
)
language sql security invoker set search_path = ''
as $$
  select d.workspace_id, d.id, v.id, c.ordinal, d.title, d.source_label,
    c.section_label, c.content
  from public.knowledge_documents d
  join public.workspaces w on w.id = d.workspace_id
  join public.knowledge_versions v
    on v.workspace_id = d.workspace_id and v.document_id = d.id
      and v.id = d.published_version_id
  join public.knowledge_chunks c
    on c.workspace_id = v.workspace_id and c.document_id = v.document_id
      and c.version_id = v.id
  where d.workspace_id = p_workspace_id and d.state = 'PUBLISHED'
    and d.generation = w.generation and v.generation = w.generation
    and v.index_state = 'READY'
    and char_length(btrim(p_query)) between 1 and 120
    and position(lower(btrim(p_query)) in lower(c.content)) > 0
  order by d.updated_at desc, c.ordinal
  limit least(greatest(coalesce(p_limit, 10), 1), 20);
$$;

revoke execute on function private.knowledge_editor(uuid,bigint) from public, anon;
revoke execute on function private.knowledge_create_document(uuid,bigint,text,text) from public, anon;
revoke execute on function private.knowledge_stage_text(uuid,bigint,uuid,text,text[]) from public, anon;
revoke execute on function private.knowledge_publish(uuid,bigint,uuid,uuid) from public, anon;
revoke execute on function private.knowledge_archive(uuid,bigint,uuid) from public, anon;
revoke execute on function public.knowledge_create_document(uuid,bigint,text,text) from public, anon;
revoke execute on function public.knowledge_stage_text(uuid,bigint,uuid,text,text[]) from public, anon;
revoke execute on function public.knowledge_publish(uuid,bigint,uuid,uuid) from public, anon;
revoke execute on function public.knowledge_archive(uuid,bigint,uuid) from public, anon;
revoke execute on function public.knowledge_search_keyword(uuid,text,integer) from public, anon;
grant execute on function private.knowledge_editor(uuid,bigint) to authenticated;
grant execute on function private.knowledge_create_document(uuid,bigint,text,text) to authenticated;
grant execute on function private.knowledge_stage_text(uuid,bigint,uuid,text,text[]) to authenticated;
grant execute on function private.knowledge_publish(uuid,bigint,uuid,uuid) to authenticated;
grant execute on function private.knowledge_archive(uuid,bigint,uuid) to authenticated;
grant execute on function public.knowledge_create_document(uuid,bigint,text,text) to authenticated;
grant execute on function public.knowledge_stage_text(uuid,bigint,uuid,text,text[]) to authenticated;
grant execute on function public.knowledge_publish(uuid,bigint,uuid,uuid) to authenticated;
grant execute on function public.knowledge_archive(uuid,bigint,uuid) to authenticated;
grant execute on function public.knowledge_search_keyword(uuid,text,integer) to authenticated;
