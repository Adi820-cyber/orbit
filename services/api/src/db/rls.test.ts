import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Sql } from 'postgres';
import { claimsFor, SUBJECT } from '../../test/helpers/fixtures.ts';
import { connect, databaseFromSql, type Database, type SqlParam, type Tx } from './client.ts';
import { MEMBERSHIP_SETTING, SUBJECT_SETTING, withMembershipTx, withSubjectTx } from './rls.ts';

/** A fake Database that records every query and whether a transaction was opened. */
function recordingDb() {
  const calls: Array<{ text: string; params: SqlParam[] | undefined }> = [];
  const state = { opened: false };
  const db: Database = {
    async transaction(fn) {
      state.opened = true;
      return fn({
        async query(text, params) {
          calls.push({ text, params });
          return [];
        },
      });
    },
  };
  return { db, calls, state };
}

describe('withMembershipTx (unit)', () => {
  it('sets the verified claims as a transaction-local, parameterized setting before running fn', async () => {
    const { db, calls } = recordingDb();
    const claims = claimsFor(SUBJECT.cooRegionA);
    const result = await withMembershipTx(db, claims, async (tx) => {
      await tx.query('select 1');
      return 'done';
    });

    expect(result).toBe('done');
    expect(calls[0]).toEqual({
      text: 'select set_config($1, $2, true)',
      params: [MEMBERSHIP_SETTING, JSON.stringify(claims)],
    });
    expect(calls[1]?.text).toBe('select 1');
  });

  it('refuses claims that violate the contract before touching the database', async () => {
    const { db, state } = recordingDb();
    const invalid = { ...claimsFor(SUBJECT.cooRegionA), scopes: [] };
    await expect(withMembershipTx(db, invalid, async () => 'x')).rejects.toThrow();
    expect(state.opened).toBe(false);
  });
});

describe('withSubjectTx (unit)', () => {
  it('sets only the verified subject, transaction-local and parameterized, before running fn', async () => {
    const { db, calls } = recordingDb();
    const result = await withSubjectTx(db, SUBJECT.cooRegionA, async (tx) => {
      await tx.query('select 1');
      return 'done';
    });

    expect(result).toBe('done');
    expect(calls[0]).toEqual({
      text: 'select set_config($1, $2, true)',
      params: [SUBJECT_SETTING, SUBJECT.cooRegionA],
    });
    expect(calls[1]?.text).toBe('select 1');
  });

  it('never sets membership claims during bootstrap', async () => {
    const { db, calls } = recordingDb();
    await withSubjectTx(db, SUBJECT.cooRegionA, async () => undefined);
    expect(calls.flatMap((call) => call.params ?? [])).not.toContain(MEMBERSHIP_SETTING);
  });

  it.each(['', 'not-a-uuid', `${SUBJECT.cooRegionA}' or '1'='1`])(
    'refuses a non-uuid subject %j before touching the database',
    async (subject) => {
      const { db, state } = recordingDb();
      await expect(withSubjectTx(db, subject, async () => 'x')).rejects.toThrow();
      expect(state.opened).toBe(false);
    },
  );
});

/*
 * Integration: needs a disposable Postgres (a local one, or the approved
 * dev/test Supabase project). Set ORBIT_TEST_DATABASE_URL to run; set
 * ORBIT_TEST_DATABASE_SSL=false for a local database without TLS.
 * Skipped otherwise — a skip is "not verified", never "passed".
 * No live project may be used until ADR 0001 is Accepted.
 */
const url = process.env.ORBIT_TEST_DATABASE_URL;

describe.skipIf(!url)('RLS settings (integration: never leak across transactions)', () => {
  let sql: Sql;
  let db: Database;

  beforeAll(() => {
    sql = connect({ url: url ?? '', ssl: process.env.ORBIT_TEST_DATABASE_SSL !== 'false' });
    db = databaseFromSql(sql); // one connection (max: 1), reused across transactions
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function settingIn(tx: Tx, name: string): Promise<unknown> {
    const [row] = await tx.query('select current_setting($1, true) as value', [name]);
    return row?.value;
  }

  async function settingNow(name: string): Promise<unknown> {
    return db.transaction((tx) => settingIn(tx, name));
  }

  it('membership claims are visible inside the transaction', async () => {
    const claims = claimsFor(SUBJECT.cooRegionA);
    const seen = await withMembershipTx(db, claims, (tx) => settingIn(tx, MEMBERSHIP_SETTING));
    expect(JSON.parse(String(seen))).toEqual(claims);
  });

  it('membership claims are gone in the next transaction after commit', async () => {
    await withMembershipTx(db, claimsFor(SUBJECT.cooRegionA), async () => undefined);
    expect(await settingNow(MEMBERSHIP_SETTING)).toBeOneOf([null, '']);
  });

  it('membership claims are gone in the next transaction after rollback', async () => {
    await expect(
      withMembershipTx(db, claimsFor(SUBJECT.cooRegionA), async () => {
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');
    expect(await settingNow(MEMBERSHIP_SETTING)).toBeOneOf([null, '']);
  });

  it('does not carry region A claims into a region B transaction', async () => {
    await withMembershipTx(db, claimsFor(SUBJECT.cooRegionA), async () => undefined);
    const seen = await withMembershipTx(db, claimsFor(SUBJECT.cooRegionB), (tx) => settingIn(tx, MEMBERSHIP_SETTING));
    expect(JSON.parse(String(seen))).toEqual(claimsFor(SUBJECT.cooRegionB));
  });

  it('the subject is visible inside the bootstrap transaction, without membership claims', async () => {
    const seen = await withSubjectTx(db, SUBJECT.cooRegionA, async (tx) => ({
      subject: await settingIn(tx, SUBJECT_SETTING),
      membership: await settingIn(tx, MEMBERSHIP_SETTING),
    }));
    expect(seen.subject).toBe(SUBJECT.cooRegionA);
    expect(seen.membership).toBeOneOf([null, '']);
  });

  it('the subject is gone in the next transaction after commit and after rollback', async () => {
    await withSubjectTx(db, SUBJECT.cooRegionA, async () => undefined);
    expect(await settingNow(SUBJECT_SETTING)).toBeOneOf([null, '']);

    await expect(
      withSubjectTx(db, SUBJECT.cooRegionA, async () => {
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');
    expect(await settingNow(SUBJECT_SETTING)).toBeOneOf([null, '']);
  });

  it('the policy expression nullif(..., \'\')::uuid matches nothing (not an error) once the setting is spent', async () => {
    await withSubjectTx(db, SUBJECT.cooRegionA, async () => undefined);
    const value = await db.transaction(async (tx) => {
      const [row] = await tx.query("select nullif(current_setting($1, true), '')::uuid as subject", [SUBJECT_SETTING]);
      return row?.subject;
    });
    expect(value).toBeNull();
  });
});
