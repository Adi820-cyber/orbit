-- ============================================================================
-- 20261001000250_knowledge_abac.sql
--
-- Makes the chatbot's knowledge base attribute-based and self-filling
-- (ADR 0019). Builds on 20261001000200_knowledge_chunks.sql.
--
-- AUTHORED BY: Ghansham, at the product owner's request, for Maruti's review
-- (supabase/ is her path) and Aditya's (authorization: the role-to-domain
-- grants below are PROPOSED, not approved).
--
-- WHAT CHANGES
--   1. Who may read a chunk is now decided by ATTRIBUTES, in the database:
--        organization  AND  the caller's verified scope covers the chunk's
--        entity  AND  (the caller's role is listed on the chunk, OR the role
--        holds a grant on the chunk's domain; `*` is every domain).
--      The old rule "empty visible_roles means every role" is gone: a chunk
--      nobody is granted is visible to nobody (fail closed). The old table
--      held no rows, so no data changes meaning.
--   2. Chunks are built FROM the database by orbit.knowledge_refresh(): KPI
--      definitions, the latest KPI reading per entity, exceptions, data
--      limitations and hospital-operations aggregates. Unchanged content is
--      not touched, so it is never re-embedded.
--   3. Search works with or without an embedding: Postgres full-text search
--      always, plus cosine similarity when a query vector is given.
--   4. A small queue (knowledge_pending / knowledge_set_embedding) lets the
--      sync job fill embeddings without any other write access.
--   5. The ivfflat index is replaced by exact search (see the note below).
--
-- ONLY AGGREGATES AND FRAMEWORK TEXT ARE EVER STORED HERE. No patient, staff
-- or visit record is read by knowledge_refresh(): the operations text comes
-- from orbit_erp.ops_snapshot() / ops_daily(), the same counts-only functions
-- Orbit's operations page uses (ADR 0018).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Domain grants: which role may read which domain of knowledge
--
-- KPI chunks are not granted by domain: each names the role that owns the
-- KPI (visible_roles). A domain grant is for knowledge that is not one role's.
-- Keep the hospital-operations roles in step with OPERATIONS_FEED_ROLES in
-- @orbit/contracts (the API gate for the operations page).
-- ---------------------------------------------------------------------------
create table orbit.knowledge_role_access (
  role_id text not null references orbit.role_ids (role_id),
  domain  text not null,
  primary key (role_id, domain),
  constraint knowledge_role_access_domain_format check (domain = '*' or domain ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

comment on table orbit.knowledge_role_access is
  'Role-to-domain grants for knowledge chunks. domain = ''*'' grants every domain (the chairman: the whole organization). PROPOSED; Aditya approves.';

insert into orbit.knowledge_role_access (role_id, domain) values
  ('chairman',         '*'),
  ('clinical-director', 'hospital-operations'),
  ('regional-coo',      'hospital-operations'),
  ('hospital-dho',      'hospital-operations'),
  ('people-executive',  'hospital-operations'),
  ('hr-head',           'hospital-operations');

alter table orbit.knowledge_role_access enable row level security;
alter table orbit.knowledge_role_access force row level security;
create policy knowledge_role_access_read on orbit.knowledge_role_access
  for select to orbit_app using (true);
grant select on orbit.knowledge_role_access to orbit_app;

-- ---------------------------------------------------------------------------
-- Chunk columns
-- ---------------------------------------------------------------------------
alter table orbit.knowledge_chunks
  add column domain          text not null default 'general',
  -- Stable key for a generated chunk, so a refresh updates it in place.
  add column source_key      text,
  add column content_hash    text,
  -- The content_hash the stored embedding was made from; differs while a chunk awaits embedding.
  add column embedded_hash   text,
  add column embedding_model text,
  add column updated_at      timestamptz not null default now(),
  add column fts             tsvector generated always as (to_tsvector('english', title || ' ' || content)) stored,
  add constraint knowledge_chunks_entity_pair check ((entity_grain is null) = (entity_id is null)),
  add constraint knowledge_chunks_domain_format check (domain ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

create unique index knowledge_chunks_source_key_uq
  on orbit.knowledge_chunks (organization_id, source_key) where source_key is not null;
create index knowledge_chunks_fts_idx on orbit.knowledge_chunks using gin (fts);
create index knowledge_chunks_domain_idx on orbit.knowledge_chunks (organization_id, domain);

-- Exact search instead of ivfflat. ivfflat with 100 lists over a few thousand
-- rows probes one list and misses most true neighbours; and an approximate
-- index filters AFTER it searches, so a role that may see a small share of the
-- chunks could get back almost nothing. At this size an exact scan is
-- millisecond-fast and always right. Add an hnsw index (with iterative scans)
-- if the table grows past roughly ten thousand chunks.
drop index orbit.knowledge_chunks_embedding_idx;

-- The application role needs USAGE on the schema holding pgvector, or the <=>
-- operator and the vector type cannot be resolved when it searches. It never
-- had it, so vector search could not have run for orbit_app before this.
-- (USAGE exposes names, not data: functions there stay governed by their own
-- grants, and Supabase already grants this schema to its other API roles.)
grant usage on schema extensions to orbit_app;

-- ---------------------------------------------------------------------------
-- The access rule
-- ---------------------------------------------------------------------------
drop policy knowledge_chunks_select_own_org on orbit.knowledge_chunks;

create policy knowledge_chunks_select_abac
  on orbit.knowledge_chunks
  for select to orbit_app
  using (
    organization_id = orbit.current_org()
    and orbit.current_role_id() is not null           -- a leader; an ERP operator has no role here
    and (entity_grain is null or orbit.scope_within_caller(entity_grain, entity_id))
    and (
      orbit.current_role_id() = any (visible_roles)
      or exists (
        select 1 from orbit.knowledge_role_access a
        where a.role_id = orbit.current_role_id()
          and a.domain in (knowledge_chunks.domain, '*')
      )
    )
  );

-- The earlier search function took an unscoped entity filter from its caller
-- and was never used by the API. Replaced by orbit.search_knowledge below.
drop function orbit.match_knowledge(extensions.vector, float, int, text, uuid);

-- ---------------------------------------------------------------------------
-- Search: full-text always, vector when a query embedding is supplied
--
-- security INVOKER, so the policy above decides what is searched. The query is
-- turned into an OR of its word stems, so a natural-language question matches
-- on any content word (the usual AND semantics find nothing for a sentence).
-- ---------------------------------------------------------------------------
create function orbit.search_knowledge(
  p_query     text,
  p_embedding extensions.vector(1536) default null,
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
  with q as (
    select nullif(array_to_string(array(
             select l from unnest(tsvector_to_array(to_tsvector('english', coalesce(p_query, '')))) l
             where l ~ '^[a-z0-9]+$'), ' | '), '') as txt
  ),
  tsq as (select to_tsquery('english', txt) as query from q where txt is not null),
  vec as (
    select k.id, 1 - (k.embedding <=> p_embedding) as score
    from orbit.knowledge_chunks k
    where p_embedding is not null and k.embedding is not null
    order by k.embedding <=> p_embedding
    limit greatest(p_limit, 1) * 3
  ),
  fts as (
    select k.id, ts_rank_cd(k.fts, tsq.query, 32) as score
    from orbit.knowledge_chunks k, tsq
    where k.fts @@ tsq.query
    order by 2 desc
    limit greatest(p_limit, 1) * 3
  ),
  merged as (
    select coalesce(v.id, f.id) as id, v.score as vscore, f.score as fscore
    from vec v full join fts f on f.id = v.id
    where f.id is not null or v.score > p_threshold
  )
  select
    k.id, k.title, k.content, k.source, k.domain,
    least(1.0, greatest(coalesce(m.vscore, 0), coalesce(m.fscore, 0)) + case when m.vscore is not null and m.fscore is not null then 0.1 else 0 end)::float,
    case when m.vscore is not null and m.fscore is not null then 'hybrid'
         when m.vscore is not null then 'vector' else 'text' end,
    k.updated_at
  from merged m
  join orbit.knowledge_chunks k on k.id = m.id
  order by 6 desc, k.title
  limit greatest(p_limit, 1)
$$;

comment on function orbit.search_knowledge is
  'Full-text plus optional vector search over knowledge_chunks. security invoker: row-level security (organization, scope, role/domain) decides what is searched.';

-- ---------------------------------------------------------------------------
-- Helpers used only while building chunk text
-- ---------------------------------------------------------------------------
create function orbit.knowledge_measure_text(p_value jsonb, p_unit text)
  returns text
  language sql
  immutable
  set search_path = pg_catalog
as $$
  select case p_value ->> 'status'
    when 'available'      then (p_value ->> 'value') || ' ' || p_unit
    when 'missing'        then 'not reported'
    when 'not_applicable' then 'not applicable (' || replace(coalesce(p_value ->> 'reason', 'no denominator'), '_', ' ') || ')'
    else 'unknown'
  end
$$;

create function orbit.knowledge_target_text(p_target jsonb, p_unit text)
  returns text
  language sql
  immutable
  set search_path = pg_catalog
as $$
  select case p_target ->> 'state'
    when 'configured' then 'Target ' || (p_target ->> 'value') || ' ' || p_unit || ' ('
      || replace(p_target ->> 'direction', '_', ' ') || ', ' || replace(p_target ->> 'approval', '_', ' ') || ')'
    when 'configured_range' then 'Target range ' || (p_target ->> 'low') || ' to ' || (p_target ->> 'high') || ' ' || p_unit
      || ' (' || replace(p_target ->> 'approval', '_', ' ') || ')'
    else 'No approved target is configured'
  end
$$;

create function orbit.knowledge_entity_name(p_grain text, p_id uuid)
  returns text
  language sql
  stable
  set search_path = pg_catalog, public
as $$
  select case p_grain
    when 'group'    then (select o.name from orbit.organizations o where o.id = p_id)
    when 'region'   then (select r.name from orbit.regions r where r.id = p_id)
    when 'facility' then (select f.name from orbit.facilities f where f.id = p_id)
    when 'coe'      then (select c.name from orbit.coes c where c.id = p_id)
  end
$$;

revoke all on function orbit.knowledge_measure_text(jsonb, text) from public;
revoke all on function orbit.knowledge_target_text(jsonb, text) from public;
revoke all on function orbit.knowledge_entity_name(text, uuid) from public;

-- ---------------------------------------------------------------------------
-- Build the chunks from the database
--
-- Idempotent and deterministic: a chunk whose text is unchanged is not touched
-- (so its embedding stays valid); one whose source is gone is deleted. Only
-- chunks whose source starts with 'auto:' are managed; manual chunks are left
-- alone. SECURITY DEFINER because it reads every organization's data to build
-- text, and it takes no input that shapes what it writes. It borrows group
-- scope for the operations functions only inside its own transaction and puts
-- the caller's claims back before returning.
-- ---------------------------------------------------------------------------
create function orbit.knowledge_refresh()
  returns table (kind text, chunks integer)
  language plpgsql
  security definer
  set search_path = pg_catalog, public
as $$
declare
  v_org        record;
  v_saved      text := current_setting('orbit.membership', true);
begin
  create temporary table if not exists _kw (
    organization_id uuid not null,
    source_key      text not null,
    source          text not null,
    domain          text not null,
    visible_roles   text[] not null,
    entity_grain    text,
    entity_id       uuid,
    title           text not null,
    content         text not null
  ) on commit drop;
  truncate _kw;

  -- 1. KPI definitions: one per assignment, visible to the owning role.
  insert into _kw
  select o.id, 'kpi-def:' || a.assignment_id, 'auto:kpi-definition', 'kpi-definitions', array[a.role_id], null, null,
         'KPI definition: ' || a.kpi,
         'Role: ' || r.name || '. KPI: ' || a.kpi || '. Key deliverable: ' || a.key_deliverable
         || '. Definition: ' || a.definition || '. Target basis: ' || a.target_basis
         || '. Review: ' || a.review || '. Primary data source: ' || a.primary_data_source
         || case when a.key_collaborator <> '' then '. Key collaborator: ' || a.key_collaborator else '' end
         || '. Weight in the role scorecard: ' || round(a.weight * 100)::text || ' percent.'
  from orbit.organizations o
  cross join orbit.role_kpi_assignments a
  join orbit.framework_versions fv on fv.id = a.framework_version_id and fv.is_current
  join orbit.roles r on r.framework_version_id = a.framework_version_id and r.role_id = a.role_id;

  -- 2. The latest KPI reading for every assignment and entity, visible to the owning role.
  insert into _kw
  select ob.organization_id,
         'kpi:' || ob.assignment_id || ':' || ob.entity_grain || ':' || ob.entity_id,
         'auto:kpi-reading', 'kpi', array[split_part(ob.assignment_id, ':', 1)], ob.entity_grain, ob.entity_id,
         a.kpi || ' for ' || coalesce(orbit.knowledge_entity_name(ob.entity_grain, ob.entity_id), ob.entity_grain),
         a.kpi || ' for ' || coalesce(orbit.knowledge_entity_name(ob.entity_grain, ob.entity_id), 'the ' || ob.entity_grain)
         || ' (' || ob.entity_grain || '), ' || ob.period_cadence || ' ' || ob.period_start || ' to ' || ob.period_end
         || ': ' || orbit.knowledge_measure_text(ob.value, ob.unit) || '. '
         || orbit.knowledge_target_text(ob.target, ob.unit) || '.'
         || coalesce((
              select ' Components: ' || string_agg(c ->> 'label' || ' ' || orbit.knowledge_measure_text(c -> 'value', c ->> 'unit'), '; ')
              from jsonb_array_elements(ob.components) c
              having count(*) > 0), '')
         || ' Data quality: ' || coalesce(ob.data_quality ->> 'freshness', 'unknown') || ', '
         || coalesce(ob.data_quality ->> 'reconciliation', 'unknown') || '. Illustrative data.'
  from (
    select distinct on (o2.organization_id, o2.assignment_id, o2.entity_grain, o2.entity_id) o2.*
    from orbit.kpi_observations o2
    order by o2.organization_id, o2.assignment_id, o2.entity_grain, o2.entity_id, o2.period_start desc
  ) ob
  join orbit.framework_versions fv on fv.is_current
  join orbit.role_kpi_assignments a on a.framework_version_id = fv.id and a.assignment_id = ob.assignment_id;

  -- 3. Exceptions: visible to the owner role and the role whose KPI raised it.
  insert into _kw
  select distinct on (e.organization_id, e.exception_key)
         e.organization_id, 'exc:' || e.exception_key, 'auto:kpi-exception', 'kpi-exceptions',
         (select array_agg(distinct x) from unnest(array[e.owner_role, split_part(e.assignment_id, ':', 1)]) x),
         e.entity_grain, e.entity_id,
         'Exception (' || replace(e.priority, '_', ' ') || '): ' || a.kpi,
         'Exception, ' || replace(e.priority, '_', ' ') || ', ' || e.category || ', for '
         || coalesce(orbit.knowledge_entity_name(e.entity_grain, e.entity_id), 'the ' || e.entity_grain)
         || ', ' || e.period_start || ' to ' || e.period_end || '. KPI: ' || a.kpi
         || '. What changed: ' || e.what_changed || ' Why it matters: ' || e.why_it_matters
         || ' Owner role: ' || e.owner_role || '. Illustrative data.'
  from orbit.exceptions e
  join orbit.framework_versions fv on fv.is_current
  join orbit.role_kpi_assignments a on a.framework_version_id = fv.id and a.assignment_id = e.assignment_id
  order by e.organization_id, e.exception_key, e.period_start desc;

  -- 4. Data limitations: the owning role, or every role when not tied to one KPI.
  insert into _kw
  select distinct on (l.organization_id, l.issue, coalesce(l.assignment_id, ''), l.detail)
         l.organization_id, 'lim:' || l.issue || ':' || coalesce(l.assignment_id, 'all') || ':' || md5(l.detail),
         'auto:data-limitation', 'kpi-limitations',
         case when l.assignment_id is null then (select array_agg(r.role_id) from orbit.role_ids r) else array[split_part(l.assignment_id, ':', 1)] end,
         null, null,
         'Data limitation (' || l.issue || ')' || coalesce(': ' || a.kpi, ''),
         'Data limitation, ' || l.issue || coalesce(' for ' || a.kpi, '') || ': ' || l.detail
  from orbit.data_limitations l
  left join orbit.framework_versions fv on fv.is_current
  left join orbit.role_kpi_assignments a on a.framework_version_id = fv.id and a.assignment_id = l.assignment_id;

  -- 5. Hospital operations: counts per hospital, per region and for the group,
  --    from the same functions as the operations page. Group scope is borrowed
  --    for one organization at a time and the caller's claims restored after.
  create temporary table if not exists _ops_f (
    organization_id uuid, facility_id uuid, active_staff int, rostered_today int, on_duty_now int, late_today int,
    missing_punch_today int, absent_today int, doctors_total int, doctors_attention int, open_visits int,
    open_inpatients int, visits_started_today int, visits_started_7d int, services_today int, services_7d int,
    pending_corrections int, finished int, completed int, on_time int
  ) on commit drop;
  truncate _ops_f;

  for v_org in select o.id from orbit.organizations o loop
    perform set_config('orbit.membership', json_build_object(
      'membershipId', gen_random_uuid(), 'subject', gen_random_uuid(), 'organizationId', v_org.id, 'role', 'chairman',
      'scopes', json_build_array(json_build_object('grain', 'group', 'entityId', v_org.id)))::text, true);
    insert into _ops_f
    select v_org.id, s.facility_id, s.active_staff, s.rostered_today, s.on_duty_now, s.late_today,
           s.missing_punch_today, s.absent_today, s.doctors_total,
           s.doctors_expiring + s.doctors_expired + s.doctors_suspended, s.open_visits, s.open_inpatients,
           s.visits_started_today, s.visits_started_7d, s.services_today, s.services_7d, s.pending_corrections,
           coalesce(d.finished, 0), coalesce(d.completed, 0), coalesce(d.on_time, 0)
    from orbit_erp.ops_snapshot() s
    left join (
      select x.facility_id, sum(x.rostered - x.in_progress)::int as finished,
             sum(x.present + x.late + x.early_exit)::int as completed, sum(x.present)::int as on_time
      from orbit_erp.ops_daily(14) x group by x.facility_id
    ) d on d.facility_id = s.facility_id;
  end loop;
  perform set_config('orbit.membership', coalesce(v_saved, ''), true);

  insert into _kw
  select u.organization_id, 'ops:' || u.grain || ':' || u.entity_id, 'auto:operations', 'hospital-operations', '{}',
         u.grain, u.entity_id,
         'Hospital operations: ' || u.name,
         'Hospital operations for ' || u.name || ' (' || u.grain || case when u.grain = 'facility' then '' else ', ' || u.hospitals || ' hospitals' end
         || '), simulated demonstration data. Staffing: ' || u.active_staff || ' active staff, ' || u.rostered_today
         || ' rostered today, ' || u.on_duty_now || ' on duty now, ' || u.late_today || ' late, ' || u.absent_today
         || ' absent, ' || u.missing_punch_today || ' with a missing punch. Doctors: ' || u.doctors_total || ', of which '
         || u.doctors_attention || ' have a credential expiring, expired or suspended. Visits: ' || u.open_visits
         || ' open (' || u.open_inpatients || ' inpatient), ' || u.visits_started_today || ' started today, '
         || u.visits_started_7d || ' in the last 7 days. Services delivered: ' || u.services_today || ' today, '
         || u.services_7d || ' in the last 7 days. Attendance corrections awaiting review: ' || u.pending_corrections
         || '. Attendance over the last 14 finished days: ' || u.finished || ' shifts ended, complete in and out '
         || case when u.finished > 0 then round(100.0 * u.completed / u.finished, 1)::text || ' percent' else 'not applicable' end
         || ', on time '
         || case when u.finished > 0 then round(100.0 * u.on_time / u.finished, 1)::text || ' percent' else 'not applicable' end || '.'
  from (
    select f.organization_id, 'facility' as grain, f.facility_id as entity_id, fa.name, 1 as hospitals,
           f.active_staff, f.rostered_today, f.on_duty_now, f.late_today, f.missing_punch_today, f.absent_today,
           f.doctors_total, f.doctors_attention, f.open_visits, f.open_inpatients, f.visits_started_today,
           f.visits_started_7d, f.services_today, f.services_7d, f.pending_corrections, f.finished, f.completed, f.on_time
    from _ops_f f join orbit.facilities fa on fa.id = f.facility_id
    union all
    select f.organization_id, 'region', fa.region_id, re.name, count(*)::int,
           sum(f.active_staff), sum(f.rostered_today), sum(f.on_duty_now), sum(f.late_today), sum(f.missing_punch_today),
           sum(f.absent_today), sum(f.doctors_total), sum(f.doctors_attention), sum(f.open_visits), sum(f.open_inpatients),
           sum(f.visits_started_today), sum(f.visits_started_7d), sum(f.services_today), sum(f.services_7d),
           sum(f.pending_corrections), sum(f.finished), sum(f.completed), sum(f.on_time)
    from _ops_f f join orbit.facilities fa on fa.id = f.facility_id join orbit.regions re on re.id = fa.region_id
    group by f.organization_id, fa.region_id, re.name
    union all
    select f.organization_id, 'group', f.organization_id, o.name, count(*)::int,
           sum(f.active_staff), sum(f.rostered_today), sum(f.on_duty_now), sum(f.late_today), sum(f.missing_punch_today),
           sum(f.absent_today), sum(f.doctors_total), sum(f.doctors_attention), sum(f.open_visits), sum(f.open_inpatients),
           sum(f.visits_started_today), sum(f.visits_started_7d), sum(f.services_today), sum(f.services_7d),
           sum(f.pending_corrections), sum(f.finished), sum(f.completed), sum(f.on_time)
    from _ops_f f join orbit.organizations o on o.id = f.organization_id
    group by f.organization_id, o.name
  ) u;

  -- Upsert changed chunks; leave unchanged ones (and their embeddings) alone.
  insert into orbit.knowledge_chunks as k
    (organization_id, source_key, source, domain, visible_roles, entity_grain, entity_id, title, content, content_hash)
  select w.organization_id, w.source_key, w.source, w.domain, w.visible_roles, w.entity_grain, w.entity_id,
         w.title, w.content, md5(w.title || E'\n' || w.content)
  from _kw w
  on conflict (organization_id, source_key) where source_key is not null
  do update set source = excluded.source, domain = excluded.domain, visible_roles = excluded.visible_roles,
                entity_grain = excluded.entity_grain, entity_id = excluded.entity_id,
                title = excluded.title, content = excluded.content,
                content_hash = excluded.content_hash, updated_at = now()
  where k.content_hash is distinct from excluded.content_hash
     or k.visible_roles is distinct from excluded.visible_roles;

  -- Remove generated chunks whose source is gone.
  delete from orbit.knowledge_chunks k
  where k.source like 'auto:%'
    and not exists (select 1 from _kw w where w.organization_id = k.organization_id and w.source_key = k.source_key);

  return query
    select substr(k.source, 6), count(*)::int
    from orbit.knowledge_chunks k where k.source like 'auto:%'
    group by k.source order by 1;
end;
$$;

comment on function orbit.knowledge_refresh() is
  'Builds and refreshes the generated knowledge chunks from the database. Idempotent; leaves unchanged chunks and their embeddings alone. Reads aggregates and framework text only.';

-- ---------------------------------------------------------------------------
-- Embedding queue
-- ---------------------------------------------------------------------------
create function orbit.knowledge_pending(p_limit integer default 50)
  returns table (id uuid, content_hash text, text_to_embed text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, public
as $$
  select k.id, k.content_hash, k.title || E'\n' || k.content
  from orbit.knowledge_chunks k
  where k.content_hash is not null and k.embedded_hash is distinct from k.content_hash
  order by k.updated_at
  limit least(greatest(p_limit, 1), 200)
$$;

-- Stores an embedding only if the chunk still has the text it was made from.
create function orbit.knowledge_set_embedding(
  p_id        uuid,
  p_hash      text,
  p_embedding extensions.vector(1536),
  p_model     text
)
  returns boolean
  language plpgsql
  security definer
  set search_path = pg_catalog, public, extensions
as $$
declare v_rows integer;
begin
  update orbit.knowledge_chunks
     set embedding = p_embedding, embedded_hash = p_hash, embedding_model = p_model
   where id = p_id and content_hash = p_hash;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke all on function orbit.knowledge_refresh() from public;
revoke all on function orbit.knowledge_pending(integer) from public;
revoke all on function orbit.knowledge_set_embedding(uuid, text, extensions.vector, text) from public;
revoke all on function orbit.search_knowledge(text, extensions.vector, integer, float) from public;
grant execute on function orbit.knowledge_refresh() to orbit_app;
grant execute on function orbit.knowledge_pending(integer) to orbit_app;
grant execute on function orbit.knowledge_set_embedding(uuid, text, extensions.vector, text) to orbit_app;
grant execute on function orbit.search_knowledge(text, extensions.vector, integer, float) to orbit_app;
