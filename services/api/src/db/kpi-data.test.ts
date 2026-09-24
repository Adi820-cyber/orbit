import { describe, expect, it } from 'vitest';
import type { MembershipClaims } from '@orbit/contracts';
import type { Database, SqlParam } from './client.ts';
import {
  BREAKDOWN_SQL,
  BRIEF_EXCEPTIONS_SQL,
  createDbDatasetSource,
  createDbExceptionSource,
  createDbObservationSource,
  DATA_LIMITATIONS_SQL,
  DATASET_SQL,
  INBOX_ORDERING_BASIS,
  INBOX_SQL,
  OBSERVATIONS_BY_KEY_SQL,
  SERIES_SQL,
} from './kpi-data.ts';
import { MEMBERSHIP_SETTING } from './rls.ts';

/* Placeholder uuids only. */
const REGION = '00000000-0000-4000-8000-0000000000b1';
const claims: MembershipClaims = {
  membershipId: '00000000-0000-4000-8000-0000000000d1',
  subject: '00000000-0000-4000-8000-0000000000c1',
  organizationId: '00000000-0000-4000-8000-0000000000a1',
  role: 'regional-coo',
  scopes: [{ grain: 'region', entityId: REGION }],
};
const AUG = { cadence: 'month', start: '2026-08-01', end: '2026-08-31' } as const;

function scriptedDb(answer: (text: string) => readonly Record<string, unknown>[]) {
  const calls: { text: string; params: SqlParam[] }[] = [];
  const db: Database = {
    async transaction(fn) {
      return fn({
        async query(text, params = []) {
          calls.push({ text, params });
          return text.startsWith('select set_config') ? [] : answer(text);
        },
      });
    },
  };
  return { db, calls };
}

describe('DatasetSource', () => {
  it('reads the current dataset under the caller claims', async () => {
    const row = { datasetChecksum: 'c', definitionVersion: 'v1', asOf: '2026-09-02T06:00:00.000Z', currentPeriod: AUG };
    const { db, calls } = scriptedDb(() => [row]);
    expect(await createDbDatasetSource(db).current(claims)).toEqual(row);
    expect(calls[0]?.params[0]).toBe(MEMBERSHIP_SETTING);
    expect(calls[1]?.text).toBe(DATASET_SQL);
    expect(DATASET_SQL).toContain('d.is_current');
  });

  it('answers unavailable, not an invented period, when nothing is loaded', async () => {
    const { db } = scriptedDb(() => []);
    await expect(createDbDatasetSource(db).current(claims)).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('ObservationSource', () => {
  it('reads a series for one assignment and entity, from the current dataset only', async () => {
    const { db, calls } = scriptedDb(() => []);
    await createDbObservationSource(db).series(claims, { assignmentId: 'a', entity: { grain: 'region', entityId: REGION }, from: '2026-01-01' });
    expect(calls[1]).toMatchObject({ text: SERIES_SQL, params: ['a', 'region', REGION, '2026-01-01', null] });
    expect(SERIES_SQL).toContain('d.is_current');
    expect(SERIES_SQL).toContain('orbit.current_org()');
  });

  it('reads the facility split of a region for one period', async () => {
    const { db, calls } = scriptedDb(() => []);
    await createDbObservationSource(db).breakdown(claims, { assignmentId: 'a', parent: { grain: 'region', entityId: REGION }, grain: 'facility', period: AUG });
    expect(calls[1]).toMatchObject({ text: BREAKDOWN_SQL, params: ['a', 'facility', 'region', 'month', '2026-08-01', '2026-08-31', REGION] });
  });

  it('looks up evidence by observation key as one JSON parameter', async () => {
    const { db, calls } = scriptedDb(() => []);
    await createDbObservationSource(db).byIds(claims, ['obs:a:region:north:2026-08', "obs:b'; drop table x;--"]);
    expect(calls[1]).toMatchObject({ text: OBSERVATIONS_BY_KEY_SQL });
    expect(JSON.parse(String(calls[1]?.params[0]))).toEqual(['obs:a:region:north:2026-08', "obs:b'; drop table x;--"]);
  });

  it('never queries for a non-uuid entity or an empty id list', async () => {
    const { db, calls } = scriptedDb(() => []);
    const source = createDbObservationSource(db);
    expect(await source.series(claims, { assignmentId: 'a', entity: { grain: 'region', entityId: 'north' } })).toEqual([]);
    expect(await source.byIds(claims, [])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('ExceptionSource', () => {
  it('builds the brief from the current period, with no invented on-track items', async () => {
    const { db, calls } = scriptedDb(() => []);
    const brief = await createDbExceptionSource(db).brief(claims, AUG);
    expect(brief).toEqual({ exceptions: [], onTrack: [], dataLimitations: [] });
    expect(calls.map((call) => call.text).slice(1)).toEqual([BRIEF_EXCEPTIONS_SQL, DATA_LIMITATIONS_SQL]);
    expect(calls[1]?.params).toEqual(['2026-08-01', '2026-08-31']);
  });

  it('pages the inbox with an opaque offset cursor and states its ordering', async () => {
    const rows = [{ exceptionId: '1' }, { exceptionId: '2' }, { exceptionId: '3' }];
    const { db, calls } = scriptedDb(() => rows);
    const first = await createDbExceptionSource(db).inbox(claims, { limit: 2 });
    expect(calls[1]).toMatchObject({ text: INBOX_SQL, params: [0, 3] });
    expect(first.items).toHaveLength(2);
    expect(first.orderingBasis).toBe(INBOX_ORDERING_BASIS);
    await createDbExceptionSource(db).inbox(claims, { limit: 2, cursor: first.nextCursor ?? undefined });
    expect(calls.at(-1)?.params).toEqual([2, 3]);
    await expect(createDbExceptionSource(db).inbox(claims, { limit: 2, cursor: 'nope' })).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
