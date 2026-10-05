-- P3 indexing lifecycle. Apply after 20260928153146; no source bytes leave
-- the workspace's authenticated RPC boundary. Text-native PDF pages remain
-- attributable to their original page number.
alter table public.knowledge_versions
  add column source_kind text not null default 'TEXT'
    check (source_kind in ('TEXT', 'PDF_TEXT')),
  add column index_token uuid,
  add column index_started_at timestamptz,
  add column index_attempts integer not null default 0 check (index_attempts between 0 and 10);
alter table public.knowledge_versions
  add constraint knowledge_index_claim_pair check (
    (index_state = 'PROCESSING') = (index_token is not null)
    and (index_token is null) = (index_started_at is null)
  );

create table public.knowledge_version_pages (
  workspace_id uuid not null,
  document_id uuid not null,
  version_id uuid not null,
  page_no integer not null check (page_no between 1 and 20),
  content text not null check (char_length(content) <= 100000),
  primary key (workspace_id, document_id, version_id, page_no),
  foreign key (workspace_id, document_id, version_id)
    references public.knowledge_versions(workspace_id, document_id, id) on delete restrict
);
insert into public.knowledge_version_pages (workspace_id, document_id, version_id, page_no, content)
select workspace_id, document_id, id, 1, source_text from public.knowledge_versions;

alter table public.knowledge_chunks
  add column page_no integer not null default 1 check (page_no between 1 and 20);
alter table public.knowledge_chunks
  add constraint knowledge_chunks_page_fkey
  foreign key (workspace_id, document_id, version_id, page_no)
  references public.knowledge_version_pages(workspace_id, document_id, version_id, page_no)
  on delete restrict;

alter table public.knowledge_version_pages enable row level security;
revoke all on public.knowledge_version_pages from public, anon, authenticated, service_role;
grant select on public.knowledge_version_pages to authenticated;
create policy knowledge_version_pages_read_scoped
  on public.knowledge_version_pages for select to authenticated
  using (exists (
    select 1 from public.knowledge_versions v
    where v.workspace_id = knowledge_version_pages.workspace_id
      and v.document_id = knowledge_version_pages.document_id
      and v.id = knowledge_version_pages.version_id
  ));

-- The document row serializes version numbers and publication. Each page is
-- immutable after staging; retries only change index state and chunks.
create function private.knowledge_stage_pages(
  p_workspace_id uuid, p_generation bigint, p_document_id uuid,
  p_source_kind text, p_pages text[]
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_profile_id uuid; v_document public.knowledge_documents;
  v_version_id uuid; v_version_no integer; v_text text; v_count integer; v_i integer;
begin
  v_profile_id := private.knowledge_editor(p_workspace_id, p_generation);
  select * into v_document from public.knowledge_documents d
    where d.workspace_id = p_workspace_id and d.id = p_document_id
      and d.generation = p_generation and d.state <> 'ARCHIVED'
    for update;
  if v_document.id is null or v_document.created_by_profile_id <> v_profile_id then
    raise exception 'KNOWLEDGE_FORBIDDEN' using errcode = '42501';
  end if;
  v_count := coalesce(array_length(p_pages, 1), 0);
  if p_source_kind not in ('TEXT', 'PDF_TEXT') or v_count not between 1 and 20
    or (p_source_kind = 'TEXT' and v_count <> 1) then
    raise exception 'KNOWLEDGE_INPUT_INVALID' using errcode = '22023';
  end if;
  for v_i in 1..v_count loop
    if p_pages[v_i] is null or char_length(p_pages[v_i]) > 100000 then
      raise exception 'KNOWLEDGE_INPUT_INVALID' using errcode = '22023';
    end if;
  end loop;
  v_text := array_to_string(p_pages, E'\f');
  if char_length(v_text) not between 1 and 100000 or btrim(v_text, E' \t\n\r\f') = '' then
    raise exception 'KNOWLEDGE_INPUT_INVALID' using errcode = '22023';
  end if;
  select coalesce(max(v.version_no), 0) + 1 into v_version_no
    from public.knowledge_versions v
    where v.workspace_id = p_workspace_id and v.document_id = p_document_id;
  insert into public.knowledge_versions (
    workspace_id, document_id, version_no, generation, source_text, sha256,
    source_kind, index_state, chunk_count, created_by_profile_id
  ) values (
    p_workspace_id, p_document_id, v_version_no, p_generation, v_text,
    encode(extensions.digest(convert_to(v_text, 'UTF8'), 'sha256'), 'hex'),
    p_source_kind, 'PENDING', 0, v_profile_id
  ) returning id into v_version_id;
  for v_i in 1..v_count loop
    insert into public.knowledge_version_pages
      (workspace_id, document_id, version_id, page_no, content)
    values (p_workspace_id, p_document_id, v_version_id, v_i, p_pages[v_i]);
  end loop;
  return v_version_id;
end;
$$;

-- Preserve the original public RPC signature while changing its behavior to
-- staging only. Existing clients cannot bypass the separate index step.
create or replace function private.knowledge_stage_text(
  p_workspace_id uuid, p_generation bigint, p_document_id uuid,
  p_source_text text, p_chunks text[]
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_count integer; v_i integer;
begin
  v_count := coalesce(array_length(p_chunks, 1), 0);
  if p_source_text is null or v_count not between 1 and 64 then
    raise exception 'KNOWLEDGE_INPUT_INVALID' using errcode = '22023';
  end if;
  for v_i in 1..v_count loop
    if p_chunks[v_i] is null or char_length(btrim(p_chunks[v_i])) not between 1 and 2000 then
      raise exception 'KNOWLEDGE_INPUT_INVALID' using errcode = '22023';
    end if;
  end loop;
  if array_to_string(p_chunks, '') <> p_source_text then
    raise exception 'KNOWLEDGE_INPUT_INVALID' using errcode = '22023';
  end if;
  return private.knowledge_stage_pages(p_workspace_id, p_generation, p_document_id,
    'TEXT', array[p_source_text]);
end;
$$;

create function private.knowledge_stage_pdf_text(
  p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_pages text[]
)
returns uuid language sql security definer set search_path = ''
as $$ select private.knowledge_stage_pages(p_workspace_id, p_generation, p_document_id, 'PDF_TEXT', p_pages); $$;
create function public.knowledge_stage_pdf_text(
  p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_pages text[]
)
returns uuid language sql security invoker set search_path = ''
as $$ select private.knowledge_stage_pdf_text(p_workspace_id, p_generation, p_document_id, p_pages); $$;

create function private.knowledge_claim_index(
  p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid
)
returns table(token uuid, page_no integer, page_text text)
language plpgsql security definer set search_path = ''
as $$
declare v_profile_id uuid; v_document public.knowledge_documents;
  v_version public.knowledge_versions; v_token uuid;
begin
  v_profile_id := private.knowledge_editor(p_workspace_id, p_generation);
  select * into v_document from public.knowledge_documents d
    where d.workspace_id = p_workspace_id and d.id = p_document_id
      and d.generation = p_generation and d.state <> 'ARCHIVED' for update;
  if v_document.id is null or v_document.created_by_profile_id <> v_profile_id then
    raise exception 'KNOWLEDGE_FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_version from public.knowledge_versions v
    where v.workspace_id = p_workspace_id and v.document_id = p_document_id
      and v.id = p_version_id and v.generation = p_generation for update;
  if v_version.id is null or v_version.created_by_profile_id <> v_profile_id then
    raise exception 'KNOWLEDGE_INDEX_NOT_CLAIMABLE' using errcode = '22023';
  end if;
  -- The last abandoned lease must become terminal instead of remaining
  -- PROCESSING forever. It cannot alter the published version pointer.
  if v_version.index_state = 'PROCESSING' and v_version.index_attempts >= 10
    and v_version.index_started_at < clock_timestamp() - interval '60 seconds' then
    update public.knowledge_versions v set index_state = 'FAILED',
      index_token = null, index_started_at = null, index_error = 'INDEX_FAILED',
      updated_at = clock_timestamp()
    where v.workspace_id = p_workspace_id and v.document_id = p_document_id
      and v.id = p_version_id;
    return;
  end if;
  if v_version.index_attempts >= 10 or not (
      v_version.index_state = 'PENDING' or
      (v_version.index_state = 'PROCESSING' and v_version.index_started_at < clock_timestamp() - interval '60 seconds')
    ) then
    raise exception 'KNOWLEDGE_INDEX_NOT_CLAIMABLE' using errcode = '22023';
  end if;
  v_token := gen_random_uuid();
  update public.knowledge_versions v set index_state = 'PROCESSING', index_token = v_token,
    index_started_at = clock_timestamp(), index_attempts = v.index_attempts + 1,
    index_error = null, updated_at = clock_timestamp()
    where v.workspace_id = p_workspace_id and v.document_id = p_document_id and v.id = p_version_id;
  return query select v_token, p.page_no, p.content
    from public.knowledge_version_pages p
    where p.workspace_id = p_workspace_id and p.document_id = p_document_id
      and p.version_id = p_version_id order by p.page_no;
end;
$$;

create function private.knowledge_finish_index(
  p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid,
  p_token uuid, p_page_numbers integer[], p_contents text[]
)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_profile_id uuid; v_document public.knowledge_documents;
  v_version public.knowledge_versions; v_count integer; v_i integer;
  v_page public.knowledge_version_pages; v_rebuilt text; v_page_sections integer;
begin
  v_profile_id := private.knowledge_editor(p_workspace_id, p_generation);
  select * into v_document from public.knowledge_documents d
    where d.workspace_id = p_workspace_id and d.id = p_document_id
      and d.generation = p_generation and d.state <> 'ARCHIVED' for update;
  if v_document.id is null or v_document.created_by_profile_id <> v_profile_id then
    raise exception 'KNOWLEDGE_FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_version from public.knowledge_versions v
    where v.workspace_id = p_workspace_id and v.document_id = p_document_id
      and v.id = p_version_id and v.generation = p_generation for update;
  if v_version.id is null or v_version.index_state <> 'PROCESSING'
    or v_version.index_token is distinct from p_token or p_token is null then
    raise exception 'KNOWLEDGE_INDEX_STALE' using errcode = '22023';
  end if;
  v_count := coalesce(array_length(p_contents, 1), 0);
  if v_count not between 1 and 64 or v_count <> coalesce(array_length(p_page_numbers, 1), 0) then
    raise exception 'KNOWLEDGE_INDEX_INVALID' using errcode = '22023';
  end if;
  for v_i in 1..v_count loop
    if p_page_numbers[v_i] is null or p_contents[v_i] is null
      or char_length(btrim(p_contents[v_i])) not between 1 and 2000
      or (v_i > 1 and p_page_numbers[v_i] < p_page_numbers[v_i-1]) then
      raise exception 'KNOWLEDGE_INDEX_INVALID' using errcode = '22023';
    end if;
  end loop;
  for v_page in select * from public.knowledge_version_pages p
      where p.workspace_id = p_workspace_id and p.document_id = p_document_id
        and p.version_id = p_version_id order by p.page_no loop
    v_rebuilt := ''; v_page_sections := 0;
    for v_i in 1..v_count loop
      if p_page_numbers[v_i] = v_page.page_no then
        v_rebuilt := v_rebuilt || p_contents[v_i];
        v_page_sections := v_page_sections + 1;
      end if;
    end loop;
    if v_rebuilt <> v_page.content then
      raise exception 'KNOWLEDGE_INDEX_SOURCE_MISMATCH' using errcode = '22023';
    end if;
  end loop;
  -- Every supplied page number must exist; the page FK enforces this too.
  delete from public.knowledge_chunks c where c.workspace_id = p_workspace_id
    and c.document_id = p_document_id and c.version_id = p_version_id;
  v_page_sections := 0;
  for v_i in 1..v_count loop
    if v_i = 1 or p_page_numbers[v_i] <> p_page_numbers[v_i-1] then
      v_page_sections := 0;
    end if;
    v_page_sections := v_page_sections + 1;
    insert into public.knowledge_chunks
      (workspace_id, document_id, version_id, ordinal, page_no, section_label, content)
    values (p_workspace_id, p_document_id, p_version_id, v_i, p_page_numbers[v_i],
      'Page ' || p_page_numbers[v_i] || ', section ' || v_page_sections, p_contents[v_i]);
  end loop;
  update public.knowledge_versions v set index_state = 'READY', index_token = null,
    index_started_at = null, index_error = null, chunk_count = v_count,
    updated_at = clock_timestamp()
    where v.workspace_id = p_workspace_id and v.document_id = p_document_id and v.id = p_version_id;
end;
$$;

create function private.knowledge_fail_index(
  p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid,
  p_token uuid, p_error_code text
)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_profile_id uuid; v_document public.knowledge_documents;
begin
  v_profile_id := private.knowledge_editor(p_workspace_id, p_generation);
  select * into v_document from public.knowledge_documents d
    where d.workspace_id = p_workspace_id and d.id = p_document_id
      and d.generation = p_generation and d.state <> 'ARCHIVED' for update;
  if v_document.id is null or v_document.created_by_profile_id <> v_profile_id then
    raise exception 'KNOWLEDGE_FORBIDDEN' using errcode = '42501';
  end if;
  if p_error_code not in ('CHUNK_LIMIT', 'TEXT_UNREADABLE', 'INDEX_FAILED') then
    raise exception 'KNOWLEDGE_INDEX_INVALID' using errcode = '22023';
  end if;
  update public.knowledge_versions v set index_state = 'FAILED', index_token = null,
    index_started_at = null, index_error = p_error_code, updated_at = clock_timestamp()
    where v.workspace_id = p_workspace_id and v.document_id = p_document_id
      and v.id = p_version_id and v.generation = p_generation
      and v.created_by_profile_id = v_profile_id and v.index_state = 'PROCESSING'
      and v.index_token = p_token and p_token is not null;
  if not found then raise exception 'KNOWLEDGE_INDEX_STALE' using errcode = '22023'; end if;
end;
$$;

create function private.knowledge_retry_index(
  p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid
)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_profile_id uuid; v_document public.knowledge_documents;
begin
  v_profile_id := private.knowledge_editor(p_workspace_id, p_generation);
  select * into v_document from public.knowledge_documents d
    where d.workspace_id = p_workspace_id and d.id = p_document_id
      and d.generation = p_generation and d.state <> 'ARCHIVED' for update;
  if v_document.id is null or v_document.created_by_profile_id <> v_profile_id then
    raise exception 'KNOWLEDGE_FORBIDDEN' using errcode = '42501';
  end if;
  update public.knowledge_versions v set index_state = 'PENDING', index_error = null,
    updated_at = clock_timestamp()
    where v.workspace_id = p_workspace_id and v.document_id = p_document_id
      and v.id = p_version_id and v.generation = p_generation
      and v.created_by_profile_id = v_profile_id and v.index_state = 'FAILED'
      and v.index_attempts < 10;
  if not found then raise exception 'KNOWLEDGE_INDEX_NOT_RETRYABLE' using errcode = '22023'; end if;
end;
$$;

create function public.knowledge_claim_index(
  p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid
)
returns table(token uuid, page_no integer, page_text text)
language sql security invoker set search_path = ''
as $$ select * from private.knowledge_claim_index(p_workspace_id,p_generation,p_document_id,p_version_id); $$;
create function public.knowledge_finish_index(
  p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid,
  p_token uuid, p_page_numbers integer[], p_contents text[]
)
returns void language sql security invoker set search_path = ''
as $$ select private.knowledge_finish_index(p_workspace_id,p_generation,p_document_id,
  p_version_id,p_token,p_page_numbers,p_contents); $$;
create function public.knowledge_fail_index(
  p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid,
  p_token uuid, p_error_code text
)
returns void language sql security invoker set search_path = ''
as $$ select private.knowledge_fail_index(p_workspace_id,p_generation,p_document_id,
  p_version_id,p_token,p_error_code); $$;
create function public.knowledge_retry_index(
  p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid
)
returns void language sql security invoker set search_path = ''
as $$ select private.knowledge_retry_index(p_workspace_id,p_generation,p_document_id,p_version_id); $$;

drop function public.knowledge_search_keyword(uuid,text,integer);
create function public.knowledge_search_keyword(
  p_workspace_id uuid, p_query text, p_limit integer default 10
)
returns table (
  workspace_id uuid, document_id uuid, version_id uuid, ordinal integer,
  page_no integer, title text, source_label text, section_label text, content text
)
language sql security invoker set search_path = ''
as $$
  select d.workspace_id, d.id, v.id, c.ordinal, c.page_no, d.title, d.source_label,
    c.section_label, c.content
  from public.knowledge_documents d
  join public.workspaces w on w.id = d.workspace_id
  join public.knowledge_versions v on v.workspace_id = d.workspace_id
    and v.document_id = d.id and v.id = d.published_version_id
  join public.knowledge_chunks c on c.workspace_id = v.workspace_id
    and c.document_id = v.document_id and c.version_id = v.id
  where d.workspace_id = p_workspace_id and d.state = 'PUBLISHED'
    and d.generation = w.generation and v.generation = w.generation
    and v.index_state = 'READY' and char_length(btrim(p_query)) between 1 and 120
    and position(lower(btrim(p_query)) in lower(c.content)) > 0
  order by d.updated_at desc, c.ordinal
  limit least(greatest(coalesce(p_limit, 10), 1), 20);
$$;

revoke execute on function private.knowledge_stage_pages(uuid,bigint,uuid,text,text[]) from public, anon, authenticated;
revoke execute on function private.knowledge_stage_pdf_text(uuid,bigint,uuid,text[]) from public, anon;
revoke execute on function private.knowledge_claim_index(uuid,bigint,uuid,uuid) from public, anon;
revoke execute on function private.knowledge_finish_index(uuid,bigint,uuid,uuid,uuid,integer[],text[]) from public, anon;
revoke execute on function private.knowledge_fail_index(uuid,bigint,uuid,uuid,uuid,text) from public, anon;
revoke execute on function private.knowledge_retry_index(uuid,bigint,uuid,uuid) from public, anon;
revoke execute on function public.knowledge_stage_pdf_text(uuid,bigint,uuid,text[]) from public, anon;
revoke execute on function public.knowledge_claim_index(uuid,bigint,uuid,uuid) from public, anon;
revoke execute on function public.knowledge_finish_index(uuid,bigint,uuid,uuid,uuid,integer[],text[]) from public, anon;
revoke execute on function public.knowledge_fail_index(uuid,bigint,uuid,uuid,uuid,text) from public, anon;
revoke execute on function public.knowledge_retry_index(uuid,bigint,uuid,uuid) from public, anon;
revoke execute on function public.knowledge_search_keyword(uuid,text,integer) from public, anon;
grant execute on function private.knowledge_stage_pdf_text(uuid,bigint,uuid,text[]) to authenticated;
grant execute on function private.knowledge_claim_index(uuid,bigint,uuid,uuid) to authenticated;
grant execute on function private.knowledge_finish_index(uuid,bigint,uuid,uuid,uuid,integer[],text[]) to authenticated;
grant execute on function private.knowledge_fail_index(uuid,bigint,uuid,uuid,uuid,text) to authenticated;
grant execute on function private.knowledge_retry_index(uuid,bigint,uuid,uuid) to authenticated;
grant execute on function public.knowledge_stage_pdf_text(uuid,bigint,uuid,text[]) to authenticated;
grant execute on function public.knowledge_claim_index(uuid,bigint,uuid,uuid) to authenticated;
grant execute on function public.knowledge_finish_index(uuid,bigint,uuid,uuid,uuid,integer[],text[]) to authenticated;
grant execute on function public.knowledge_fail_index(uuid,bigint,uuid,uuid,uuid,text) to authenticated;
grant execute on function public.knowledge_retry_index(uuid,bigint,uuid,uuid) to authenticated;
grant execute on function public.knowledge_search_keyword(uuid,text,integer) to authenticated;
