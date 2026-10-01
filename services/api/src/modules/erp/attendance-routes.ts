import type { FastifyInstance } from 'fastify';
import {
  AttendanceBoardQuerySchema,
  AttendanceBoardResponseSchema,
  AttendanceDaySchema,
  AttendanceStatusSchema,
  CorrectionListQuerySchema,
  CorrectionListResponseSchema,
  CorrectionParamsSchema,
  CorrectionResponseSchema,
  DecideCorrectionRequestSchema,
  RecordPunchRequestSchema,
  RecordPunchResponseSchema,
  RequestCorrectionRequestSchema,
  RosterDayResponseSchema,
  RosterQuerySchema,
  SetRosterRequestSchema,
  SetRosterResponseSchema,
  StaffAttendanceQuerySchema,
  StaffAttendanceResponseSchema,
  StaffParamsSchema,
  type AttendanceCounts,
  type AttendanceDay,
} from '@orbit/contracts';
import { operatorOf } from '../../plugins/auth.ts';
import { parseInput, parseRows } from '../shared.ts';
import type { ModuleDeps } from '../ports.ts';
import {
  assertNotFuture,
  facilityFilter,
  found,
  isAdmin,
  monthRange,
  requireAdmin,
  resolveFacility,
  respond,
  written,
} from './access.ts';
import { ApiError } from '../../plugins/errors.ts';

export function countStatuses(days: readonly AttendanceDay[]): AttendanceCounts {
  const counts = Object.fromEntries(AttendanceStatusSchema.options.map((status) => [status, 0])) as AttendanceCounts;
  for (const day of days) counts[day.status] += 1;
  return counts;
}

/** Rosters, in/out punches, the daily board, per-person months and corrections. */
export function registerErpAttendanceRoutes(api: FastifyInstance, deps: ModuleDeps): void {
  const store = deps.erp;

  api.get('/erp/attendance/board', async (request) => {
    const operator = operatorOf(request);
    const query = parseInput(AttendanceBoardQuerySchema, request.query);
    const facilityId = await resolveFacility(store, operator, query.facilityId);
    const date = query.date ?? (await store.today(operator));
    const board = await store.attendanceBoard(operator, facilityId, date);
    const days = parseRows(
      AttendanceDaySchema,
      board.rows.map((row) => (row as { day: unknown }).day),
      'erp_attendance_day_failed_contract',
    );
    return respond(
      AttendanceBoardResponseSchema,
      {
        facilityId,
        date,
        asOf: board.asOf,
        counts: countStatuses(days),
        onDuty: days.filter((day) => day.onDuty).length,
        rows: board.rows,
      },
      'erp_board_failed_contract',
    );
  });

  api.post('/erp/attendance/punches', async (request, reply) => {
    const operator = operatorOf(request);
    const input = parseInput(RecordPunchRequestSchema, request.body);
    if (input.punchedAt !== undefined) {
      // A back-dated punch is an admin correction of the record, not a desk event.
      requireAdmin(operator);
      assertNotFuture(input.punchedAt, 'A punch');
    }
    const result = found(
      await store.recordPunch(
        operator,
        { staffId: input.staffId, direction: input.direction, idempotencyKey: input.idempotencyKey, punchedAt: input.punchedAt ?? null },
        request.id,
      ),
      'That person',
    );
    if (result.day === null || result.day === undefined) {
      // attendance_days() derives nothing without erp_settings for the organization.
      throw new ApiError('unavailable', 'Attendance rules are not configured for this organization yet.', 'erp_settings_missing');
    }
    const body = respond(RecordPunchResponseSchema, { ...result }, 'erp_punch_failed_contract');
    return reply.status(result.replayed ? 200 : 201).send(body);
  });

  api.get('/erp/attendance/staff/:staffId', async (request) => {
    const operator = operatorOf(request);
    const { staffId } = parseInput(StaffParamsSchema, request.params);
    const { month } = parseInput(StaffAttendanceQuerySchema, request.query);
    const result = found(await store.staffMonth(operator, staffId, monthRange(month)), 'That person');
    const days = parseRows(AttendanceDaySchema, result.days, 'erp_attendance_day_failed_contract');
    return respond(
      StaffAttendanceResponseSchema,
      {
        ...result,
        month,
        counts: countStatuses(days),
        // Complete days only: a missing punch is excluded, never counted as zero.
        workedMinutes: days.reduce((sum, day) => sum + (day.workedMinutes ?? 0), 0),
      },
      'erp_staff_month_failed_contract',
    );
  });

  api.get('/erp/attendance/corrections', async (request) => {
    const operator = operatorOf(request);
    const query = parseInput(CorrectionListQuerySchema, request.query);
    const facilityId = await facilityFilter(store, operator, query.facilityId);
    const { items, total } = await store.listCorrections(operator, { ...query, facilityId });
    return respond(
      CorrectionListResponseSchema,
      { items, page: { page: query.page, pageSize: query.pageSize, total } },
      'erp_corrections_failed_contract',
    );
  });

  api.post('/erp/attendance/corrections', async (request, reply) => {
    const operator = operatorOf(request);
    const input = parseInput(RequestCorrectionRequestSchema, request.body);
    assertNotFuture(input.proposedIn, 'The proposed in time');
    assertNotFuture(input.proposedOut, 'The proposed out time');
    const correction = found(await store.requestCorrection(operator, input, request.id), 'That person');
    return reply.status(201).send(respond(CorrectionResponseSchema, { correction }, 'erp_correction_failed_contract'));
  });

  api.post('/erp/attendance/corrections/:correctionId/decision', async (request) => {
    const operator = operatorOf(request);
    requireAdmin(operator);
    const { correctionId } = parseInput(CorrectionParamsSchema, request.params);
    const input = parseInput(DecideCorrectionRequestSchema, request.body);
    const correction = written(await store.decideCorrection(operator, correctionId, input, request.id), 'That correction');
    return respond(CorrectionResponseSchema, { correction }, 'erp_correction_failed_contract');
  });

  // ---- Rosters --------------------------------------------------------------
  api.get('/erp/rosters', async (request) => {
    const operator = operatorOf(request);
    const query = parseInput(RosterQuerySchema, request.query);
    const facilityId = await resolveFacility(store, operator, query.facilityId);
    const date = query.date ?? (await store.today(operator));
    const [rows, reference] = await Promise.all([store.rosterDay(operator, facilityId, date), store.reference(operator)]);
    return respond(
      RosterDayResponseSchema,
      { facilityId, date, shiftTemplates: reference.shiftTemplates, rows },
      'erp_roster_failed_contract',
    );
  });

  api.put('/erp/rosters', async (request) => {
    const operator = operatorOf(request);
    const input = parseInput(SetRosterRequestSchema, request.body);
    const today = await store.today(operator);
    if (input.date < today && !isAdmin(operator)) {
      // Past rosters drive past attendance; changing them is an admin decision.
      throw new ApiError('forbidden', 'Only an admin account can change a past roster.', 'erp_past_roster');
    }
    const assignment = written(await store.setRoster(operator, input, request.id), 'That person');
    return respond(SetRosterResponseSchema, { assignment }, 'erp_roster_failed_contract');
  });
}
