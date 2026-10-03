-- ============================================================================
-- 20261001000300_knowledge_quality.sql
--
-- Fixes found by asking the chatbot real questions as six roles on the dev
-- project (ADR 0019 "Verification", 2026-10-03). Replaces two functions from
-- 20261001000250; no table, policy or grant changes.
--
-- 1. CORRECTNESS: knowledge_refresh() read KPI observations, exceptions and
--    limitations from EVERY dataset. The dev project holds an older dataset
--    beside the current one, so a chunk could state the stale figure (Group
--    EBITDA 103.8 percent) while the brief, from the current dataset, said
--    82.6 percent. Now only the organization's current dataset is used, the
--    same rule as the brief, inbox and explorer.
-- 2. RANKING: search_knowledge() ranked by text density alone, so a question
--    about "staff on duty at my hospital" ranked finance exceptions (which say
--    "hospital") above the staffing chunk (which says staff, duty and
--    hospital). It now ranks by how many of the question's words a chunk
--    contains, then by density; ties go to the broader entity (group, then
--    region, then hospital), so an organization-wide question gets the total
--    first.
-- 3. DUPLICATES: two roles can own the same KPI (chairman and group CFO both
--    own Group EBITDA), which produced the same chunk twice. A caller who may
--    see both (the chairman) now gets one per title and entity.
-- 4. NOISE: a chunk must contain at least half of the question's words, so
--    a CFO asking about staff gets "nothing in your area", not finance items
--    that merely share the word "late". Exception titles now name their
--    hospital, region or group, so several exceptions on one KPI are told apart.
-- ============================================================================

create or replace function orbit.knowledge_refresh()
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
    join orbit.datasets ds on ds.id = o2.dataset_id and ds.is_current
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
         'Exception (' || replace(e.priority, '_', ' ') || '): ' || a.kpi
         || coalesce(', ' || orbit.knowledge_entity_name(e.entity_grain, e.entity_id), ''),
         'Exception, ' || replace(e.priority, '_', ' ') || ', ' || e.category || ', for '
         || coalesce(orbit.knowledge_entity_name(e.entity_grain, e.entity_id), 'the ' || e.entity_grain)
         || ', ' || e.period_start || ' to ' || e.period_end || '. KPI: ' || a.kpi
         || '. What changed: ' || e.what_changed || ' Why it matters: ' || e.why_it_matters
         || ' Owner role: ' || e.owner_role || '. Illustrative data.'
  from orbit.exceptions e
  join orbit.datasets ds on ds.id = e.dataset_id and ds.is_current
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
  join orbit.datasets ds on ds.id = l.dataset_id and ds.is_current
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

-- ---------------------------------------------------------------------------
-- Search: words matched first, then density; vector when an embedding is given
-- ---------------------------------------------------------------------------
create or replace function orbit.search_knowledge(
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

