import { z } from 'zod';
import { DataQualitySchema, DisclosureSchema, MeasureValueSchema, ProvenanceSchema } from './common.ts';
import { ScopeEntitySchema } from './membership.ts';
import type { RoleId } from './roles.ts';

/*
 * The leadership view of hospital operations (ADR 0018): what the ERP holds,
 * as AGGREGATES, for the hospitals inside the caller's verified scope.
 *
 * Counts and ratios only. Nothing here names a person, a patient or a visit.
 * Every rate carries its numerator and denominator (the counts beside it), and
 * a rate with no denominator is `not_applicable`, never zero (PRD §7.9).
 *
 * This is NOT the KPI scorecard. The workbook KPIs assume full-size hospitals
 * (hundreds of beds, paid FTEs, money); the ERP is a small working hospital. The
 * two are shown side by side and never merged.
 */

/**
 * Roles that see the live operations view (ADR 0018 §2, decided 2026-10-03). The API
 * enforces it; the web app only uses it to decide whether to show the link.
 * Roles whose workbook scope is finance, legal, procurement, analytics or a
 * COE are not in it.
 */
export const OPERATIONS_FEED_ROLES = [
  'chairman',
  'clinical-director',
  'regional-coo',
  'hospital-dho',
  'people-executive',
  'hr-head',
] as const satisfies readonly RoleId[];

export function seesOperations(role: RoleId): boolean {
  return (OPERATIONS_FEED_ROLES as readonly RoleId[]).includes(role);
}

const Count = z.number().int().min(0);

export const OperationsStaffingSchema = z.strictObject({
  /** Everyone not exited: the hospital's current headcount in the ERP. */
  activeStaff: Count,
  rosteredToday: Count,
  /** Punched in and still on shift. */
  onDutyNow: Count,
  lateToday: Count,
  /** An in without an out (or the reverse): reported as missing, never as zero hours. */
  missingPunchToday: Count,
  absentToday: Count,
});
export type OperationsStaffing = z.infer<typeof OperationsStaffingSchema>;

export const OperationsDoctorsSchema = z.strictObject({
  total: Count,
  credentialActive: Count,
  credentialExpiring: Count,
  credentialExpired: Count,
  credentialSuspended: Count,
});
export type OperationsDoctors = z.infer<typeof OperationsDoctorsSchema>;

export const OperationsVisitsSchema = z.strictObject({
  openNow: Count,
  openInpatients: Count,
  startedToday: Count,
  /** Today and the six days before it. */
  startedLast7Days: Count,
});
export type OperationsVisits = z.infer<typeof OperationsVisitsSchema>;

export const OperationsServicesSchema = z.strictObject({
  deliveredToday: Count,
  deliveredLast7Days: Count,
});
export type OperationsServices = z.infer<typeof OperationsServicesSchema>;

/** The picture right now. */
export const OperationsNowSchema = z.strictObject({
  staffing: OperationsStaffingSchema,
  doctors: OperationsDoctorsSchema,
  visits: OperationsVisitsSchema,
  services: OperationsServicesSchema,
  /** Attendance corrections waiting for an admin. */
  pendingCorrections: Count,
});
export type OperationsNow = z.infer<typeof OperationsNowSchema>;

/** One finished day: how the rostered shifts went. */
export const OperationsDaySchema = z.strictObject({
  date: z.iso.date(),
  /** Shifts that started that day. */
  rostered: Count,
  /** Still on shift when read (only a night shift crossing midnight). Not counted in any rate. */
  inProgress: Count,
  /** A complete in/out pair, on time. */
  onTime: Count,
  /** A complete pair, arrived late. */
  late: Count,
  /** A complete pair, left early. */
  earlyExit: Count,
  missingPunch: Count,
  absent: Count,
  /** On leave: not part of `rostered`. */
  onLeave: Count,
});
export type OperationsDay = z.infer<typeof OperationsDaySchema>;

/**
 * Shifts that have ended over the period. `finished` is the denominator of every
 * rate: shifts still in progress are left out, not counted as failures.
 */
export const OperationsAttendanceSchema = z.strictObject({
  days: Count,
  finished: Count,
  completed: Count,
  onTime: Count,
  late: Count,
  earlyExit: Count,
  missingPunch: Count,
  absent: Count,
  /** completed / finished, in percent. */
  completionRate: MeasureValueSchema,
  /** onTime / finished, in percent. */
  onTimeRate: MeasureValueSchema,
  /** missingPunch / finished, in percent. */
  missingPunchRate: MeasureValueSchema,
  /** absent / finished, in percent. */
  absentRate: MeasureValueSchema,
});
export type OperationsAttendance = z.infer<typeof OperationsAttendanceSchema>;

export const OperationsHospitalSchema = z.strictObject({
  facilityId: z.uuid(),
  name: z.string().min(1),
  now: OperationsNowSchema,
  attendance: OperationsAttendanceSchema,
  daily: z.array(OperationsDaySchema),
  /** When the ERP last recorded anything for this hospital; null if it never has. */
  lastActivityAt: z.iso.datetime({ offset: true }).nullable(),
});
export type OperationsHospital = z.infer<typeof OperationsHospitalSchema>;

/** The hospitals in scope added together (sums of counts, never averages of percentages). */
export const OperationsRollupSchema = z.strictObject({
  hospitals: Count,
  now: OperationsNowSchema,
  attendance: OperationsAttendanceSchema,
  daily: z.array(OperationsDaySchema),
});
export type OperationsRollup = z.infer<typeof OperationsRollupSchema>;

export const OperationsQuerySchema = z.object({
  /** Finished days to cover, before today. */
  days: z.coerce.number().int().min(1).max(30).default(14),
});
export type OperationsQuery = z.infer<typeof OperationsQuerySchema>;

/** `GET /api/operations` */
export const OperationsResponseSchema = z.strictObject({
  source: z.literal('hospital-operations'),
  asOf: z.iso.datetime({ offset: true }),
  today: z.iso.date(),
  periodDays: z.number().int().min(1).max(30),
  /** The caller's verified scope, for display only. */
  scope: z.array(ScopeEntitySchema).min(1),
  rollup: OperationsRollupSchema,
  /** One entry per hospital in scope; empty when the scope covers none. */
  hospitals: z.array(OperationsHospitalSchema),
  dataQuality: DataQualitySchema,
  provenance: ProvenanceSchema,
  disclosure: DisclosureSchema,
});
export type OperationsResponse = z.infer<typeof OperationsResponseSchema>;
