import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Sql } from 'postgres';
import { MembershipSchema, type MembershipClaims } from '@orbit/contracts';
import { loadMembership } from '../plugins/auth.ts';
import { entitlementsFor } from '../plugins/scope.ts';
import { connect, databaseFromSql, type Database, type SqlParam } from './client.ts';
import { createDbMembershipSource } from './memberships.ts';
import { MEMBERSHIP_SETTING, SUBJECT_SETTING, withMembershipTx } from './rls.ts';
import {
  createDbEntitlementSource,
  createDbEntityDirectory,
  ENTITY_DIRECTORY_SQL,
  createDbScopeResolver,
  ENTITLEMENT_SQL,
  MEMBERSHIP_SQL,
  membershipQuery,
} from './sources.ts';

/* Placeholder uuids; not seeded entities. */
const ORG = '00000000-0000-4000-8000-0000000000a1';
const REGION = '00000000-0000-4000-8000-0000000000b1';
const SUBJECT = '00000000-0000-4000-8000-0000000000c1';
const MEMBERSHIP_ID = '00000000-0000-4000-8000-0000000000d1';

const claims: MembershipClaims = {
  membershipId: MEMBERSHIP_ID,
  subject: SUBJECT,
  organizationId: ORG,
  role: 'regional-coo',
  scopes: [{ grain: 'region', entityId: REGION }],
};

interface Call {
  text: string;
  params: SqlParam[];
  tx: number;
}

/** Records every statement per transaction and answers data queries with `rows`. */
function recordingDb(rows: readonly Record<string, unknown>[]) {
  const calls: Call[] = [];
  let transactions = 0;
  const db: Database = {
    async transaction(fn) {
      const tx = ++transactions;
      return fn({
        async query(text, params = []) {
          calls.push({ text, params, tx });
          return text.startsWith('select set_config') ? [] : rows;
        },
      });
    },
  };
  return { db, calls };
}

describe('membership source', () => {
  const row = {
    membershipId: MEMBERSHIP_ID,
    subject: SUBJECT,
    organizationId: ORG,
    role: 'regional-coo',
    status: 'active',
    scopes: [{ grain: 'region', entityId: REGION }],
  };

  it('runs under the subject setting only, then the bound-parameter query', async () => {
    const { db, calls } = recordingDb([row]);
    await createDbMembershipSource(db, membershipQuery).findBySubject(SUBJECT);
    expect(calls.map((call) => [call.text.trim().split('\n')[0], call.params])).toEqual([
      ['select set_config($1, $2, true)', [SUBJECT_SETTING, SUBJECT]],
      ['select', [SUBJECT]],
    ]);
    expect(calls.some((call) => call.params.includes(MEMBERSHIP_SETTING))).toBe(false);
  });

  it('returns every row for the subject, active or not, filtered in SQL as well as by RLS', () => {
    expect(MEMBERSHIP_SQL).toContain('where m.subject = $1::uuid');
    expect(MEMBERSHIP_SQL).not.toMatch(/status\s*=\s*'active'/);
  });

  it('aliases columns to the Membership contract, so the auth plugin can parse them', async () => {
    const { db } = recordingDb([row]);
    const rows = await createDbMembershipSource(db, membershipQuery).findBySubject(SUBJECT);
    expect(MembershipSchema.safeParse(rows[0]).success).toBe(true);
    expect(await loadMembership(SUBJECT, createDbMembershipSource(db, membershipQuery))).toEqual(claims);
  });

  it('fails closed on a membership with no scopes (the SQL yields an empty array)', async () => {
    const { db } = recordingDb([{ ...row, scopes: [] }]);
    await expect(loadMembership(SUBJECT, createDbMembershipSource(db, membershipQuery))).rejects.toMatchObject({ code: 'internal' });
  });
});

describe('entitlement source', () => {
  const entitlement = {
    role: 'regional-coo',
    frameworkVersion: 'v1',
    assignmentId: 'regional-coo:hospital-and-clinic-capacity-utilisation',
    grains: ['region', 'facility'],
    breakdowns: ['facility'],
  };

  it('runs under the membership claims and filters on the role as well', async () => {
    const { db, calls } = recordingDb([entitlement]);
    await createDbEntitlementSource(db).forMembership(claims);
    expect(calls[0]?.params).toEqual([MEMBERSHIP_SETTING, JSON.stringify(claims)]);
    expect(calls[1]).toMatchObject({ text: ENTITLEMENT_SQL, params: ['regional-coo'] });
    expect(new Set(calls.map((call) => call.tx)).size).toBe(1);
  });

  it('feeds the scope plugin, which keeps only the served framework version', async () => {
    const { db } = recordingDb([entitlement, { ...entitlement, frameworkVersion: 'v0' }]);
    const deps = { entitlements: createDbEntitlementSource(db), resolver: { contains: async () => true }, frameworkVersion: 'v1' };
    expect(await entitlementsFor(claims, deps)).toEqual([entitlement]);
  });
});

describe('scope resolver', () => {
  it.each([
    ['region', 'orbit.regions'],
    ['facility', 'orbit.facilities'],
    ['coe', 'orbit.coes'],
  ] as const)('checks a %s against %s under RLS, pinned to the caller organization', async (grain, table) => {
    const { db, calls } = recordingDb([{ contained: true }]);
    expect(await createDbScopeResolver(db).contains(claims, { grain, entityId: REGION })).toBe(true);
    expect(calls[0]?.params[0]).toBe(MEMBERSHIP_SETTING);
    expect(calls[1]?.text).toContain(table);
    expect(calls[1]?.params).toEqual([REGION, ORG]);
  });

  it('requires an explicit group scope for the group grain', async () => {
    const { db, calls } = recordingDb([{ contained: false }]);
    expect(await createDbScopeResolver(db).contains(claims, { grain: 'group', entityId: ORG })).toBe(false);
    expect(calls[1]?.text).toContain('orbit.has_group_scope()');
  });

  it('never contains a non-uuid id, without querying', async () => {
    const { db, calls } = recordingDb([{ contained: true }]);
    expect(await createDbScopeResolver(db).contains(claims, { grain: 'region', entityId: 'not-a-uuid' })).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it.each([[[]], [[{ contained: true }, { contained: true }]], [[{ contained: 'yes' }]]])(
    'treats an unexpected result shape as not contained %#',
    async (rows) => {
      const { db } = recordingDb(rows);
      expect(await createDbScopeResolver(db).contains(claims, { grain: 'region', entityId: REGION })).toBe(false);
    },
  );
});

describe('entity directory', () => {
  const FACILITY = '00000000-0000-4000-8000-0000000000e1';

  it('runs under the membership claims, pinned to the caller organization', async () => {
    const { db, calls } = recordingDb([]);
    await createDbEntityDirectory(db).visible(claims);
    expect(calls[0]?.params[0]).toBe(MEMBERSHIP_SETTING);
    expect(calls[1]).toMatchObject({ text: ENTITY_DIRECTORY_SQL, params: [ORG] });
  });

  it('lists the organization only with an explicit group scope', () => {
    expect(ENTITY_DIRECTORY_SQL).toContain('orbit.has_group_scope()');
  });

  it('maps the parent columns onto a ScopeEntity, or null for the organization', async () => {
    const { db } = recordingDb([
      { grain: 'facility', entityId: FACILITY, label: 'Facility', parentGrain: 'region', parentId: REGION },
      { grain: 'group', entityId: ORG, label: 'Org', parentGrain: null, parentId: null },
    ]);
    expect(await createDbEntityDirectory(db).visible(claims)).toEqual([
      { grain: 'facility', entityId: FACILITY, label: 'Facility', parent: { grain: 'region', entityId: REGION } },
      { grain: 'group', entityId: ORG, label: 'Org', parent: null },
    ]);
  });

  it('passes an unexpected row through untouched so the route fails closed on it', async () => {
    const odd = { grain: 'segment', entityId: 'x', label: 'y', parentGrain: null, parentId: null };
    const { db } = recordingDb([odd]);
    expect(await createDbEntityDirectory(db).visible(claims)).toEqual([odd]);
  });
});

/*
 * ── Integration: the real SQL against a real database ─────────────────────
 *
 * Everything above proves the queries are *shaped* right by recording them
 * against a fake. That cannot catch a column that does not exist, a policy that
 * does not filter, or a grant that is too wide. Only a database can.
 *
 * These tests are deliberately weighted toward NEGATIVE cases. A positive
 * result ("the COO sees nine rows") can be produced by a broken policy plus a
 * correct WHERE clause. So the isolation checks below drop the WHERE clause and
 * let only RLS filter: if the policy is wrong, the test sees other roles' rows
 * and fails. That is the property PRD §9 criterion 2 actually asks for.
 *
 * Read-only. These tests insert and update nothing, which is why they are safe
 * to point at the shared dev project: they cannot alter its state. Set
 * ORBIT_TEST_DATABASE_URL to run; skipped otherwise, and a skip is
 * "not verified", never "passed".
 *
 * Timeout raised for the same measured reason as rls.test.ts — a cold pooler
 * connection to ap-south-1 cost 3728ms from a developer machine.
 */
const integrationUrl = process.env.ORBIT_TEST_DATABASE_URL;

/** Every role in the framework. The sum of their entitlements must be 109. */
const ALL_ROLES = [
  'chairman',
  'group-cfo',
  'regional-coo',
  'hospital-dho',
  'clinical-director',
  'billing-lead',
  'coe-lead',
  'corporate-revenue-lead',
  'bd-lead',
  'hr-head',
  'people-executive',
  'procurement-head',
  'legal-head',
  'analytics-head',
] as const;

/**
 * Claims carrying a role, and one placeholder scope.
 *
 * The scope is required, not decoration: `MembershipClaimsSchema` enforces
 * `scopes.min(1)`, so a membership with no scope cannot be represented at all.
 * That is deliberate fail-closed design — a member with nothing in scope should
 * not be expressible — and it is worth knowing before writing claims by hand.
 *
 * The entity id names nothing real, which is fine here: the entitlement policy
 * reads only the role. Tests that need a resolvable entity say so explicitly.
 */
function roleClaims(role: MembershipClaims['role']): MembershipClaims {
  return {
    membershipId: '00000000-0000-4000-8000-00000000f001',
    subject: '00000000-0000-4000-8000-00000000f002',
    organizationId: '00000000-0000-4000-8000-00000000f003',
    role,
    scopes: [{ grain: 'region', entityId: '00000000-0000-4000-8000-00000000f004' }],
  };
}

describe.skipIf(!integrationUrl)(
  'db sources (integration: real schema, forced RLS)',
  { timeout: 30_000 },
  () => {
    let sql: Sql;
    let db: Database;

    beforeAll(() => {
      sql = connect({ url: integrationUrl ?? '', ssl: process.env.ORBIT_TEST_DATABASE_SSL !== 'false' });
      db = databaseFromSql(sql);
    });

    afterAll(async () => {
      await sql.end({ timeout: 5 });
    });

    /** Counts rows visible to `role` with NO WHERE clause, so only RLS filters. */
    async function visibleEntitlementCount(role: MembershipClaims['role']): Promise<number> {
      const rows = await withMembershipTx(db, roleClaims(role), (tx) =>
        tx.query('select count(*)::int as n from orbit.entitlements'),
      );
      return Number((rows[0] as { n: number }).n);
    }

    it('connects as orbit_app, not a privileged role', async () => {
      const rows = await db.transaction((tx) =>
        tx.query(
          `select current_user as who,
                  (select rolsuper from pg_roles where rolname = current_user) as super,
                  (select rolbypassrls from pg_roles where rolname = current_user) as bypass`,
        ),
      );
      const row = rows[0] as { who: string; super: boolean; bypass: boolean };
      expect(row.who).toBe('orbit_app');
      // If either of these is true, every RLS assertion below is meaningless.
      expect(row.super).toBe(false);
      expect(row.bypass).toBe(false);
    });

    it('returns nothing at all without claims (fail closed)', async () => {
      for (const table of ['entitlements', 'organizations', 'org_memberships', 'regions', 'facilities']) {
        const rows = await db.transaction((tx) => tx.query(`select count(*)::int as n from orbit.${table}`));
        expect(Number((rows[0] as { n: number }).n), `orbit.${table} without claims`).toBe(0);
      }
    });

    it('serves every role an entitlement set, summing to the framework total', async () => {
      const source = createDbEntitlementSource(db);
      let total = 0;
      for (const role of ALL_ROLES) {
        const rows = await source.forMembership(roleClaims(role));
        expect(rows.length, `${role} has no entitlements`).toBeGreaterThan(0);
        for (const row of rows) {
          expect((row as { role: string }).role, `${role} received another role's row`).toBe(role);
        }
        total += rows.length;
      }
      expect(total, 'entitlement rows across all 14 roles').toBe(109);
    });

    it('does not leak another role\'s entitlements when only RLS filters', async () => {
      // The WHERE clause is gone; the policy is the only thing standing here.
      const coo = await visibleEntitlementCount('regional-coo');
      const chairman = await visibleEntitlementCount('chairman');

      expect(coo).toBeGreaterThan(0);
      expect(chairman).toBeGreaterThan(0);
      // Neither may see all 109, and the two must differ from the total.
      expect(coo).toBeLessThan(109);
      expect(chairman).toBeLessThan(109);

      const crossRead = await withMembershipTx(db, roleClaims('regional-coo'), (tx) =>
        tx.query("select count(*)::int as n from orbit.entitlements where role_id = 'chairman'"),
      );
      expect(Number((crossRead[0] as { n: number }).n), 'COO could read chairman entitlements').toBe(0);
    });

    /**
     * A forged role never reaches SQL. `withMembershipTx` parses the claims
     * through `MembershipClaimsSchema` before opening the transaction, so an
     * invented role is refused at the contract boundary — one layer earlier
     * than the RLS policy that would also have denied it.
     *
     * Asserting the throw rather than "0 rows" records where the protection
     * actually lives. A test that set `orbit.membership` directly would pass
     * while bypassing this guard entirely, and would therefore be measuring
     * less than it appears to.
     */
    it('refuses a forged role at the contract boundary, before any SQL runs', async () => {
      const forged = { ...roleClaims('regional-coo'), role: 'not-a-real-role' } as unknown as MembershipClaims;
      await expect(withMembershipTx(db, forged, async () => 'reached sql')).rejects.toThrow();
    });

    /** Same guard, the other required field: a membership with no scope is unrepresentable. */
    it('refuses claims with no scope at all', async () => {
      const scopeless = { ...roleClaims('regional-coo'), scopes: [] } as unknown as MembershipClaims;
      await expect(withMembershipTx(db, scopeless, async () => 'reached sql')).rejects.toThrow();
    });

    it('refuses a non-uuid entity id without raising a cast error', async () => {
      // The ::uuid cast would throw on this; the resolver must answer false.
      const resolver = createDbScopeResolver(db);
      await expect(
        resolver.contains(roleClaims('regional-coo'), { grain: 'region', entityId: 'fixture-region-a' }),
      ).resolves.toBe(false);
    });

    it('denies group grain without an explicit group scope', async () => {
      const resolver = createDbScopeResolver(db);
      const claimsWithoutGroup = roleClaims('chairman');
      await expect(
        resolver.contains(claimsWithoutGroup, {
          grain: 'group',
          entityId: claimsWithoutGroup.organizationId,
        }),
      ).resolves.toBe(false);
    });

    it('denies an entity that is not in the caller\'s organization', async () => {
      const resolver = createDbScopeResolver(db);
      // A well-formed uuid that names nothing the caller can see.
      await expect(
        resolver.contains(roleClaims('regional-coo'), {
          grain: 'facility',
          entityId: '00000000-0000-4000-8000-0000000fffff',
        }),
      ).resolves.toBe(false);
    });

    it('finds no membership for a subject that has none', async () => {
      const source = createDbMembershipSource(db, membershipQuery);
      await expect(source.findBySubject('00000000-0000-4000-8000-00000000dead')).resolves.toEqual([]);
    });
  },
);
