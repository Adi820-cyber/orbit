import { describe, expect, it } from 'vitest';
import {
  EntitlementSchema,
  ErrorEnvelopeSchema,
  MembershipClaimsSchema,
  MembershipSchema,
  MeResponseSchema,
  ROLE_IDS,
} from './index.ts';

const claims = {
  membershipId: '00000000-0000-4000-8000-000000000001',
  subject: '00000000-0000-4000-8000-000000000002',
  organizationId: '00000000-0000-4000-8000-000000000003',
  role: 'regional-coo',
  scopes: [{ grain: 'region', entityId: 'e0000000-0000-4000-8000-00000000000a' }],
} as const;

describe('roles', () => {
  it('lists exactly 14 distinct role types', () => {
    expect(new Set(ROLE_IDS).size).toBe(14);
  });
});

describe('MembershipClaimsSchema', () => {
  it('round-trips valid claims', () => {
    expect(MembershipClaimsSchema.parse(claims)).toEqual(claims);
  });

  it('rejects an unknown role', () => {
    expect(MembershipClaimsSchema.safeParse({ ...claims, role: 'admin' }).success).toBe(false);
  });

  it('rejects empty scope', () => {
    expect(MembershipClaimsSchema.safeParse({ ...claims, scopes: [] }).success).toBe(false);
  });

  it('rejects extra keys instead of passing them to RLS', () => {
    expect(MembershipClaimsSchema.safeParse({ ...claims, isAdmin: true }).success).toBe(false);
  });
});

describe('MembershipSchema', () => {
  it('requires a status', () => {
    expect(MembershipSchema.safeParse(claims).success).toBe(false);
    expect(MembershipSchema.safeParse({ ...claims, status: 'active' }).success).toBe(true);
  });
});

describe('EntitlementSchema', () => {
  it('requires at least one grain', () => {
    const row = { role: 'regional-coo', assignmentId: 'a1', grains: [], breakdowns: [] };
    expect(EntitlementSchema.safeParse(row).success).toBe(false);
  });
});

describe('ErrorEnvelopeSchema', () => {
  it('accepts out_of_scope and rejects unknown codes', () => {
    const ok = { error: { code: 'out_of_scope', message: 'x', requestId: 'r' } };
    expect(ErrorEnvelopeSchema.safeParse(ok).success).toBe(true);
    const bad = { error: { code: 'teapot', message: 'x', requestId: 'r' } };
    expect(ErrorEnvelopeSchema.safeParse(bad).success).toBe(false);
  });
});

describe('MeResponseSchema', () => {
  it('does not carry the subject or membership id', () => {
    const me = { role: claims.role, organizationId: claims.organizationId, scopes: claims.scopes };
    expect(MeResponseSchema.parse(me)).toEqual(me);
    expect(MeResponseSchema.safeParse({ ...me, subject: claims.subject }).success).toBe(false);
  });
});
