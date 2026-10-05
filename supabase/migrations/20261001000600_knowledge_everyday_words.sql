-- ============================================================================
-- 20261001000600_knowledge_everyday_words.sql
--
-- Lets the chatbot's word search understand the words people ask with, not
-- only the words the data is written in. Access is unchanged: row-level
-- security on knowledge_chunks still decides what each role can see.
--
-- Found in use (2026-10-05): the Corporate Revenue & Insurance Lead asked
-- "how much insurance are claimed" and "how was income" and got "nothing
-- available", although the role may read "Billing and collections" and
-- "Insurance cover of patients". The question's embedding had failed (the
-- free embedding provider's daily limit was spent), so only word search ran,
-- and it needs a chunk to contain half of the question's words:
--   - "much" counted as a word to find, though it says nothing about the topic;
--   - the data says "revenue", "billing", "collections", "insurance", "payer",
--     never "income" or "claimed".
--
-- What changes:
--   1. orbit.knowledge_search_words: a short, reviewable list of everyday words
--      and the words the data uses for the same thing ("income" -> revenue,
--      billing, collections), and of filler words that are ignored ("much",
--      "tell"). A question word counts as found in a chunk when the chunk has
--      it or one of its listed equivalents.
--   2. orbit.knowledge_question_terms(question): the question's words, each with
--      what it may match. Used by search; also testable on its own.
--   3. orbit.search_knowledge: same signature, results and ordering rules; it
--      now matches through (2). Meaning search (embeddings) is unchanged.
-- ============================================================================

create table orbit.knowledge_search_words (
  word       text primary key,
  -- Words the data uses for the same thing. Empty for a filler word.
  equivalent text[] not null default '{}',
  -- A filler word is dropped from the question before matching.
  filler     boolean not null default false,
  constraint knowledge_search_words_format check (word ~ '^[a-z]+$'),
  constraint knowledge_search_words_kind check (filler = (cardinality(equivalent) = 0))
);

comment on table orbit.knowledge_search_words is
  'Everyday words in chatbot questions and the words Orbit''s data uses for them, plus filler words the '
  'search ignores. Affects which chunks match, never which chunks a role may read (that is row-level security).';

insert into orbit.knowledge_search_words (word, equivalent, filler) values
  -- Money coming in
  ('income',      array['revenue', 'billing', 'collections'], false),
  ('earnings',    array['revenue', 'billing', 'collections'], false),
  ('earned',      array['revenue', 'billing', 'collections'], false),
  ('sales',       array['revenue', 'billing'], false),
  ('turnover',    array['revenue', 'billing'], false),
  ('money',       array['revenue', 'billing', 'collections', 'cash'], false),
  ('revenue',     array['billing', 'collections'], false),
  ('billed',      array['billing', 'bills'], false),
  ('paid',        array['payment', 'collections'], false),
  ('profit',      array['margin', 'ebitda'], false),
  ('profitability', array['margin', 'ebitda'], false),
  -- Money owed
  ('dues',        array['outstanding', 'unpaid', 'receivables'], false),
  ('owed',        array['outstanding', 'unpaid', 'receivables'], false),
  ('pending',     array['outstanding', 'unpaid'], false),
  ('debt',        array['outstanding', 'receivables'], false),
  -- Insurance
  ('claimed',     array['insurance', 'claim', 'payer', 'insurer'], false),
  ('claims',      array['insurance', 'claim', 'payer', 'insurer'], false),
  ('claim',       array['insurance', 'payer', 'insurer'], false),
  ('insurance',   array['insurer', 'payer', 'claim', 'policies'], false),
  ('insured',     array['insurance', 'policy', 'policies'], false),
  ('insurer',     array['insurance', 'payer'], false),
  ('insurers',    array['insurance', 'payer'], false),
  ('tpa',         array['insurance', 'payer', 'insurer'], false),
  ('rejected',    array['denied', 'rejection'], false),
  -- Costs
  ('expenses',    array['cost', 'costs'], false),
  ('spend',       array['cost', 'costs'], false),
  ('spending',    array['cost', 'costs'], false),
  -- People
  ('employees',   array['staff', 'workforce'], false),
  ('employee',    array['staff', 'workforce'], false),
  ('staff',       array['workforce', 'staffing', 'rostered'], false),
  ('nurses',      array['staff', 'workforce'], false),
  ('salary',      array['workforce', 'cost'], false),
  ('salaries',    array['workforce', 'cost'], false),
  ('attendance',  array['punch', 'late', 'absent', 'shifts'], false),
  -- Medicines and stock
  ('medicine',    array['medicines', 'drug', 'stock'], false),
  ('drugs',       array['medicines', 'drug', 'stock'], false),
  ('inventory',   array['stock', 'reorder'], false),
  ('shortage',    array['reorder', 'low', 'short'], false),
  ('vendors',     array['suppliers', 'supplier'], false),
  ('vendor',      array['suppliers', 'supplier'], false),
  -- Patients and capacity
  ('admitted',    array['admissions', 'admission'], false),
  ('admits',      array['admissions', 'admission'], false),
  ('beds',        array['ward', 'wards', 'occupancy'], false),
  ('occupancy',   array['beds', 'occupied'], false),
  ('opd',         array['outpatient', 'appointments'], false),
  ('appointments', array['outpatient', 'visits'], false),
  ('tests',       array['diagnostic', 'lab'], false),
  ('diseases',    array['diagnoses', 'diagnosis'], false),
  -- Filler: says nothing about the topic
  ('much',        '{}', true),
  ('many',        '{}', true),
  ('tell',        '{}', true),
  ('show',        '{}', true),
  ('give',        '{}', true),
  ('please',      '{}', true),
  ('know',        '{}', true),
  ('want',        '{}', true),
  ('get',         '{}', true),
  ('overall',     '{}', true),
  ('currently',   '{}', true);

alter table orbit.knowledge_search_words enable row level security;
alter table orbit.knowledge_search_words force row level security;
create policy knowledge_search_words_read on orbit.knowledge_search_words
  for select to orbit_app using (true);
grant select on orbit.knowledge_search_words to orbit_app;

-- ---------------------------------------------------------------------------
-- The question's words, each with the word stems it may match
-- ---------------------------------------------------------------------------
create function orbit.knowledge_question_terms(p_query text)
  returns table (term text, matches text[])
  language sql
  stable
  security invoker
  set search_path = pg_catalog
as $$
  with words as (
    -- The question's word stems, as the English configuration stems them
    -- (stop words such as "how", "are", "was" are already dropped).
    select distinct l as term
    from unnest(tsvector_to_array(to_tsvector('english', coalesce(p_query, '')))) l
    where l ~ '^[a-z0-9]+$'
  ),
  listed as (
    -- Listed words by their stem, so "claims", "claimed" and "claim" all find their row.
    select (tsvector_to_array(to_tsvector('english', w.word)))[1] as stem, w.equivalent, w.filler
    from orbit.knowledge_search_words w
  )
  select q.term,
         array(
           select distinct s from (
             select q.term as s
             union all
             select e from listed li, unnest(li.equivalent) eq,
                    unnest(tsvector_to_array(to_tsvector('english', eq))) e
             where li.stem = q.term
           ) x
           where s ~ '^[a-z0-9]+$'
           order by s
         )
  from words q
  where not exists (select 1 from listed li where li.stem = q.term and li.filler)
  order by q.term
$$;

comment on function orbit.knowledge_question_terms(text) is
  'The question''s word stems (filler words dropped), each with the stems it may match: itself and the '
  'equivalents listed in orbit.knowledge_search_words.';

revoke all on function orbit.knowledge_question_terms(text) from public;
grant execute on function orbit.knowledge_question_terms(text) to orbit_app;

-- ---------------------------------------------------------------------------
-- Search: as 20261001000400, matching each question word through its equivalents
-- ---------------------------------------------------------------------------
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
    -- One row per question word (filler dropped), with the stems it may match.
    -- The stems are already stemmed, so they are matched with the 'simple'
    -- configuration, not stemmed again.
    select t.term, t.matches, to_tsquery('simple', array_to_string(t.matches, ' | ')) as query
    from orbit.knowledge_question_terms(p_query) t
  ),
  tsq as (
    -- Any of the words, to find candidates; coverage below counts how many of them each has.
    select array_to_string(array(select distinct m from terms, unnest(terms.matches) m), ' | ') as any_text,
           (select count(*) from terms) as n
  ),
  vec as (
    select k.id, 1 - (k.embedding <=> p_embedding) as score
    from orbit.knowledge_chunks k
    where p_embedding is not null and k.embedding is not null
    order by k.embedding <=> p_embedding
    limit greatest(p_limit, 1) * 4
  ),
  matches as (
    select k.id, tsq.n,
           (select count(*) from terms t where k.fts @@ t.query) as found,
           ts_rank_cd(k.fts, to_tsquery('simple', tsq.any_text), 32) as density
    from orbit.knowledge_chunks k, tsq
    where tsq.n > 0 and k.fts @@ to_tsquery('simple', tsq.any_text)
  ),
  fts as (
    -- A chunk must contain at least half of the question's words (or their
    -- equivalents), and never fewer than two when the question has two: one
    -- shared word ("late", "hospital") is not an answer, and saying nothing
    -- matched is more useful than listing unrelated items. (Filler words used
    -- to pad the count; without them, "staff late" must find both words.)
    select m.id, 0.75 * (m.found::float / m.n) + 0.25 * m.density as score
    from matches m
    where m.found >= greatest(ceil(m.n / 2.0), least(m.n, 2))
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
