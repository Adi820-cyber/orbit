import { afterEach, describe, expect, it } from 'vitest';
import {
  BillListResponseSchema,
  BillableVisitListResponseSchema,
  BillResponseSchema,
  CoverageResponseSchema,
  REVENUE_FEED_ROLES,
  RevenueFeedResponseSchema,
  RevenueResponseSchema,
  ServiceCatalogueResponseSchema,
  seesRevenue,
} from '@orbit/contracts';
import { BILL_ID, buildErpApp, ENCOUNTER_ID, FACILITY_1, FACILITY_2, OPERATOR_SUBJECT, PATIENT_ID } from '../../../test/helpers/erp.ts';
import { SUBJECT } from '../../../test/helpers/fixtures.ts';
import { buildModuleApp } from '../../../test/helpers/modules.ts';

/*
 * Billing routes (ADR 0022): who may do what, which facility a request is
 * about, and that every response parses against the shared contract. The SQL,
 * RLS and triggers are proven against Postgres in src/db/erp.test.ts.
 */

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

const { admin, hospital1 } = OPERATOR_SUBJECT;

async function erp(...args: Parameters<typeof buildErpApp>) {
  const built = await buildErpApp(...args);
  close = () => built.app.close();
  return built;
}

const facilityOf = (calls: { method: string; args: unknown[] }[], method: string) =>
  (calls.find((call) => call.method === method)?.args[0] as { facilityId?: string | null } | undefined)?.facilityId;

describe('ERP billing routes', () => {
  it("shows a hospital account its own hospital's catalogue and prices, with the currency", async () => {
    const { call, calls } = await erp();
    const response = await call(hospital1, 'GET', '/api/erp/services');
    expect(response.statusCode).toBe(200);
    const body = ServiceCatalogueResponseSchema.parse(response.json());
    expect(body).toMatchObject({ facilityId: FACILITY_1, currency: 'INR' });
    expect(facilityOf(calls, 'catalogue')).toBe(FACILITY_1);
  });

  it('issues a bill (201), lists and shows it, and records a payment', async () => {
    const { call } = await erp();
    const issued = await call(hospital1, 'POST', `/api/erp/encounters/${ENCOUNTER_ID}/bills`, { idempotencyKey: crypto.randomUUID() });
    expect(issued.statusCode).toBe(201);
    expect(BillResponseSchema.parse(issued.json()).bill.billId).toBe(BILL_ID);

    const list = await call(hospital1, 'GET', '/api/erp/bills?state=open');
    expect(BillListResponseSchema.parse(list.json()).items).toHaveLength(1);

    const shown = await call(hospital1, 'GET', `/api/erp/bills/${BILL_ID}`);
    expect(BillResponseSchema.parse(shown.json()).bill.lines).toHaveLength(1);

    const paid = await call(hospital1, 'POST', `/api/erp/bills/${BILL_ID}/payments`, {
      payer: 'patient', method: 'upi', amount: 300, idempotencyKey: crypto.randomUUID(),
    });
    expect(paid.statusCode).toBe(201);
    expect(BillResponseSchema.parse(paid.json()).bill.paidByPatient).toBe(400);
  });

  it("lists the hospital account's own visits ready to bill, for at most 92 days", async () => {
    const { call, calls } = await erp();
    const response = await call(hospital1, 'GET', '/api/erp/bills/ready');
    expect(response.statusCode).toBe(200);
    const body = BillableVisitListResponseSchema.parse(response.json());
    expect(body).toMatchObject({ days: 30, currency: 'INR' });
    expect(body.items[0]).toMatchObject({ encounterId: ENCOUNTER_ID, amount: 10010 });
    expect(calls.find((entry) => entry.method === 'billableVisits')?.args[0]).toMatchObject({ facilityId: FACILITY_1 });
    expect((await call(hospital1, 'GET', '/api/erp/bills/ready?days=120')).statusCode).toBe(400);
    expect((await call(hospital1, 'GET', `/api/erp/bills/ready?facilityId=${FACILITY_2}`)).statusCode).toBe(403);
  });

  it('answers not_found for a visit or bill the caller cannot see', async () => {
    const { call } = await erp();
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await call(hospital1, 'POST', `/api/erp/encounters/${missing}/bills`, { idempotencyKey: crypto.randomUUID() })).statusCode).toBe(404);
    expect((await call(hospital1, 'GET', `/api/erp/bills/${missing}`)).statusCode).toBe(404);
  });

  it('refuses a payment whose method does not match its payer, before the store', async () => {
    const { call, calls } = await erp();
    const response = await call(hospital1, 'POST', `/api/erp/bills/${BILL_ID}/payments`, {
      payer: 'insurer', method: 'cash', amount: 10, idempotencyKey: crypto.randomUUID(),
    });
    expect(response.statusCode).toBe(400);
    expect(calls.some((entry) => entry.method === 'recordPayment')).toBe(false);
  });

  it('lets only an admin cancel a bill', async () => {
    const { call, calls } = await erp();
    const refused = await call(hospital1, 'POST', `/api/erp/bills/${BILL_ID}/cancel`, { version: 1, reason: 'Raised in error' });
    expect(refused.statusCode).toBe(403);
    expect(calls.some((entry) => entry.method === 'cancelBill')).toBe(false);
    const cancelled = await call(admin, 'POST', `/api/erp/bills/${BILL_ID}/cancel`, { version: 1, reason: 'Raised in error' });
    expect(cancelled.statusCode).toBe(200);
    expect(BillResponseSchema.parse(cancelled.json()).bill).toMatchObject({ status: 'cancelled', paymentState: 'cancelled' });
  });

  it('keeps cover consistent: self-pay covers 0%, an insurer more', async () => {
    const { call } = await erp();
    expect((await call(hospital1, 'PUT', `/api/erp/patients/${PATIENT_ID}/coverage`, { payerType: 'self-pay', coveragePercent: 40 })).statusCode).toBe(400);
    expect((await call(hospital1, 'PUT', `/api/erp/patients/${PATIENT_ID}/coverage`, { payerType: 'private', coveragePercent: 0 })).statusCode).toBe(400);
    const saved = await call(hospital1, 'PUT', `/api/erp/patients/${PATIENT_ID}/coverage`, { payerType: 'government', coveragePercent: 70 });
    expect(CoverageResponseSchema.parse(saved.json()).coverage).toMatchObject({ payerType: 'government', coveragePercent: 70 });
  });

  it('reports revenue for the hospital account\'s own hospital, and refuses another', async () => {
    const { call, calls } = await erp();
    const own = await call(hospital1, 'GET', '/api/erp/revenue?from=2026-09-01&to=2026-09-28');
    expect(RevenueResponseSchema.parse(own.json())).toMatchObject({ facilityId: FACILITY_1, currency: 'INR', totals: { gross: 1000 } });
    expect(facilityOf(calls, 'revenue')).toBe(FACILITY_1);
    const other = await call(hospital1, 'GET', `/api/erp/revenue?from=2026-09-01&to=2026-09-28&facilityId=${FACILITY_2}`);
    expect(other.statusCode).toBe(403);
    expect(other.json().error.code).toBe('out_of_scope');
  });

  it('lets an admin see every hospital together, and rejects a period over 93 days', async () => {
    const { call, calls } = await erp();
    const all = await call(admin, 'GET', '/api/erp/revenue?from=2026-09-01&to=2026-09-28');
    expect(RevenueResponseSchema.parse(all.json()).facilityId).toBeNull();
    expect(facilityOf(calls, 'revenue')).toBeNull();
    expect((await call(admin, 'GET', '/api/erp/revenue?from=2026-01-01&to=2026-09-28')).statusCode).toBe(400);
  });
});

describe('leaders\' hospital revenue (GET /api/revenue)', () => {
  it('is for finance and operations leaders only', () => {
    expect(REVENUE_FEED_ROLES).toEqual(['chairman', 'regional-coo', 'hospital-dho', 'group-cfo', 'billing-lead', 'corporate-revenue-lead']);
    for (const role of ['people-executive', 'hr-head', 'clinical-director', 'legal-head', 'procurement-head', 'analytics-head'] as const) {
      expect(seesRevenue(role)).toBe(false);
    }
  });

  it('names each hospital from the caller\'s own directory and adds up the totals', async () => {
    const A1 = 'e0000000-0000-4000-8000-0000000000a1';
    const A2 = 'e0000000-0000-4000-8000-0000000000a2';
    const figure = (gross: number) => ({
      bills: 2, gross, insurance: gross / 2, patient: gross / 2, collected: gross, grossToday: 0, collectedToday: 0,
      openBills: 0, outstandingPatient: 0, outstandingInsurer: 0,
    });
    const built = await buildModuleApp({
      revenue: {
        summary: async () => [{ facilityId: A1, ...figure(1000) }, { facilityId: A2, ...figure(500.5) }],
        daily: async () => [{ facilityId: A1, day: '2026-10-06', gross: 1000, collected: 1000 }],
        currency: async () => 'INR',
      },
    });
    close = () => built.app.close();
    // The regional COO sees both hospitals of region A (the fixture directory is region A's view).
    {
      const response = await built.call(SUBJECT.cooRegionA, 'GET', '/api/revenue');
      expect(response.statusCode).toBe(200);
      const body = RevenueFeedResponseSchema.parse(response.json());
      expect(body.hospitals.map((hospital) => hospital.name)).toEqual(['Fixture facility A1', 'Fixture facility A2']);
      expect(body.totals.gross).toBe(1500.5);
      expect(body.currency).toBe('INR');
    }
  });

  it('fails closed when the source returns a hospital outside the caller\'s scope', async () => {
    const built = await buildModuleApp({
      revenue: {
        summary: async () => [{
          facilityId: 'e0000000-0000-4000-8000-0000000000b1', bills: 0, gross: 0, insurance: 0, patient: 0, collected: 0,
          grossToday: 0, collectedToday: 0, openBills: 0, outstandingPatient: 0, outstandingInsurer: 0,
        }],
        daily: async () => [],
        currency: async () => 'INR',
      },
    });
    close = () => built.app.close();
    const response = await built.call(SUBJECT.cooRegionA, 'GET', '/api/revenue');
    expect(response.statusCode).toBe(500);
  });
});
