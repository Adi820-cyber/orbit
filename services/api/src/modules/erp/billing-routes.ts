import type { FastifyInstance } from 'fastify';
import {
  BillListQuerySchema,
  BillListResponseSchema,
  BillableVisitListResponseSchema,
  BillableVisitQuerySchema,
  BillParamsSchema,
  BillResponseSchema,
  CancelBillRequestSchema,
  CoverageResponseSchema,
  EncounterParamsSchema,
  IssueBillRequestSchema,
  PatientParamsSchema,
  RecordPaymentRequestSchema,
  RevenueQuerySchema,
  RevenueResponseSchema,
  SetCoverageRequestSchema,
} from '@orbit/contracts';
import { operatorOf } from '../../plugins/auth.ts';
import { parseInput } from '../shared.ts';
import type { ModuleDeps } from '../ports.ts';
import { assertNotFuture, facilityFilter, found, isAdmin, requireAdmin, resolveFacility, respond, written } from './access.ts';

/*
 * Billing (ADR 0022): insurance cover, bills, payments and revenue.
 *
 * Who may do what (decided 2026-10-06):
 *   - hospital and admin accounts set a patient's cover, issue bills and record
 *     payments, for hospitals they can see;
 *   - only an admin cancels a bill (and only one with no payment) or changes a
 *     price (the price itself is set on the Services routes; the database
 *     refuses a hospital account's change, see migration 20261006000200).
 * The database enforces the same rules again (RLS and triggers).
 */
export function registerErpBillingRoutes(api: FastifyInstance, deps: ModuleDeps): void {
  const store = deps.erp;

  // ---- Insurance cover ----------------------------------------------------
  api.get('/erp/patients/:patientId/coverage', async (request) => {
    const operator = operatorOf(request);
    const { patientId } = parseInput(PatientParamsSchema, request.params);
    const coverage = found(await store.getCoverage(operator, patientId), 'That patient');
    return respond(CoverageResponseSchema, { coverage }, 'erp_coverage_failed_contract');
  });

  api.put('/erp/patients/:patientId/coverage', async (request) => {
    const operator = operatorOf(request);
    const { patientId } = parseInput(PatientParamsSchema, request.params);
    const input = parseInput(SetCoverageRequestSchema, request.body);
    const coverage = written(await store.setCoverage(operator, patientId, input, request.id), 'That patient');
    return respond(CoverageResponseSchema, { coverage }, 'erp_coverage_failed_contract');
  });

  // ---- Bills --------------------------------------------------------------
  api.post('/erp/encounters/:encounterId/bills', async (request, reply) => {
    const operator = operatorOf(request);
    const { encounterId } = parseInput(EncounterParamsSchema, request.params);
    const { idempotencyKey } = parseInput(IssueBillRequestSchema, request.body);
    const result = found(await store.issueBill(operator, encounterId, idempotencyKey, request.id), 'That visit');
    const currency = await store.currency(operator);
    const body = respond(BillResponseSchema, { bill: result.bill, currency }, 'erp_bill_failed_contract');
    return reply.status(result.replayed ? 200 : 201).send(body);
  });

  api.get('/erp/bills', async (request) => {
    const operator = operatorOf(request);
    const query = parseInput(BillListQuerySchema, request.query);
    const facilityId = await facilityFilter(store, operator, query.facilityId);
    const { items, total } = await store.listBills(operator, { ...query, facilityId });
    const currency = await store.currency(operator);
    return respond(
      BillListResponseSchema,
      { items, page: { page: query.page, pageSize: query.pageSize, total }, currency },
      'erp_bill_failed_contract',
    );
  });

  // New bill: closed visits with services still to bill. A hospital account sees its
  // own hospital; an admin one hospital, or every one.
  api.get('/erp/bills/ready', async (request) => {
    const operator = operatorOf(request);
    const query = parseInput(BillableVisitQuerySchema, request.query);
    const facilityId = isAdmin(operator)
      ? ((await facilityFilter(store, operator, query.facilityId)) ?? null)
      : await resolveFacility(store, operator, query.facilityId);
    const { items, total } = await store.billableVisits(operator, { ...query, facilityId: facilityId ?? undefined });
    const currency = await store.currency(operator);
    return respond(
      BillableVisitListResponseSchema,
      { items, page: { page: query.page, pageSize: query.pageSize, total }, days: query.days, currency },
      'erp_billable_failed_contract',
    );
  });

  api.get('/erp/bills/:billId', async (request) => {
    const operator = operatorOf(request);
    const { billId } = parseInput(BillParamsSchema, request.params);
    const bill = found(await store.getBill(operator, billId, request.id), 'That bill');
    const currency = await store.currency(operator);
    return respond(BillResponseSchema, { bill, currency }, 'erp_bill_failed_contract');
  });

  api.post('/erp/bills/:billId/payments', async (request, reply) => {
    const operator = operatorOf(request);
    const { billId } = parseInput(BillParamsSchema, request.params);
    const input = parseInput(RecordPaymentRequestSchema, request.body);
    assertNotFuture(input.receivedAt, 'The payment time');
    const result = found(await store.recordPayment(operator, billId, input, request.id), 'That bill');
    const currency = await store.currency(operator);
    const body = respond(BillResponseSchema, { bill: result.bill, currency }, 'erp_bill_failed_contract');
    return reply.status(result.replayed ? 200 : 201).send(body);
  });

  api.post('/erp/bills/:billId/cancel', async (request) => {
    const operator = operatorOf(request);
    requireAdmin(operator);
    const { billId } = parseInput(BillParamsSchema, request.params);
    const input = parseInput(CancelBillRequestSchema, request.body);
    const bill = written(await store.cancelBill(operator, billId, input, request.id), 'That bill');
    const currency = await store.currency(operator);
    return respond(BillResponseSchema, { bill, currency }, 'erp_bill_failed_contract');
  });

  // ---- Revenue ------------------------------------------------------------
  api.get('/erp/revenue', async (request) => {
    const operator = operatorOf(request);
    const query = parseInput(RevenueQuerySchema, request.query);
    // A hospital account always sees its own hospital; an admin sees one, or all.
    const facilityId = isAdmin(operator)
      ? ((await facilityFilter(store, operator, query.facilityId)) ?? null)
      : await resolveFacility(store, operator, query.facilityId);
    const report = (await store.revenue(operator, { facilityId, from: query.from, to: query.to })) as Record<string, unknown>;
    const currency = await store.currency(operator);
    return respond(
      RevenueResponseSchema,
      { ...report, facilityId, from: query.from, to: query.to, currency },
      'erp_revenue_failed_contract',
    );
  });
}
