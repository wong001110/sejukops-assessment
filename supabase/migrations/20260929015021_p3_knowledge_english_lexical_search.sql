-- KB-02 measured repair: whole-query substring matching misses ordinary English
-- paraphrases. Preserve literal matching for Chinese text and exact identifiers.
-- English full-text search uses stemming plus two bounded maintenance-domain
-- synonym pairs. This is lexical retrieval, not semantic answer validation.
create index knowledge_chunks_english_fts_idx
  on public.knowledge_chunks using gin (to_tsvector('english'::regconfig, content));

create or replace function public.knowledge_search_keyword(
  p_workspace_id uuid, p_query text, p_limit integer default 10
)
returns table (
  workspace_id uuid, document_id uuid, version_id uuid, ordinal integer,
  page_no integer, title text, source_label text, section_label text, content text
)
language sql security invoker set search_path = ''
as $$
  with search as (
    select btrim(p_query) as literal_query,
      case when btrim(p_query) ~ '^[A-Za-z[:space:][:punct:]]+$'
        then pg_catalog.ts_rewrite(
          pg_catalog.ts_rewrite(
            pg_catalog.ts_rewrite(
              pg_catalog.ts_rewrite(
                pg_catalog.plainto_tsquery('english'::regconfig, btrim(p_query)),
                'cartridg'::tsquery, '(cartridg | filter)'::tsquery),
              'filter'::tsquery, '(cartridg | filter)'::tsquery),
            'chang'::tsquery, '(chang | replac)'::tsquery),
          'replac'::tsquery, '(chang | replac)'::tsquery)
        else null::tsquery end as english_query
  )
  select d.workspace_id, d.id, v.id, c.ordinal, c.page_no, d.title, d.source_label,
    c.section_label, c.content
  from public.knowledge_documents d
  join public.workspaces w on w.id = d.workspace_id
  join public.knowledge_versions v on v.workspace_id = d.workspace_id
    and v.document_id = d.id and v.id = d.published_version_id
  join public.knowledge_chunks c on c.workspace_id = v.workspace_id
    and c.document_id = v.document_id and c.version_id = v.id
  cross join search s
  where d.workspace_id = p_workspace_id and d.state = 'PUBLISHED'
    and d.generation = w.generation and v.generation = w.generation
    and v.index_state = 'READY' and char_length(s.literal_query) between 1 and 120
    and (
      position(lower(s.literal_query) in lower(c.content)) > 0
      or (pg_catalog.numnode(s.english_query) > 0
        and pg_catalog.to_tsvector('english'::regconfig, c.content) @@ s.english_query)
    )
  order by
    (position(lower(s.literal_query) in lower(c.content)) > 0) desc,
    pg_catalog.ts_rank_cd(pg_catalog.to_tsvector('english'::regconfig, c.content), s.english_query) desc nulls last,
    d.updated_at desc, c.ordinal
  limit least(greatest(coalesce(p_limit, 10), 1), 20);
$$;

revoke execute on function public.knowledge_search_keyword(uuid,text,integer)
  from public, anon;
grant execute on function public.knowledge_search_keyword(uuid,text,integer)
  to authenticated;
