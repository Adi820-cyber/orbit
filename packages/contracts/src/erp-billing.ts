import { z } from 'zod';
import { CurrencyCodeSchema, ErpDateSchema, ErpDisclosureFields, ErpInstantSchema, ErpPageQuerySchema, ErpPageSchema, ErpVersionSchema } from './erp-common.ts';
import { ServiceCategorySchema } from './erp-services.ts';

/*
 * Billing in the hospital operations ERP (ADR 0022).
 *
 * Amounts are in the organization currency (INR for Kestrion), as numbers with
 * two decimals. Every amount is illustrative: fictional patients, prices
 * derived from the reference dataset or set by an admin, no real charge.
 *
 * A bill's amounts are fixed when it is issued. Its payment state is derived
 * from the payments against it, never stored: unpaid, part-paid, paid, or
 * cancelled (an admin may cancel a bill that has no payment).
 */

const Money = z.number().min(0);
const Count = z.number().int().min(0);

export const PayerTypeSchema = z.enum(['self-pay', 'government', 'private']);
export type PayerType = z.infer<typeof PayerTypeSchema>;

// ---------------------------------------------------------------------------
// Insurance cover
// ---------------------------------------------------------------------------

export const CoverageSchema = z.strictObject({
  patientId: z.uuid(),
  payerType: PayerTypeSchema,
  /** A fictional payer name, or null (always null for self-pay). */
  payerName: z.string().min(1).max(120).nullable(),
  /** Share of a bill the payer covers, 0 for self-pay. */
  coveragePercent: z.number().min(0).max(100),
  /** null until a cover is first set for this patient. */
  version: ErpVersionSchema.nullable(),
});
export type Coverage = z.infer<typeof CoverageSchema>;

export const SetCoverageRequestSchema = z
  .strictObject({
    payerType: PayerTypeSchema,
    payerName: z.string().trim().min(1).max(120).optional(),
    coveragePercent: z.number().min(0).max(100),
    /** The version read; omitted when the patient has no cover yet. */
    version: ErpVersionSchema.optional(),
  })
  .refine((value) => (value.payerType === 'self-pay') === (value.coveragePercent === 0), {
    message: 'Self-pay covers 0%; an insurer covers more than 0%.',
    path: ['coveragePercent'],
  })
  .refine((value) => value.payerType !== 'self-pay' || value.payerName === undefined, {
    message: 'Self-pay names no payer.',
    path: ['payerName'],
  });
export type SetCoverageRequest = z.infer<typeof SetCoverageRequestSchema>;

export const CoverageResponseSchema = z.strictObject({ coverage: CoverageSchema, ...ErpDisclosureFields });
export type CoverageResponse = z.infer<typeof CoverageResponseSchema>;

// ---------------------------------------------------------------------------
// Bills
// ---------------------------------------------------------------------------

export const BillStatusSchema = z.enum(['issued', 'cancelled']);
export type BillStatus = z.infer<typeof BillStatusSchema>;

/** Derived from the payments, never stored. */
export const PaymentStateSchema = z.enum(['unpaid', 'part-paid', 'paid', 'cancelled']);
export type PaymentState = z.infer<typeof PaymentStateSchema>;

export const PaymentPayerSchema = z.enum(['patient', 'insurer']);
export type PaymentPayer = z.infer<typeof PaymentPayerSchema>;

/** An insurer settles; a patient pays by cash, card, UPI or bank transfer. */
export const PaymentMethodSchema = z.enum(['cash', 'card', 'upi', 'bank-transfer', 'insurance-settlement']);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const BillLineSchema = z.strictObject({
  lineId: z.uuid(),
  serviceDeliveryId: z.uuid(),
  serviceId: z.uuid(),
  description: z.string().min(1),
  quantity: z.number().int().min(1),
  unitPrice: Money,
  lineAmount: Money,
});
export type BillLine = z.infer<typeof BillLineSchema>;

export const PaymentSchema = z.strictObject({
  paymentId: z.uuid(),
  payer: PaymentPayerSchema,
  method: PaymentMethodSchema,
  amount: z.number().positive(),
  receivedAt: ErpInstantSchema,
  reference: z.string().min(1).nullable(),
});
export type Payment = z.infer<typeof PaymentSchema>;

export const BillSummarySchema = z.strictObject({
  billId: z.uuid(),
  billNumber: z.string().regex(/^DEMO-BILL-\d{6,9}$/),
  facilityId: z.uuid(),
  encounterId: z.uuid(),
  patientId: z.uuid(),
  patientName: z.string().min(1),
  mrn: z.string().min(1),
  status: BillStatusSchema,
  paymentState: PaymentStateSchema,
  payerType: PayerTypeSchema,
  payerName: z.string().min(1).nullable(),
  coveragePercent: z.number().min(0).max(100),
  grossAmount: Money,
  insuranceAmount: Money,
  patientAmount: Money,
  paidByPatient: Money,
  paidByInsurer: Money,
  /** Still owed on this bill by both payers; 0 once paid or cancelled. */
  balance: Money,
  issuedAt: ErpInstantSchema,
  cancelledAt: ErpInstantSchema.nullable(),
  version: ErpVersionSchema,
});
export type BillSummary = z.infer<typeof BillSummarySchema>;

export const BillDetailSchema = z.strictObject({
  ...BillSummarySchema.shape,
  cancelReason: z.string().min(1).nullable(),
  lines: z.array(BillLineSchema),
  payments: z.array(PaymentSchema),
});
export type BillDetail = z.infer<typeof BillDetailSchema>;

export const BillParamsSchema = z.strictObject({ billId: z.uuid() });

export const BillListQuerySchema = ErpPageQuerySchema.extend({
  facilityId: z.uuid().optional(),
  /** `open` = unpaid or part-paid. */
  state: z.enum(['open', 'unpaid', 'part-paid', 'paid', 'cancelled']).optional(),
  /** Bill number or patient name. */
  q: z.string().trim().min(1).max(80).optional(),
  encounterId: z.uuid().optional(),
});
export type BillListQuery = z.infer<typeof BillListQuerySchema>;

export const BillListResponseSchema = z.strictObject({
  items: z.array(BillSummarySchema),
  page: ErpPageSchema,
  currency: CurrencyCodeSchema,
  ...ErpDisclosureFields,
});
export type BillListResponse = z.infer<typeof BillListResponseSchema>;

export const IssueBillRequestSchema = z.strictObject({ idempotencyKey: z.uuid() });
export type IssueBillRequest = z.infer<typeof IssueBillRequestSchema>;

export const BillResponseSchema = z.strictObject({
  bill: BillDetailSchema,
  currency: CurrencyCodeSchema,
  ...ErpDisclosureFields,
});
export type BillResponse = z.infer<typeof BillResponseSchema>;

export const RecordPaymentRequestSchema = z
  .strictObject({
    payer: PaymentPayerSchema,
    method: PaymentMethodSchema,
    amount: z.number().positive().max(100_000_000).multipleOf(0.01),
    reference: z.string().trim().min(1).max(60).optional(),
    receivedAt: ErpInstantSchema.optional(),
    idempotencyKey: z.uuid(),
  })
  .refine((value) => (value.payer === 'insurer') === (value.method === 'insurance-settlement'), {
    message: 'An insurer pays by insurance settlement; a patient by cash, card, UPI or bank transfer.',
    path: ['method'],
  });
export type RecordPaymentRequest = z.infer<typeof RecordPaymentRequestSchema>;

export const CancelBillRequestSchema = z.strictObject({
  version: ErpVersionSchema,
  reason: z.string().trim().min(3).max(500),
});
export type CancelBillRequest = z.infer<typeof CancelBillRequestSchema>;

// ---------------------------------------------------------------------------
// Revenue (ERP)
// ---------------------------------------------------------------------------

export const RevenueQuerySchema = z
  .object({
    facilityId: z.uuid().optional(),
    from: ErpDateSchema,
    to: ErpDateSchema,
  })
  .refine((value) => value.from <= value.to, { message: 'from must not be after to', path: ['from'] })
  .refine((value) => (Date.parse(value.to) - Date.parse(value.from)) / 86_400_000 <= 92, {
    message: 'Choose at most 93 days.',
    path: ['to'],
  });
export type RevenueQuery = z.infer<typeof RevenueQuerySchema>;

export const RevenueTotalsSchema = z.strictObject({
  bills: Count,
  gross: Money,
  insurance: Money,
  patient: Money,
  collected: Money,
  collectedFromPatients: Money,
  collectedFromInsurers: Money,
  /** Owed now on every standing bill (not only the range). */
  outstandingPatient: Money,
  outstandingInsurer: Money,
  openBills: Count,
});
export type RevenueTotals = z.infer<typeof RevenueTotalsSchema>;

export const RevenueResponseSchema = z.strictObject({
  facilityId: z.uuid().nullable(),
  from: ErpDateSchema,
  to: ErpDateSchema,
  currency: CurrencyCodeSchema,
  totals: RevenueTotalsSchema,
  daily: z.array(z.strictObject({ day: ErpDateSchema, bills: Count, gross: Money, collected: Money })),
  byCategory: z.array(z.strictObject({ category: ServiceCategorySchema, lines: Count, amount: Money })),
  byMethod: z.array(z.strictObject({ method: PaymentMethodSchema, payments: Count, amount: Money })),
  /** Services offered here with no price: visits using them cannot be billed until an admin prices them. */
  unpricedServices: z.array(z.strictObject({ serviceId: z.uuid(), name: z.string().min(1) })),
  ...ErpDisclosureFields,
});
export type RevenueResponse = z.infer<typeof RevenueResponseSchema>;

// ---------------------------------------------------------------------------
// New bill: closed visits with services still to bill
// ---------------------------------------------------------------------------

export const BillableVisitQuerySchema = ErpPageQuerySchema.extend({
  facilityId: z.uuid().optional(),
  /** Visits closed within this many days. Older visits (e.g. loaded history) are not offered. */
  days: z.coerce.number().int().min(1).max(92).default(30),
});
export type BillableVisitQuery = z.infer<typeof BillableVisitQuerySchema>;

export const BillableVisitSchema = z.strictObject({
  encounterId: z.uuid(),
  facilityId: z.uuid(),
  patientId: z.uuid(),
  patientName: z.string().min(1),
  mrn: z.string().min(1),
  encounterType: z.enum(['outpatient', 'inpatient', 'emergency', 'day-care']),
  endedAt: ErpInstantSchema,
  /** Completed services on the visit not yet on a standing bill. */
  items: Count,
  /** What the bill would total; null while any of those services has no price. */
  amount: Money.nullable(),
  /** Names of those services with no price; a bill cannot be issued until an admin prices them. */
  unpricedServices: z.array(z.string().min(1)),
});
export type BillableVisit = z.infer<typeof BillableVisitSchema>;

export const BillableVisitListResponseSchema = z.strictObject({
  items: z.array(BillableVisitSchema),
  page: ErpPageSchema,
  days: z.number().int().min(1).max(92),
  currency: CurrencyCodeSchema,
  ...ErpDisclosureFields,
});
export type BillableVisitListResponse = z.infer<typeof BillableVisitListResponseSchema>;
