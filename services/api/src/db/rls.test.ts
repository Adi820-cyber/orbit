import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Sql } from 'postgres';
import { claimsFor, SUBJECT } from '../../test/helpers/fixtures.ts';
import { connect, databaseFromSql, type Database, type SqlParam } from './client.ts';
import { MEMBERSHIP_SETTING, withMembershipTx } from './rls.ts';

describe('withMembershipTx (unit)', () => {
  it('sets the verified claims as a transaction-local, parameterized setting before running fn', async () => {
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
    let opened = false;
    const db: Database = {
      async transaction(fn) {
        opened = true;
        return fn({ query: async () => [] });
      },
    };
    const invalid = { ...claimsFor(SUBJECT.cooRegionA), scopes: [] };
    await expect(withMembershipTx(db, invalid, async () => 'x')).rejects.toThrow();
    expect(opened).toBe(false);
  });
});

/*
 * Integration: needs a disposable Postgres (a local one, or the approved
 * dev/test Supabase project). Set ORBIT_TEST_DATABASE_URL to run; set
 * ORBIT_TEST_DATABASE_SSL=false for a local database without TLS.
 * Skipped otherwise — a skip is "not verified", never "passed".
 */
const url = process.env.ORBIT_TEST_DATABASE_URL;

describe.skipIf(!url)('withMembershipTx (integration: claims never leak across transactions)', () => {
  let sql: Sql;
  let db: Database;

  beforeAll(() => {
    sql = connect({ url: url ?? '', ssl: process.env.ORBIT_TEST_DATABASE_SSL !== 'false' });
    db = databaseFromSql(sql); // one connection (max: 1), reused across transactions
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function currentSetting(): Promise<unknown> {
    return db.transaction(async (tx) => {
      const [row] = await tx.query('select current_setting($1, true) as value', [MEMBERSHIP_SETTING]);
      return row?.value;
    });
  }

  it('is visible inside the transaction', async () => {
    const claims = claimsFor(SUBJECT.cooRegionA);
    const seen = await withMembershipTx(db, claims, async (tx) => {
      const [row] = await tx.query('select current_setting($1, true) as value', [MEMBERSHIP_SETTING]);
      return row?.value;
    });
    expect(JSON.parse(String(seen))).toEqual(claims);
  });

  it('is gone in the next transaction on the same connection after commit', async () => {
    await withMembershipTx(db, claimsFor(SUBJECT.cooRegionA), async () => undefined);
    expect(await currentSetting()).toBeOneOf([null, '']);
  });

  it('is gone in the next transaction on the same connection after rollback', async () => {
    await expect(
      withMembershipTx(db, claimsFor(SUBJECT.cooRegionA), async () => {
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');
    expect(await currentSetting()).toBeOneOf([null, '']);
  });

  it('does not carry region A claims into a region B transaction', async () => {
    await withMembershipTx(db, claimsFor(SUBJECT.cooRegionA), async () => undefined);
    const seen = await withMembershipTx(db, claimsFor(SUBJECT.cooRegionB), async (tx) => {
      const [row] = await tx.query('select current_setting($1, true) as value', [MEMBERSHIP_SETTING]);
      return row?.value;
    });
    expect(JSON.parse(String(seen))).toEqual(claimsFor(SUBJECT.cooRegionB));
  });
});
