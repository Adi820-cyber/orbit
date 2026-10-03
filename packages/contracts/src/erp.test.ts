import { describe, expect, it } from 'vitest';
import {
  AttendanceBoardResponseSchema,
  AttendanceCountsSchema,
  CreateStaffRequestSchema,
  ERP_DISCLOSURE,
  IdentityResponseSchema,
  MeResponseSchema,
  MembershipClaimsSchema,
  MembershipSchema,
  OPERATOR_ROLE_IDS,
  OperatorClaimsSchema,
  PatientSearchQuerySchema,
  RegisterPatientRequestSchema,
  RequestCorrectionRequestSchema,
  ROLE_IDS,
  UpdateStaffRequestSchema,
} from './index.ts';

const ORG = '00000000-0000-4000-8000-0000000000a1';
const FACILITY = '00000000-0000-4000-8000-0000000000f1';
const base = {
  membershipId: '00000000-0000-4000-8000-0000000000d1',
  subject: '00000000-0000-4000-8000-0000000000c1',
  organizationId: ORG,
  scopes: [{ grain: 'facility', entityId: FACILITY }],
} as const;

describe('operator roles (ADR 0016)', () => {
  it('are exactly admin and hospital, and never a workbook role', () => {
    expect([...OPERATOR_ROLE_IDS]).toEqual(['admin', 'hospital']);
    for (const role of OPERATOR_ROLE_IDS) {
      expect((ROLE_IDS as readonly string[]).includes(role)).toBe(false);
    }
  });

  it('keep leader and operator claims mutually exclusive', () => {
    expect(MembershipClaimsSchema.safeParse({ ...base, role: 'hospital-dho' }).success).toBe(true);
    expect(OperatorClaimsSchema.safeParse({ ...base, operatorRole: 'hospital' }).success).toBe(true);
    // An operator role is not a workbook role, and the reverse.
    expect(MembershipClaimsSchema.safeParse({ ...base, role: 'hospital' }).success).toBe(false);
    expect(OperatorClaimsSchema.safeParse({ ...base, operatorRole: 'hospital-dho' }).success).toBe(false);
    // Strict: an operator claim cannot smuggle a leader role along.
    expect(OperatorClaimsSchema.safeParse({ ...base, operatorRole: 'admin', role: 'chairman' }).success).toBe(false);
  });

  it('parses a membership row of either kind, never both or neither', () => {
    expect(MembershipSchema.safeParse({ ...base, role: 'chairman', operatorRole: null, status: 'active' }).success).toBe(true);
    expect(MembershipSchema.safeParse({ ...base, role: null, operatorRole: 'admin', status: 'active' }).success).toBe(true);
    expect(MembershipSchema.safeParse({ ...base, role: 'chairman', status: 'active' }).success).toBe(true);
    expect(MembershipSchema.safeParse({ ...base, role: 'chairman', operatorRole: 'admin', status: 'active' }).success).toBe(false);
    expect(MembershipSchema.safeParse({ ...base, role: null, operatorRole: null, status: 'active' }).success).toBe(false);
  });

  it('distinguishes the two /api/me shapes', () => {
    const leader = IdentityResponseSchema.parse({ role: 'chairman', organizationId: ORG, scopes: base.scopes });
    const operator = IdentityResponseSchema.parse({ operatorRole: 'hospital', organizationId: ORG, scopes: base.scopes });
    expect('role' in leader).toBe(true);
    expect('operatorRole' in operator).toBe(true);
    expect(MeResponseSchema.safeParse(operator).success).toBe(false);
  });
});

describe('ERP request rules', () => {
  it('creates doctors only through the doctor endpoint', () => {
    const staff = {
      facilityId: FACILITY,
      departmentId: FACILITY,
      employeeCode: 'AV-N-0001',
      displayName: 'Test Person',
      designation: 'Staff nurse',
      joinedOn: '2025-01-01',
    };
    expect(CreateStaffRequestSchema.safeParse({ ...staff, staffType: 'nurse' }).success).toBe(true);
    expect(CreateStaffRequestSchema.safeParse({ ...staff, staffType: 'doctor' }).success).toBe(false);
    expect(CreateStaffRequestSchema.safeParse({ ...staff, staffType: 'nurse', employeeCode: 'lower case' }).success).toBe(false);
  });

  it('requires an exit date exactly when someone exits', () => {
    expect(UpdateStaffRequestSchema.safeParse({ version: 1, employmentStatus: 'exited', exitedOn: '2026-09-01' }).success).toBe(true);
    expect(UpdateStaffRequestSchema.safeParse({ version: 1, employmentStatus: 'exited' }).success).toBe(false);
    expect(UpdateStaffRequestSchema.safeParse({ version: 1, employmentStatus: 'active', exitedOn: '2026-09-01' }).success).toBe(false);
  });

  it('needs a proposed time, in order, and a reason for a correction', () => {
    const request = { staffId: FACILITY, shiftDate: '2026-09-28', reason: 'Forgot to punch out' };
    expect(RequestCorrectionRequestSchema.safeParse({ ...request, proposedOut: '2026-09-28T16:00:00Z' }).success).toBe(true);
    expect(RequestCorrectionRequestSchema.safeParse(request).success).toBe(false);
    expect(
      RequestCorrectionRequestSchema.safeParse({
        ...request,
        proposedIn: '2026-09-28T16:00:00Z',
        proposedOut: '2026-09-28T08:00:00Z',
      }).success,
    ).toBe(false);
  });

  it('never lists patients without a search term', () => {
    expect(PatientSearchQuerySchema.safeParse({}).success).toBe(false);
    expect(PatientSearchQuerySchema.safeParse({ q: 'a' }).success).toBe(false);
    expect(PatientSearchQuerySchema.parse({ q: 'an' })).toMatchObject({ q: 'an', page: 1, pageSize: 25 });
  });

  it('defaults duplicate confirmation to off', () => {
    const parsed = RegisterPatientRequestSchema.parse({ homeFacilityId: FACILITY, displayName: 'A B', sex: 'female', birthYear: 1990 });
    expect(parsed.confirmNotDuplicate).toBe(false);
  });
});

describe('ERP responses', () => {
  it('carry the illustrative provenance and disclosure', () => {
    const counts = Object.fromEntries(Object.keys(AttendanceCountsSchema.shape).map((key) => [key, 0]));
    const board = {
      facilityId: FACILITY,
      date: '2026-09-28',
      asOf: '2026-09-28T10:00:00Z',
      counts,
      onDuty: 0,
      rows: [],
      provenance: 'illustrative',
      disclosure: ERP_DISCLOSURE,
    };
    expect(AttendanceBoardResponseSchema.safeParse(board).success).toBe(true);
    expect(AttendanceBoardResponseSchema.safeParse({ ...board, provenance: 'actual' }).success).toBe(false);
    const { disclosure: _disclosure, ...withoutDisclosure } = board;
    expect(AttendanceBoardResponseSchema.safeParse(withoutDisclosure).success).toBe(false);
  });
});
