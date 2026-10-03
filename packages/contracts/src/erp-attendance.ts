import { z } from 'zod';
import {
  ErpDateSchema,
  ErpDisclosureFields,
  ErpInstantSchema,
  ErpMonthSchema,
  ErpPageQuerySchema,
  ErpPageSchema,
  ErpVersionSchema,
  ShiftTemplateSchema,
} from './erp-common.ts';
import { StaffSchema, StaffTypeSchema } from './erp-people.ts';

/*
 * Rosters and in/out attendance (ERP_PLAN §5.3). Punches are append-only;
 * daily attendance is derived from roster + punches + approved corrections +
 * organization settings every time it is read, so it cannot drift from them.
 */

/**
 * Derived daily status, in precedence order (orbit_erp.attendance_days):
 * - `scheduled`: rostered, shift not yet started (within the late grace);
 * - `on-duty`: punched in, shift still running;
 * - `present` / `late` / `early-exit`: a complete in/out pair;
 * - `missing-punch`: an in without an out, or the reverse — never zero hours;
 * - `absent`: rostered, no punches, shift started;
 * - `on-leave`, `off` (not rostered, no punches), `unrostered` (punched without a shift).
 */
export const AttendanceStatusSchema = z.enum([
  'scheduled',
  'on-duty',
  'present',
  'late',
  'early-exit',
  'missing-punch',
  'absent',
  'on-leave',
  'off',
  'unrostered',
]);
export type AttendanceStatus = z.infer<typeof AttendanceStatusSchema>;

export const AttendanceDaySchema = z.strictObject({
  staffId: z.uuid(),
  shiftDate: ErpDateSchema,
  rosterId: z.uuid().nullable(),
  shiftTemplateId: z.uuid().nullable(),
  shiftStart: ErpInstantSchema.nullable(),
  shiftEnd: ErpInstantSchema.nullable(),
  firstIn: ErpInstantSchema.nullable(),
  lastOut: ErpInstantSchema.nullable(),
  punchCount: z.number().int().min(0),
  /** The latest punch is an `in` and the shift window is still open. */
  onDuty: z.boolean(),
  /** Null unless there is an in and a later out. Missing is never zero. */
  workedMinutes: z.number().int().min(0).nullable(),
  lateMinutes: z.number().int().min(0).nullable(),
  earlyExitMinutes: z.number().int().min(0).nullable(),
  status: AttendanceStatusSchema,
  /** An approved correction replaced punch-derived times. */
  corrected: z.boolean(),
  correctionId: z.uuid().nullable(),
});
export type AttendanceDay = z.infer<typeof AttendanceDaySchema>;

/** The person on a board row, without fields the board does not need. */
export const StaffSummarySchema = z.strictObject({
  staffId: z.uuid(),
  displayName: z.string().min(1),
  employeeCode: z.string().min(1),
  staffType: StaffTypeSchema,
  designation: z.string().min(1),
  departmentId: z.uuid(),
});
export type StaffSummary = z.infer<typeof StaffSummarySchema>;

export const AttendanceBoardQuerySchema = z.object({
  facilityId: z.uuid().optional(),
  date: ErpDateSchema.optional(),
});
export type AttendanceBoardQuery = z.infer<typeof AttendanceBoardQuerySchema>;

export const AttendanceCountsSchema = z.strictObject(
  Object.fromEntries(AttendanceStatusSchema.options.map((status) => [status, z.number().int().min(0)])) as Record<
    AttendanceStatus,
    z.ZodNumber
  >,
);
export type AttendanceCounts = z.infer<typeof AttendanceCountsSchema>;

/** `GET /api/erp/attendance/board` — who is in, late, missing a punch or absent on one day. */
export const AttendanceBoardResponseSchema = z.strictObject({
  facilityId: z.uuid(),
  date: ErpDateSchema,
  /** When the board was derived; statuses such as `on-duty` depend on it. */
  asOf: ErpInstantSchema,
  counts: AttendanceCountsSchema,
  onDuty: z.number().int().min(0),
  rows: z.array(z.strictObject({ staff: StaffSummarySchema, day: AttendanceDaySchema })),
  ...ErpDisclosureFields,
});
export type AttendanceBoardResponse = z.infer<typeof AttendanceBoardResponseSchema>;

export const PunchDirectionSchema = z.enum(['in', 'out']);
export type PunchDirection = z.infer<typeof PunchDirectionSchema>;

export const PunchSourceSchema = z.enum(['desk', 'admin-entry', 'seeded']);
export type PunchSource = z.infer<typeof PunchSourceSchema>;

export const PunchSchema = z.strictObject({
  punchId: z.uuid(),
  staffId: z.uuid(),
  facilityId: z.uuid(),
  direction: PunchDirectionSchema,
  punchedAt: ErpInstantSchema,
  source: PunchSourceSchema,
});
export type Punch = z.infer<typeof PunchSchema>;

/**
 * `POST /api/erp/attendance/punches`. Without `punchedAt` the server stamps
 * the time (`desk`). A back-dated entry (`admin-entry`) is admins only and at
 * most 31 days old; older fixes go through a correction. A retry with the same
 * `idempotencyKey` returns the original punch.
 */
export const RecordPunchRequestSchema = z.strictObject({
  staffId: z.uuid(),
  direction: PunchDirectionSchema,
  idempotencyKey: z.uuid(),
  punchedAt: ErpInstantSchema.optional(),
});
export type RecordPunchRequest = z.infer<typeof RecordPunchRequestSchema>;

export const RecordPunchResponseSchema = z.strictObject({
  punch: PunchSchema,
  replayed: z.boolean(),
  /** The punch's shift day, re-derived with this punch included. */
  day: AttendanceDaySchema,
  ...ErpDisclosureFields,
});
export type RecordPunchResponse = z.infer<typeof RecordPunchResponseSchema>;

// ---------------------------------------------------------------------------
// Corrections (four-eyes: requested by anyone at the facility, decided by an admin)
// ---------------------------------------------------------------------------

export const CorrectionStateSchema = z.enum(['submitted', 'approved', 'rejected']);
export type CorrectionState = z.infer<typeof CorrectionStateSchema>;

export const CorrectionSchema = z.strictObject({
  correctionId: z.uuid(),
  staffId: z.uuid(),
  staffName: z.string().min(1),
  facilityId: z.uuid(),
  shiftDate: ErpDateSchema,
  proposedIn: ErpInstantSchema.nullable(),
  proposedOut: ErpInstantSchema.nullable(),
  reason: z.string().min(1),
  state: CorrectionStateSchema,
  /** The caller asked for this correction, so the caller cannot decide it. */
  requestedByMe: z.boolean(),
  decisionNote: z.string().nullable(),
  createdAt: ErpInstantSchema,
  decidedAt: ErpInstantSchema.nullable(),
  version: ErpVersionSchema,
});
export type Correction = z.infer<typeof CorrectionSchema>;

const ReasonSchema = z.string().trim().min(3).max(500);

export const RequestCorrectionRequestSchema = z
  .strictObject({
    staffId: z.uuid(),
    shiftDate: ErpDateSchema,
    proposedIn: ErpInstantSchema.optional(),
    proposedOut: ErpInstantSchema.optional(),
    reason: ReasonSchema,
  })
  .refine((body) => body.proposedIn !== undefined || body.proposedOut !== undefined, {
    message: 'Propose an in time, an out time, or both.',
  })
  .refine(
    (body) =>
      body.proposedIn === undefined ||
      body.proposedOut === undefined ||
      Date.parse(body.proposedOut) > Date.parse(body.proposedIn),
    { message: 'The out time must be after the in time.' },
  );
export type RequestCorrectionRequest = z.infer<typeof RequestCorrectionRequestSchema>;

export const DecideCorrectionRequestSchema = z.strictObject({
  version: ErpVersionSchema,
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(500).optional(),
});
export type DecideCorrectionRequest = z.infer<typeof DecideCorrectionRequestSchema>;

export const CorrectionListQuerySchema = ErpPageQuerySchema.extend({
  facilityId: z.uuid().optional(),
  state: CorrectionStateSchema.optional(),
});
export type CorrectionListQuery = z.infer<typeof CorrectionListQuerySchema>;

export const CorrectionListResponseSchema = z.strictObject({
  items: z.array(CorrectionSchema),
  page: ErpPageSchema,
  ...ErpDisclosureFields,
});
export type CorrectionListResponse = z.infer<typeof CorrectionListResponseSchema>;

export const CorrectionResponseSchema = z.strictObject({
  correction: CorrectionSchema,
  ...ErpDisclosureFields,
});
export type CorrectionResponse = z.infer<typeof CorrectionResponseSchema>;

export const CorrectionParamsSchema = z.strictObject({ correctionId: z.uuid() });

// ---------------------------------------------------------------------------
// Per-person month
// ---------------------------------------------------------------------------

export const StaffAttendanceQuerySchema = z.object({ month: ErpMonthSchema });

export const StaffAttendanceResponseSchema = z.strictObject({
  staff: StaffSchema,
  month: ErpMonthSchema,
  days: z.array(AttendanceDaySchema),
  punches: z.array(PunchSchema),
  corrections: z.array(CorrectionSchema),
  counts: AttendanceCountsSchema,
  /** Sum over complete days only; days with a missing punch are excluded, not counted as zero. */
  workedMinutes: z.number().int().min(0),
  ...ErpDisclosureFields,
});
export type StaffAttendanceResponse = z.infer<typeof StaffAttendanceResponseSchema>;

// ---------------------------------------------------------------------------
// Rosters
// ---------------------------------------------------------------------------

export const RosterQuerySchema = z.object({
  facilityId: z.uuid().optional(),
  date: ErpDateSchema.optional(),
});

export const RosterAssignmentSchema = z.strictObject({
  rosterId: z.uuid(),
  shiftTemplateId: z.uuid(),
  version: ErpVersionSchema,
});
export type RosterAssignment = z.infer<typeof RosterAssignmentSchema>;

/** `GET /api/erp/rosters` — one day at one facility. */
export const RosterDayResponseSchema = z.strictObject({
  facilityId: z.uuid(),
  date: ErpDateSchema,
  shiftTemplates: z.array(ShiftTemplateSchema),
  rows: z.array(z.strictObject({ staff: StaffSummarySchema, assignment: RosterAssignmentSchema.nullable() })),
  ...ErpDisclosureFields,
});
export type RosterDayResponse = z.infer<typeof RosterDayResponseSchema>;

/**
 * `PUT /api/erp/rosters` — set one person's shift for one day. `shiftTemplateId:
 * null` cancels the planned shift. `version` is required when an assignment exists.
 */
export const SetRosterRequestSchema = z.strictObject({
  staffId: z.uuid(),
  date: ErpDateSchema,
  shiftTemplateId: z.uuid().nullable(),
  version: ErpVersionSchema.optional(),
});
export type SetRosterRequest = z.infer<typeof SetRosterRequestSchema>;

export const SetRosterResponseSchema = z.strictObject({
  assignment: RosterAssignmentSchema.nullable(),
  ...ErpDisclosureFields,
});
export type SetRosterResponse = z.infer<typeof SetRosterResponseSchema>;
