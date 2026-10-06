import type { BillListResponse, SetCoverageRequest } from '@orbit/contracts';
import { SimApiError } from './erp-client.ts';
import { write, read, type Ctx, type FacilityRef } from './ctx.ts';
import { rngFor, stableUuid } from './rng.ts';

/*
 * Billing in the simulated hospitals (ADR 0022).
 *
 *  - A new patient gets an insurance cover with the shares the reference
 *    hospital dataset shows: 60% of patients hold a policy; of the policies,
 *    59.7% are government schemes and 40.3% private; each covers 50, 60, 70, 80
 *    or 90 percent of a bill, about equally often. No payer is named (the
 *    dataset's insurer names are not reused).
 *  - A visit is billed when it closes. A visit with a service that has no
 *    price yet cannot be billed; that is expected until an admin prices it, so
 *    it is counted as `unbillable`, not as a failure.
 *  - Patients pay their share by cash, card or UPI (about equally often in the
 *    dataset), most at the desk and some within a few days; a few leave it owed.
 *    Insurers settle their share after a few days.
 *
 * Every decision comes from a seeded stream and every write carries a stable
 * idempotency key, so a rerun replays rather than duplicates.
 */

const INSURED_SHARE = 0.6;
const GOVERNMENT_SHARE = 0.597;
const COVER_PERCENTS = [50, 60, 70, 80, 90] as const;
const PATIENT_METHODS = ['cash', 'card', 'upi'] as const;
/** Patients who pay at the desk when the bill is issued. */
const PAYS_AT_DESK = 0.7;
/** Patients who never pay within the simulation (their share stays owed). */
const LEAVES_OWED = 0.08;
const HOUR_MS = 3_600_000;

/** The deterministic cover for a new patient. */
export function coverFor(seed: string, patientId: string): SetCoverageRequest {
  const rand = rngFor(seed, 'cover', patientId);
  if (!rand.chance(INSURED_SHARE)) return { payerType: 'self-pay', coveragePercent: 0 };
  return {
    payerType: rand.chance(GOVERNMENT_SHARE) ? 'government' : 'private',
    coveragePercent: rand.pick(COVER_PERCENTS),
  };
}

/** Records a new patient's cover. A failure leaves them self-pay, which is still a valid state. */
export async function recordCover(ctx: Ctx, facility: FacilityRef, patientId: string): Promise<void> {
  const cover = coverFor(ctx.cfg.seed, patientId);
  if (cover.payerType === 'self-pay') return; // no cover is the default; nothing to write
  await write(ctx, 'record insurance cover', () => ctx.deskFor(facility).api.setCoverage(patientId, cover));
}

const unpriced = (error: unknown) => error instanceof SimApiError && error.status === 409 && error.message.startsWith('No price is set');
/** A visit with no service recorded (e.g. one whose services fell outside the catch-up window) has nothing to bill. */
const nothingToBill = (error: unknown) => error instanceof SimApiError && error.status === 409 && error.message.startsWith('This visit has no services left to bill');

type Bill = BillListResponse['items'][number];

function patientPlan(seed: string, billId: string) {
  const rand = rngFor(seed, 'patient-payment', billId);
  return {
    atDesk: rand.chance(PAYS_AT_DESK),
    never: rand.chance(LEAVES_OWED),
    afterHours: rand.int(6, 72),
    method: rand.pick(PATIENT_METHODS),
  };
}

const insurerDelayHours = (seed: string, billId: string) => rngFor(seed, 'insurer-settlement', billId).int(2 * 24, 10 * 24);

async function pay(ctx: Ctx, facility: FacilityRef, bill: Bill, payer: 'patient' | 'insurer', amount: number, method: 'cash' | 'card' | 'upi'): Promise<void> {
  if (amount <= 0) return;
  const result = await write(ctx, payer === 'insurer' ? 'record insurer settlement' : 'record patient payment', () =>
    ctx.deskFor(facility).api.recordPayment(bill.billId, {
      payer,
      method: payer === 'insurer' ? 'insurance-settlement' : method,
      amount: Math.round(amount * 100) / 100,
      idempotencyKey: stableUuid(ctx.cfg.seed, `pay-${payer}`, bill.billId),
    }),
  );
  if (result.status === 'ok') ctx.stats.payments += 1;
}

/** Bills a visit that has just closed, and takes the patient's share at the desk when they pay there. */
export async function billClosedVisit(ctx: Ctx, facility: FacilityRef, encounterId: string): Promise<void> {
  const result = await write(
    ctx,
    'issue bill',
    () => ctx.deskFor(facility).api.issueBill(encounterId, { idempotencyKey: stableUuid(ctx.cfg.seed, 'bill', encounterId) }),
    { expected: (error) => unpriced(error) || nothingToBill(error) },
  );
  if (result.status === 'failed' && unpriced(result.error)) {
    ctx.stats.unbillable += 1;
    return;
  }
  if (result.status !== 'ok') return;
  ctx.stats.bills += 1;
  const { bill } = result.value;
  const plan = patientPlan(ctx.cfg.seed, bill.billId);
  if (plan.atDesk && !plan.never) await pay(ctx, facility, bill, 'patient', bill.patientAmount - bill.paidByPatient, plan.method);
}

/**
 * Settles what is due on this hospital's open bills: a patient's share once
 * their delay has passed, an insurer's after its settlement delay.
 */
export async function runBilling(ctx: Ctx, facility: FacilityRef): Promise<void> {
  const open = await read(ctx, 'read open bills', () =>
    ctx.deskFor(facility).api.bills({ facilityId: facility.facilityId, state: 'open', page: 1, pageSize: 100 }),
  );
  if (!open) return;
  const nowMs = ctx.clock.now().getTime();
  for (const bill of open.items) {
    const ageHours = (nowMs - Date.parse(bill.issuedAt)) / HOUR_MS;
    const patientOwed = bill.patientAmount - bill.paidByPatient;
    const insurerOwed = bill.insuranceAmount - bill.paidByInsurer;
    const plan = patientPlan(ctx.cfg.seed, bill.billId);
    if (patientOwed > 0 && !plan.never && ageHours >= plan.afterHours) {
      await pay(ctx, facility, bill, 'patient', patientOwed, plan.method);
    }
    if (insurerOwed > 0 && ageHours >= insurerDelayHours(ctx.cfg.seed, bill.billId)) {
      await pay(ctx, facility, bill, 'insurer', insurerOwed, 'cash');
    }
  }
}
