import { describe, expect, it } from 'vitest';
import type { MembershipClaims } from '@orbit/contracts';
import type { LiveSource } from './config.ts';
import type { Database } from './db/client.ts';
import { wireSources } from './wiring.ts';

const REGION = { grain: 'region', entityId: '00000000-0000-4000-8000-0000000000b1' } as const;
const claims: MembershipClaims = {
  membershipId: '00000000-0000-4000-8000-0000000000d1',
  subject: '00000000-0000-4000-8000-0000000000c1',
  organizationId: '00000000-0000-4000-8000-0000000000a1',
  role: 'regional-coo',
  scopes: [REGION],
};

function wire(live: LiveSource[], databaseUrl: string | null = 'postgresql://fixture') {
  const opened: string[] = [];
  const db: Database = { transaction: async (fn) => fn({ query: async () => [] }) };
  const sources = wireSources({ liveSources: new Set(live), databaseUrl: databaseUrl ?? undefined }, (url) => {
    opened.push(url);
    return db;
  });
  return { sources, opened };
}

describe('wireSources', () => {
  it('keeps every source fail-closed and opens no database by default', async () => {
    const { sources, opened } = wire([]);
    expect(opened).toEqual([]);
    await expect(sources.memberships.findBySubject(claims.subject)).rejects.toMatchObject({ code: 'unavailable' });
    await expect(sources.modules.scope.entitlements.forMembership(claims)).rejects.toMatchObject({ code: 'unavailable' });
    await expect(sources.modules.transitions.decide({ role: 'regional-coo', relation: 'assignee', from: 'open', to: 'acknowledged' })).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('switches on only the named sources, sharing one database handle', async () => {
    const { sources, opened } = wire(['memberships', 'entitlements']);
    expect(opened).toEqual(['postgresql://fixture']);
    await expect(sources.memberships.findBySubject(claims.subject)).resolves.toEqual([]);
    await expect(sources.modules.scope.entitlements.forMembership(claims)).resolves.toEqual([]);
    await expect(sources.modules.scope.resolver.contains(claims, REGION)).rejects.toMatchObject({ code: 'unavailable' });
    await expect(sources.modules.observations.series(claims, { assignmentId: 'a', entity: REGION })).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('switches on the proposed transition matrix without a database', async () => {
    const { sources, opened } = wire(['transitions'], null);
    expect(opened).toEqual([]);
    expect(await sources.modules.transitions.decide({ role: 'regional-coo', relation: 'assignee', from: 'open', to: 'acknowledged' })).toBe('allowed');
  });

  it('refuses a database source without DATABASE_URL even if called directly', () => {
    expect(() => wire(['scope'], null)).toThrow(/DATABASE_URL/);
  });
});
