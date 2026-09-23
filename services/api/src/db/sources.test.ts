import { describe, expect, it } from 'vitest';
import { MembershipSchema, type MembershipClaims } from '@orbit/contracts';
import { loadMembership } from '../plugins/auth.ts';
import { entitlementsFor } from '../plugins/scope.ts';
import type { Database, SqlParam } from './client.ts';
import { createDbMembershipSource } from './memberships.ts';
import { MEMBERSHIP_SETTING, SUBJECT_SETTING } from './rls.ts';
import {
  createDbEntitlementSource,
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
