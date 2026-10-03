import { describe, expect, it } from 'vitest';
import { MEMBERSHIPS, SUBJECT } from '../../test/helpers/fixtures.ts';
import { loadMembership } from '../plugins/auth.ts';
import type { Database, SqlParam } from './client.ts';
import { createDbMembershipSource } from './memberships.ts';
import { SUBJECT_SETTING } from './rls.ts';

function fakeDb() {
  const calls: Array<{ text: string; params: SqlParam[] | undefined }> = [];
  const db: Database = {
    async transaction(fn) {
      return fn({
        async query(text, params) {
          calls.push({ text, params });
          return [];
        },
      });
    },
  };
  return { db, calls };
}

describe('createDbMembershipSource', () => {
  it('sets the subject before running the membership query, and passes the subject to it', async () => {
    const { db, calls } = fakeDb();
    const seen: string[] = [];
    const source = createDbMembershipSource(db, async (tx, subject) => {
      seen.push(subject);
      await tx.query('select /* membership query */ 1', [subject]);
      return [];
    });

    await source.findBySubject(SUBJECT.cooRegionA);

    expect(calls.map((call) => call.text)).toEqual([
      'select set_config($1, $2, true)',
      'select /* membership query */ 1',
    ]);
    expect(calls[0]?.params).toEqual([SUBJECT_SETTING, SUBJECT.cooRegionA]);
    expect(seen).toEqual([SUBJECT.cooRegionA]);
  });

  it('feeds the existing auth checks: one active row is accepted', async () => {
    const { db } = fakeDb();
    const row = MEMBERSHIPS.find((membership) => membership.subject === SUBJECT.cooRegionA);
    const source = createDbMembershipSource(db, async () => (row ? [row] : []));
    const claims = await loadMembership(SUBJECT.cooRegionA, source);
    expect('role' in claims && claims.role).toBe('regional-coo');
  });

  it('feeds the existing auth checks: inactive and ambiguous rows are still denied', async () => {
    const { db } = fakeDb();
    const inactive = createDbMembershipSource(db, async () =>
      MEMBERSHIPS.filter((membership) => membership.subject === SUBJECT.inactive),
    );
    const ambiguous = createDbMembershipSource(db, async () =>
      MEMBERSHIPS.filter((membership) => membership.subject === SUBJECT.ambiguous),
    );
    await expect(loadMembership(SUBJECT.inactive, inactive)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(loadMembership(SUBJECT.ambiguous, ambiguous)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('fails closed with 500 when a row arrives without scopes', async () => {
    const { db } = fakeDb();
    const row = MEMBERSHIPS.find((membership) => membership.subject === SUBJECT.cooRegionA);
    const source = createDbMembershipSource(db, async () => (row ? [{ ...row, scopes: [] }] : []));
    await expect(loadMembership(SUBJECT.cooRegionA, source)).rejects.toMatchObject({ code: 'internal' });
  });
});
