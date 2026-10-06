import { z } from 'zod';
import { DisclosureSchema, ProvenanceSchema } from './common.ts';
import { CurrencyCodeSchema, ErpDateSchema, ErpInstantSchema } from './erp-common.ts';
import type { RoleId } from './roles.ts';

/*
 * The leadership view of hospital revenue (ADR 0022 §5): what the ERP bills
 * and collects, as AGGREGATES per hospital inside the caller's verified scope.
 * Amounts only. Nothing here names a patient, a bill or a visit.
 *
 * This is NOT the KPI scorecard: the workbook revenue KPIs are monthly
 * synthetic history; this is the live ERP. The two are shown side by side and
 * never merged.
 */

/**
 * Roles that see hospital revenue. The API enforces it; the web app only uses
 * it to decide whether to show the link. Finance and operations leaders.
 */
export const REVENUE_FEED_ROLES = [
  'chairman',
  'regional-coo',
  'hospital-dho',
  'group-cfo',
  'billing-lead',
  'corporate-revenue-lead',
] as const satisfies readonly RoleId[];

export function seesRevenue(role: RoleId): boolean {
  return (REVENUE_FEED_ROLES as readonly RoleId[]).includes(role);
}

const Money = z.number().min(0);
const Count = z.number().int().min(0);

export const RevenueFigureSchema = z.strictObject({
  bills: Count,
  gross: Money,
  insurance: Money,
  patient: Money,
  collected: Money,
  grossToday: Money,
  collectedToday: Money,
  openBills: Count,
  outstandingPatient: Money,
  outstandingInsurer: Money,
});
export type RevenueFigure = z.infer<typeof RevenueFigureSchema>;

export const RevenueHospitalSchema = z.strictObject({
  facilityId: z.uuid(),
  name: z.string().min(1),
  figures: RevenueFigureSchema,
  daily: z.array(z.strictObject({ day: ErpDateSchema, gross: Money, collected: Money })),
});
export type RevenueHospital = z.infer<typeof RevenueHospitalSchema>;

export const RevenueFeedResponseSchema = z.strictObject({
  days: z.number().int().min(1).max(92),
  currency: CurrencyCodeSchema,
  asOf: ErpInstantSchema,
  totals: RevenueFigureSchema,
  hospitals: z.array(RevenueHospitalSchema),
  provenance: ProvenanceSchema,
  disclosure: DisclosureSchema,
});
export type RevenueFeedResponse = z.infer<typeof RevenueFeedResponseSchema>;

export const RevenueFeedQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(92).default(30),
});
export type RevenueFeedQuery = z.infer<typeof RevenueFeedQuerySchema>;
