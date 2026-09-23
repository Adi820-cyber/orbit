import { describe, expect, it } from 'vitest';
import { claimsFor, ENTITLEMENTS, fixtureEntitlements, fixtureResolver, SUBJECT } from '../../test/helpers/fixtures.ts';
import { ApiError } from './errors.ts';
import { assertInScope, decideScope, type ScopeDeps } from './scope.ts';

const deps: ScopeDeps = { entitlements: fixtureEntitlements(), resolver: fixtureResolver, frameworkVersion: 'v1' };
const cooA = claimsFor(SUBJECT.cooRegionA);
const cooB = claimsFor(SUBJECT.cooRegionB);

describe('decideScope', () => {
  it('allows an entitled assignment inside the membership region', async () => {
    const decision = await decideScope(
      cooA,
      { assignmentId: 'fixture-assignment-1', target: { grain: 'facility', entityId: 'e0000000-0000-4000-8000-0000000000a1' }, breakdown: 'facility' },
      deps,
    );
    expect(decision).toEqual({ allowed: true, entitlement: ENTITLEMENTS[0] });
  });

  it.each([
    ['no entitlement for the assignment', { assignmentId: 'fixture-assignment-unknown', target: { grain: 'region', entityId: 'e0000000-0000-4000-8000-00000000000a' } }, 'no_entitlement'],
    ['a grain the entitlement does not grant', { assignmentId: 'fixture-assignment-2', target: { grain: 'facility', entityId: 'e0000000-0000-4000-8000-0000000000a1' } }, 'grain_not_granted'],
    ['a breakdown the entitlement does not grant', { assignmentId: 'fixture-assignment-2', target: { grain: 'region', entityId: 'e0000000-0000-4000-8000-00000000000a' }, breakdown: 'facility' }, 'breakdown_not_granted'],
    ['the other region', { assignmentId: 'fixture-assignment-1', target: { grain: 'region', entityId: 'e0000000-0000-4000-8000-00000000000b' } }, 'entity_out_of_scope'],
    ['a facility in the other region', { assignmentId: 'fixture-assignment-1', target: { grain: 'facility', entityId: 'e0000000-0000-4000-8000-0000000000b1' } }, 'entity_out_of_scope'],
    ['an entity in another organization', { assignmentId: 'fixture-assignment-1', target: { grain: 'facility', entityId: 'e0000000-0000-4000-8000-0000000000c1' } }, 'entity_out_of_scope'],
    ['an unknown entity', { assignmentId: 'fixture-assignment-1', target: { grain: 'facility', entityId: 'e0000000-0000-4000-8000-0000000000ff' } }, 'entity_out_of_scope'],
  ] as const)('denies %s', async (_label, request, reason) => {
    expect(await decideScope(cooA, request, deps)).toEqual({ allowed: false, reason });
  });

  it('does not let one region see the other (symmetry)', async () => {
    const request = { assignmentId: 'fixture-assignment-1', target: { grain: 'region', entityId: 'e0000000-0000-4000-8000-00000000000a' } } as const;
    expect((await decideScope(cooA, request, deps)).allowed).toBe(true);
    expect(await decideScope(cooB, request, deps)).toEqual({ allowed: false, reason: 'entity_out_of_scope' });
  });

  it('does not inherit entitlements from another role', async () => {
    const chairmanLike = { ...cooA, role: 'chairman' as const };
    const request = { assignmentId: 'fixture-assignment-1', target: { grain: 'region', entityId: 'e0000000-0000-4000-8000-00000000000a' } } as const;
    expect(await decideScope(chairmanLike, request, deps)).toEqual({ allowed: false, reason: 'no_entitlement' });
  });

  it('fails closed on duplicate entitlement rows rather than widening', async () => {
    const duplicated = fixtureEntitlements([...ENTITLEMENTS, { ...ENTITLEMENTS[1], grains: ['region', 'facility'] }]);
    const request = { assignmentId: 'fixture-assignment-2', target: { grain: 'region', entityId: 'e0000000-0000-4000-8000-00000000000a' } } as const;
    await expect(decideScope(cooA, request, { ...deps, entitlements: duplicated })).rejects.toMatchObject({ code: 'internal' });
  });

  it('ignores entitlement rows for another framework version', async () => {
    const otherVersion = fixtureEntitlements([{ ...ENTITLEMENTS[1], frameworkVersion: 'v0' }]);
    const request = { assignmentId: 'fixture-assignment-2', target: { grain: 'region', entityId: 'e0000000-0000-4000-8000-00000000000a' } } as const;
    expect(await decideScope(cooA, request, { ...deps, entitlements: otherVersion })).toEqual({
      allowed: false,
      reason: 'no_entitlement',
    });
  });

  it('fails closed on an entitlement row that violates the contract', async () => {
    const broken = fixtureEntitlements([{ role: 'regional-coo', frameworkVersion: 'v1', assignmentId: 'fixture-assignment-1', grains: ['galaxy'], breakdowns: [] }]);
    const request = { assignmentId: 'fixture-assignment-1', target: { grain: 'region', entityId: 'e0000000-0000-4000-8000-00000000000a' } } as const;
    await expect(decideScope(cooA, request, { ...deps, entitlements: broken })).rejects.toMatchObject({ code: 'internal' });
  });
});

describe('assertInScope', () => {
  it('throws an explicit out_of_scope error without the denial reason in the message', async () => {
    const request = { assignmentId: 'fixture-assignment-1', target: { grain: 'region', entityId: 'e0000000-0000-4000-8000-00000000000b' } } as const;
    const error = await assertInScope(cooA, request, deps).catch((caught: unknown) => caught);
    if (!(error instanceof ApiError)) {
      throw new Error('expected an ApiError');
    }
    expect(error).toMatchObject({ code: 'out_of_scope', statusCode: 403, reason: 'entity_out_of_scope' });
    expect(error.message).not.toContain('e0000000-0000-4000-8000-00000000000b');
  });
});
