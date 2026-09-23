import type { Entitlement, Membership, MembershipClaims, ScopeEntity } from '@orbit/contracts';
import type { MembershipSource } from '../../src/plugins/auth.ts';
import type { EntitlementSource, ScopeResolver } from '../../src/plugins/scope.ts';

/*
 * Placeholder identifiers only. These are not Maruti's generated entities,
 * facility names, or assignment ids; replace with snapshot fixtures once
 * `data/snapshots` exists.
 */
export const ORG_A = '00000000-0000-4000-8000-00000000000a';
export const ORG_B = '00000000-0000-4000-8000-00000000000b';

export const SUBJECT = {
  cooRegionA: '10000000-0000-4000-8000-000000000001',
  cooRegionB: '10000000-0000-4000-8000-000000000002',
  inactive: '10000000-0000-4000-8000-000000000003',
  ambiguous: '10000000-0000-4000-8000-000000000004',
  unknown: '10000000-0000-4000-8000-000000000005',
} as const;

function membership(
  index: number,
  subject: string,
  overrides: Partial<Membership> = {},
): Membership {
  return {
    membershipId: `20000000-0000-4000-8000-00000000000${index}`,
    subject,
    organizationId: ORG_A,
    role: 'regional-coo',
    scopes: [{ grain: 'region', entityId: 'fixture-region-a' }],
    status: 'active',
    ...overrides,
  };
}

export const MEMBERSHIPS: readonly Membership[] = [
  membership(1, SUBJECT.cooRegionA),
  membership(2, SUBJECT.cooRegionB, { scopes: [{ grain: 'region', entityId: 'fixture-region-b' }] }),
  membership(3, SUBJECT.inactive, { status: 'inactive' }),
  membership(4, SUBJECT.ambiguous),
  membership(5, SUBJECT.ambiguous, { role: 'hospital-dho', scopes: [{ grain: 'facility', entityId: 'fixture-facility-a1' }] }),
];

export function fixtureMemberships(rows: readonly unknown[] = MEMBERSHIPS): MembershipSource {
  return {
    async findBySubject(subject) {
      return rows.filter(
        (row) => typeof row === 'object' && row !== null && 'subject' in row && row.subject === subject,
      );
    },
  };
}

export function claimsFor(subject: string): MembershipClaims {
  const found = MEMBERSHIPS.find((row) => row.subject === subject);
  if (!found) {
    throw new Error(`No fixture membership for ${subject}`);
  }
  const { status: _status, ...claims } = found;
  return claims;
}

export const ENTITLEMENTS: readonly Entitlement[] = [
  { role: 'regional-coo', frameworkVersion: 'v1', assignmentId: 'fixture-assignment-1', grains: ['region', 'facility'], breakdowns: ['facility'] },
  { role: 'regional-coo', frameworkVersion: 'v1', assignmentId: 'fixture-assignment-2', grains: ['region'], breakdowns: [] },
];

export function fixtureEntitlements(rows: readonly unknown[] = ENTITLEMENTS): EntitlementSource {
  return {
    async forMembership({ role }) {
      return rows.filter((row) => typeof row === 'object' && row !== null && 'role' in row && row.role === role);
    },
  };
}

/** Fixture hierarchy: entity → (organization, region). */
const HIERARCHY: Record<string, { organizationId: string; region: string }> = {
  'fixture-region-a': { organizationId: ORG_A, region: 'fixture-region-a' },
  'fixture-region-b': { organizationId: ORG_A, region: 'fixture-region-b' },
  'fixture-facility-a1': { organizationId: ORG_A, region: 'fixture-region-a' },
  'fixture-facility-a2': { organizationId: ORG_A, region: 'fixture-region-a' },
  'fixture-facility-b1': { organizationId: ORG_A, region: 'fixture-region-b' },
  'fixture-facility-other-org': { organizationId: ORG_B, region: 'fixture-region-other-org' },
};

export const fixtureResolver: ScopeResolver = {
  async contains(membership: MembershipClaims, target: ScopeEntity) {
    const node = HIERARCHY[target.entityId];
    if (!node || node.organizationId !== membership.organizationId) {
      return false;
    }
    return membership.scopes.some((scope) =>
      scope.grain === 'region' ? scope.entityId === node.region : scope.entityId === target.entityId,
    );
  },
};
