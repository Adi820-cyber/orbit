import { z } from 'zod';
import type { MembershipClaims, PageQuery, Period } from '@orbit/contracts';
import { ApiError } from '../plugins/errors.ts';
import type { DatasetSource, ExceptionSource, ObservationSource } from '../modules/ports.ts';
import type { Database } from './client.ts';
import { withMembershipTx } from './rls.ts';

/*
 * Postgres dataset, observation and exception sources (migration
 * 20260924000800, seed 0002). Every query reads only the organization's
 * current dataset, under the caller's claims: RLS limits rows to the caller's
 * organization and scope, and the API still checks the entitlement for the
 * assignment. Columns are aliased onto the contract keys; the modules parse
 * every row and fail closed on a mismatch.
 */

const ISO_UTC = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const PERIOD_OF = (alias: string) =>
  `jsonb_build_object('cadence', ${alias}.period_cadence, 'start', to_char(${alias}.period_start, 'YYYY-MM-DD'), 'end', to_char(${alias}.period_end, 'YYYY-MM-DD'))`;

export const DATASET_SQL = `
select
  d.checksum as "datasetChecksum",
  d.definition_version as "definitionVersion",
  to_char(d.as_of at time zone 'UTC', ${ISO_UTC}) as "asOf",
  jsonb_build_object('cadence', d.current_period_cadence, 'start', to_char(d.current_period_start, 'YYYY-MM-DD'), 'end', to_char(d.current_period_end, 'YYYY-MM-DD')) as "currentPeriod"
from orbit.datasets d
where d.is_current and d.organization_id = orbit.current_org()`;

/** Columns aliased to ObservationSchema. */
const OBSERVATION_COLUMNS = `
  o.observation_key as "observationId",
  o.assignment_id as "assignmentId",
  o.definition_family as "definitionFamily",
  o.definition_version as "definitionVersion",
  jsonb_build_object('grain', o.entity_grain, 'entityId', o.entity_id::text) as "entity",
  ${PERIOD_OF('o')} as "period",
  o.unit as "unit",
  o.value as "value",
  o.components as "components",
  o.target as "target",
  o.provenance as "provenance",
  o.data_quality as "dataQuality"`;

const CURRENT_OBSERVATIONS = `
from orbit.kpi_observations o
join orbit.datasets d on d.id = o.dataset_id and d.is_current
where o.organization_id = orbit.current_org()`;

export const SERIES_SQL = `
select ${OBSERVATION_COLUMNS}
${CURRENT_OBSERVATIONS}
  and o.assignment_id = $1 and o.entity_grain = $2 and o.entity_id = $3::uuid
  and ($4::date is null or o.period_start >= $4::date)
  and ($5::date is null or o.period_end <= $5::date)
order by o.period_start`;

/**
 * Children of `parent` at `grain` for one period. Group children are the
 * whole organization (RLS still limits them to the caller's scope); a region's
 * facilities are those in it; a COE's facility is its host.
 */
export const BREAKDOWN_SQL = `
select ${OBSERVATION_COLUMNS}
${CURRENT_OBSERVATIONS}
  and o.assignment_id = $1 and o.entity_grain = $2
  and o.period_cadence = $4 and o.period_start = $5::date and o.period_end = $6::date
  and case
    when $3 = 'group' then o.entity_grain <> 'group'
    when $3 = 'region' and $2 = 'facility' then exists (
      select 1 from orbit.facilities f where f.id = o.entity_id and f.region_id = $7::uuid)
    when $3 = 'coe' and $2 = 'facility' then exists (
      select 1 from orbit.coes c where c.id = $7::uuid and c.host_facility_id = o.entity_id)
    else false
  end
order by o.entity_grain, o.entity_id`;

export const OBSERVATIONS_BY_KEY_SQL = `
select ${OBSERVATION_COLUMNS}
${CURRENT_OBSERVATIONS}
  and o.observation_key in (select jsonb_array_elements_text($1::jsonb))`;

/** Columns aliased to ExceptionSchema; actionState is the latest action the caller can see on it. */
const EXCEPTION_COLUMNS = `
  x.exception_key as "exceptionId",
  x.assignment_id as "assignmentId",
  jsonb_build_object('grain', x.entity_grain, 'entityId', x.entity_id::text) as "entity",
  ${PERIOD_OF('x')} as "period",
  x.priority as "priority",
  x.category as "category",
  x.comparison_basis as "comparisonBasis",
  x.detection as "detection",
  x.what_changed as "whatChanged",
  x.why_it_matters as "whyItMatters",
  jsonb_build_object('role', x.owner_role) as "owner",
  coalesce((
    select a.state from orbit.actions a
    where a.assignment_id = x.assignment_id and a.entity_grain = x.entity_grain and a.entity_id = x.entity_id
    order by a.created_at desc limit 1
  ), 'none') as "actionState",
  x.evidence as "evidence",
  x.provenance as "provenance",
  x.data_quality as "dataQuality"`;

const CURRENT_EXCEPTIONS = `
from orbit.exceptions x
join orbit.datasets d on d.id = x.dataset_id and d.is_current
where x.organization_id = orbit.current_org()`;

export const BRIEF_EXCEPTIONS_SQL = `
select ${EXCEPTION_COLUMNS}
${CURRENT_EXCEPTIONS}
  and x.period_start = $1::date and x.period_end = $2::date
order by (x.priority = 'act_now') desc, x.exception_key`;

export const DATA_LIMITATIONS_SQL = `
select l.assignment_id as "assignmentId", l.issue as "issue", l.detail as "detail"
from orbit.data_limitations l
join orbit.datasets d on d.id = l.dataset_id and d.is_current
where l.organization_id = orbit.current_org()
order by l.assignment_id nulls first, l.issue`;

/** Transparent, fixed ordering (PRD FR-03), returned to the user verbatim. */
export const INBOX_ORDERING_BASIS =
  'Act now before monitor; then safety, legal, compliance, and performance; then newest period first.';

export const INBOX_SQL = `
select ${EXCEPTION_COLUMNS}
${CURRENT_EXCEPTIONS}
order by (x.priority = 'act_now') desc,
  array_position(array['safety', 'legal', 'compliance', 'performance'], x.category),
  x.period_start desc, x.exception_key
offset $1 limit $2`;

const EntityIdSchema = z.uuid();
const OffsetCursorSchema = z.strictObject({ offset: z.number().int().min(0) });

function decodeOffset(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  try {
    return OffsetCursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))).offset;
  } catch {
    throw new ApiError('invalid_request', 'The request is invalid.', 'malformed_cursor');
  }
}

function encodeOffset(offset: number): string {
  return Buffer.from(JSON.stringify({ offset })).toString('base64url');
}

export function createDbDatasetSource(db: Database): DatasetSource {
  return {
    current: (membership) =>
      withMembershipTx(db, membership, async (tx) => {
        const rows = await tx.query(DATASET_SQL);
        if (rows.length === 0) {
          throw new ApiError('unavailable', 'No dataset has been loaded yet.', 'no_current_dataset');
        }
        return rows[0];
      }),
  };
}

export function createDbObservationSource(db: Database): ObservationSource {
  return {
    async series(membership, query) {
      if (!EntityIdSchema.safeParse(query.entity.entityId).success) return [];
      return withMembershipTx(db, membership, (tx) =>
        tx.query(SERIES_SQL, [query.assignmentId, query.entity.grain, query.entity.entityId, query.from ?? null, query.to ?? null]),
      );
    },
    async breakdown(membership, query) {
      if (!EntityIdSchema.safeParse(query.parent.entityId).success) return [];
      const period: Period = query.period;
      return withMembershipTx(db, membership, (tx) =>
        tx.query(BREAKDOWN_SQL, [
          query.assignmentId,
          query.grain,
          query.parent.grain,
          period.cadence,
          period.start,
          period.end,
          query.parent.entityId,
        ]),
      );
    },
    async byIds(membership, observationIds) {
      if (observationIds.length === 0) return [];
      return withMembershipTx(db, membership, (tx) => tx.query(OBSERVATIONS_BY_KEY_SQL, [JSON.stringify(observationIds)]));
    },
  };
}

export function createDbExceptionSource(db: Database): ExceptionSource {
  return {
    brief: (membership: MembershipClaims, period: Period) =>
      withMembershipTx(db, membership, async (tx) => ({
        exceptions: await tx.query(BRIEF_EXCEPTIONS_SQL, [period.start, period.end]),
        // No on-track rows are generated yet; an empty section, not an invented one.
        onTrack: [],
        dataLimitations: await tx.query(DATA_LIMITATIONS_SQL),
      })),

    async inbox(membership, page: PageQuery) {
      const offset = decodeOffset(page.cursor);
      return withMembershipTx(db, membership, async (tx) => {
        const rows = await tx.query(INBOX_SQL, [offset, page.limit + 1]);
        return {
          items: rows.slice(0, page.limit),
          nextCursor: rows.length > page.limit ? encodeOffset(offset + page.limit) : null,
          orderingBasis: INBOX_ORDERING_BASIS,
        };
      });
    },
  };
}
