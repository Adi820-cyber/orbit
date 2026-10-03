-- ============================================================================
-- 20261001000400_knowledge_free_embeddings.sql
--
-- Moves the knowledge base to a FREE embedding model and makes embedding cheap
-- enough for a free-tier key (ADR 0019 §5, revised 2026-10-03).
--
-- 1. MODEL: liquid/lfm-2.5-embedding-350m:free on OpenRouter, which returns
--    1024 numbers per text (the paid text-embedding-3-small returned 1536).
--    Chosen after testing the free models: it separated a staffing question
--    from unrelated finance text best. The column changes size; no chunk had
--    an embedding yet, so nothing is lost.
-- 2. EMBED MEANING, NOT FIGURES: a free key allows about 50 free-model
--    requests a day. The operations chunks change every ten minutes because
--    their counts change, so embedding the raw text would spend that allowance
--    in a few hours. The text sent for embedding now has its figures masked,
--    and a chunk is re-embedded only when that masked text changes: a count
--    going from 52 to 53 costs nothing; a new KPI or a reworded definition does.
--    Search still returns the chunk's full, current text with its figures.
-- ============================================================================

-- 1. Vector size ------------------------------------------------------------
update orbit.knowledge_chunks set embedding = null, embedded_hash = null, embedding_model = null;
alter table orbit.knowledge_chunks alter column embedding type extensions.vector(1024);

-- The text that is embedded: title and content with every figure masked.
create function orbit.knowledge_embed_text(p_title text, p_content text)
  returns text
  language sql
  immutable
  set search_path = pg_catalog
as $$
  select regexp_replace(p_title || E'
' || p_content, '[0-9]+([.,:/-][0-9]+)*', '#', 'g')
$$;
revoke all on function orbit.knowledge_embed_text(text, text) from public;

-- 2. Queue: by meaning ------------------------------------------------------
drop function orbit.knowledge_pending(integer);
create function orbit.knowledge_pending(p_limit integer default 50)
  returns table (id uuid, embed_hash text, text_to_embed text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, public
as $$
  select k.id, md5(orbit.knowledge_embed_text(k.title, k.content)), orbit.knowledge_embed_text(k.title, k.content)
  from orbit.knowledge_chunks k
  where k.embedded_hash is distinct from md5(orbit.knowledge_embed_text(k.title, k.content))
  order by k.updated_at
  limit least(greatest(p_limit, 1), 200)
$$;

-- Stores an embedding only if the chunk still means what was embedded.
create or replace function orbit.knowledge_set_embedding(
  p_id        uuid,
  p_hash      text,
  p_embedding extensions.vector(1024),
  p_model     text
)
  returns boolean
  language plpgsql
  security definer
  set search_path = pg_catalog, public, extensions
as $$
declare v_rows integer;
begin
  update orbit.knowledge_chunks k
     set embedding = p_embedding, embedded_hash = p_hash, embedding_model = p_model
   where k.id = p_id and md5(orbit.knowledge_embed_text(k.title, k.content)) = p_hash;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke all on function orbit.knowledge_pending(integer) from public;
grant execute on function orbit.knowledge_pending(integer) to orbit_app;

-- 3. Search takes a 1024-number question vector ----------------------------
create or replace function orbit.search_knowledge(
  p_query     text,
  p_embedding extensions.vector(1024) default null,
  p_limit     integer default 6,
  p_threshold float   default 0.25
)
returns table (
  id         uuid,
  title      text,
  content    text,
  source     text,
  domain     text,
  similarity float,
  matched_by text,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = extensions, pg_catalog
as $$
  with terms as (
    -- The question's word stems (stop words dropped). They are already stemmed,
    -- so they are matched with the 'simple' configuration, not stemmed again.
    select array(
      select distinct l from unnest(tsvector_to_array(to_tsvector('english', coalesce(p_query, '')))) l
      where l ~ '^[a-z0-9]+$'
    ) as t
  ),
  tsq as (
    select to_tsquery('simple', array_to_string(t, ' | ')) as query, t, cardinality(t) as n
    from terms where cardinality(t) > 0
  ),
  vec as (
    select k.id, 1 - (k.embedding <=> p_embedding) as score
    from orbit.knowledge_chunks k
    where p_embedding is not null and k.embedding is not null
    order by k.embedding <=> p_embedding
    limit greatest(p_limit, 1) * 4
  ),
  matches as (
    select k.id,
           (select count(*) from unnest(tsq.t) l where k.fts @@ to_tsquery('simple', l))::float / tsq.n as coverage,
           ts_rank_cd(k.fts, tsq.query, 32) as density
    from orbit.knowledge_chunks k, tsq
    where k.fts @@ tsq.query
  ),
  fts as (
    -- A chunk must contain at least half of the question's words: a shared
    -- word ("late", "hospital") is not an answer, and saying nothing matched is
    -- more useful than listing unrelated items.
    select m.id, 0.75 * m.coverage + 0.25 * m.density as score
    from matches m
    where m.coverage >= 0.5
    order by 2 desc
    limit greatest(p_limit, 1) * 8
  ),
  merged as (
    select coalesce(v.id, f.id) as id, v.score as vscore, f.score as fscore
    from vec v full join fts f on f.id = v.id
    where f.id is not null or v.score > p_threshold
  ),
  scored as (
    select k.id, k.title, k.content, k.source, k.domain, k.updated_at, k.entity_grain, k.entity_id,
           case k.entity_grain when 'group' then 0 when 'region' then 1 when 'facility' then 2 when 'coe' then 3 else 4 end as breadth,
           least(1.0, greatest(coalesce(m.vscore, 0), coalesce(m.fscore, 0))
             + case when m.vscore is not null and m.fscore is not null then 0.1 else 0 end)::float as similarity,
           case when m.vscore is not null and m.fscore is not null then 'hybrid'
                when m.vscore is not null then 'vector' else 'text' end as matched_by
    from merged m
    join orbit.knowledge_chunks k on k.id = m.id
  ),
  distinct_text as (
    -- One chunk per title and entity: the same KPI owned by two roles reads the same.
    select distinct on (s.title, s.entity_grain, s.entity_id) s.*
    from scored s
    order by s.title, s.entity_grain, s.entity_id, s.similarity desc
  )
  select d.id, d.title, d.content, d.source, d.domain, d.similarity, d.matched_by, d.updated_at
  from distinct_text d
  -- Scores within a few hundredths are ties; a tie goes to the broader entity,
  -- so an organization-wide question gets the total before each hospital.
  order by round(d.similarity::numeric, 1) desc, d.breadth, d.similarity desc, d.title
  limit greatest(p_limit, 1)
$$;
