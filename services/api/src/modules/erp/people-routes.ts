import type { FastifyInstance } from 'fastify';
import {
  AddScheduleSlotRequestSchema,
  CreateDoctorRequestSchema,
  CreateStaffRequestSchema,
  DoctorDetailResponseSchema,
  DoctorListQuerySchema,
  DoctorListResponseSchema,
  DoctorResponseSchema,
  ErpAuditResponseSchema,
  ErpFacilityQuerySchema,
  ErpPageQuerySchema,
  ErpReferenceResponseSchema,
  ErpSummaryResponseSchema,
  ScheduleSlotResponseSchema,
  SlotParamsSchema,
  StaffListQuerySchema,
  StaffListResponseSchema,
  StaffParamsSchema,
  StaffResponseSchema,
  UpdateDoctorRequestSchema,
  UpdateScheduleSlotRequestSchema,
  UpdateStaffRequestSchema,
} from '@orbit/contracts';
import { z } from 'zod';
import { operatorOf } from '../../plugins/auth.ts';
import { parseInput } from '../shared.ts';
import type { ModuleDeps } from '../ports.ts';
import { facilityFilter, found, requireAdmin, resolveFacility, respond, written } from './access.ts';

const SummaryQuerySchema = ErpFacilityQuerySchema.extend({ date: z.iso.date().optional() });

/** Reference data, the home summary, staff, doctors and the ERP audit trail. */
export function registerErpPeopleRoutes(api: FastifyInstance, deps: ModuleDeps): void {
  const store = deps.erp;

  api.get('/erp/reference', async (request) => {
    const operator = operatorOf(request);
    const rows = await store.reference(operator);
    return respond(ErpReferenceResponseSchema, { operatorRole: operator.operatorRole, ...rows }, 'erp_reference_failed_contract');
  });

  api.get('/erp/summary', async (request) => {
    const operator = operatorOf(request);
    const query = parseInput(SummaryQuerySchema, request.query);
    const facilityId = await resolveFacility(store, operator, query.facilityId);
    const date = query.date ?? (await store.today(operator));
    const row = found(await store.summary(operator, facilityId, date), 'The summary') as Record<string, unknown>;
    return respond(
      ErpSummaryResponseSchema,
      {
        facilityId,
        date,
        asOf: row['asOf'],
        staff: {
          active: row['active'],
          rostered: row['rostered'],
          onDuty: row['onDuty'],
          late: row['late'],
          missingPunch: row['missingPunch'],
          absent: row['absent'],
        },
        encounters: { openInpatients: row['openInpatients'], openOther: row['openOther'], startedToday: row['startedToday'] },
        servicesDeliveredToday: row['servicesDeliveredToday'],
        patientsRegisteredToday: row['patientsRegisteredToday'],
        pendingCorrections: row['pendingCorrections'],
        doctorsNeedingCredentialAttention: row['doctorsNeedingCredentialAttention'],
      },
      'erp_summary_failed_contract',
    );
  });

  // ---- Staff --------------------------------------------------------------
  api.get('/erp/staff', async (request) => {
    const operator = operatorOf(request);
    const query = parseInput(StaffListQuerySchema, request.query);
    const facilityId = await facilityFilter(store, operator, query.facilityId);
    const { items, total } = await store.listStaff(operator, { ...query, facilityId });
    return respond(
      StaffListResponseSchema,
      { items, page: { page: query.page, pageSize: query.pageSize, total } },
      'erp_staff_failed_contract',
    );
  });

  api.get('/erp/staff/:staffId', async (request) => {
    const operator = operatorOf(request);
    const { staffId } = parseInput(StaffParamsSchema, request.params);
    const staff = found(await store.getStaff(operator, staffId), 'That person');
    return respond(StaffResponseSchema, { staff }, 'erp_staff_failed_contract');
  });

  api.post('/erp/staff', async (request, reply) => {
    const operator = operatorOf(request);
    requireAdmin(operator);
    const input = parseInput(CreateStaffRequestSchema, request.body);
    await resolveFacility(store, operator, input.facilityId);
    const staff = await store.createStaff(operator, input, request.id);
    return reply.status(201).send(respond(StaffResponseSchema, { staff }, 'erp_staff_failed_contract'));
  });

  api.patch('/erp/staff/:staffId', async (request) => {
    const operator = operatorOf(request);
    requireAdmin(operator);
    const { staffId } = parseInput(StaffParamsSchema, request.params);
    const input = parseInput(UpdateStaffRequestSchema, request.body);
    const staff = written(await store.updateStaff(operator, staffId, input, request.id), 'That person');
    return respond(StaffResponseSchema, { staff }, 'erp_staff_failed_contract');
  });

  // ---- Doctors ------------------------------------------------------------
  api.get('/erp/doctors', async (request) => {
    const operator = operatorOf(request);
    const query = parseInput(DoctorListQuerySchema, request.query);
    const facilityId = await facilityFilter(store, operator, query.facilityId);
    const { items, total } = await store.listDoctors(operator, { ...query, facilityId });
    return respond(
      DoctorListResponseSchema,
      { items, page: { page: query.page, pageSize: query.pageSize, total } },
      'erp_doctor_failed_contract',
    );
  });

  api.get('/erp/doctors/:staffId', async (request) => {
    const operator = operatorOf(request);
    const { staffId } = parseInput(StaffParamsSchema, request.params);
    const detail = found(await store.getDoctor(operator, staffId), 'That doctor');
    return respond(DoctorDetailResponseSchema, { ...detail }, 'erp_doctor_failed_contract');
  });

  api.post('/erp/doctors', async (request, reply) => {
    const operator = operatorOf(request);
    requireAdmin(operator);
    const input = parseInput(CreateDoctorRequestSchema, request.body);
    await resolveFacility(store, operator, input.facilityId);
    const doctor = await store.createDoctor(operator, input, request.id);
    return reply.status(201).send(respond(DoctorResponseSchema, { doctor }, 'erp_doctor_failed_contract'));
  });

  api.patch('/erp/doctors/:staffId', async (request) => {
    const operator = operatorOf(request);
    requireAdmin(operator);
    const { staffId } = parseInput(StaffParamsSchema, request.params);
    const input = parseInput(UpdateDoctorRequestSchema, request.body);
    const doctor = written(await store.updateDoctor(operator, staffId, input, request.id), 'That doctor');
    return respond(DoctorResponseSchema, { doctor }, 'erp_doctor_failed_contract');
  });

  api.post('/erp/doctors/:staffId/schedule', async (request, reply) => {
    const operator = operatorOf(request);
    requireAdmin(operator);
    const { staffId } = parseInput(StaffParamsSchema, request.params);
    const input = parseInput(AddScheduleSlotRequestSchema, request.body);
    await resolveFacility(store, operator, input.facilityId);
    const slot = found(await store.addScheduleSlot(operator, staffId, input, request.id), 'That doctor');
    return reply.status(201).send(respond(ScheduleSlotResponseSchema, { slot }, 'erp_slot_failed_contract'));
  });

  api.patch('/erp/schedule-slots/:slotId', async (request) => {
    const operator = operatorOf(request);
    requireAdmin(operator);
    const { slotId } = parseInput(SlotParamsSchema, request.params);
    const input = parseInput(UpdateScheduleSlotRequestSchema, request.body);
    const slot = found(await store.updateScheduleSlot(operator, slotId, input, request.id), 'That schedule slot');
    return respond(ScheduleSlotResponseSchema, { slot }, 'erp_slot_failed_contract');
  });

  // ---- Audit (admins) -----------------------------------------------------
  api.get('/erp/audit', async (request) => {
    const operator = operatorOf(request);
    requireAdmin(operator);
    const paging = parseInput(ErpPageQuerySchema, request.query);
    const { items, total } = await store.audit(operator, paging);
    return respond(ErpAuditResponseSchema, { items, page: { ...paging, total } }, 'erp_audit_failed_contract');
  });
}
