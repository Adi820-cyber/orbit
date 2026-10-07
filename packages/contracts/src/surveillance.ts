import { z } from 'zod';
import { DisclosureSchema, ProvenanceSchema } from './common.ts';
import { ErpDateSchema, ErpInstantSchema } from './erp-common.ts';
import type { RoleId } from './roles.ts';

/*
 * Outbreak watch (ADR 0023): presenting conditions recorded on hospital visits,
 * counted across the group, with the product owner's surge rule and an XGBoost
 * forecast of the coming window.
 *
 * Counts only. No patient is ever named. Group totals are shown to every role
 * here (a hospital must be told when it is part of a group-wide surge); counts
 * per hospital only for hospitals inside the caller's verified scope.
 *
 * Synthetic demonstration data. Not a diagnosis, not a public-health
 * notification, not for clinical decisions.
 */

/** Roles that see the outbreak watch (product owner, 2026-10-07). The API enforces it. */
export const SURVEILLANCE_ROLES = ['chairman', 'clinical-director', 'regional-coo', 'hospital-dho'] as const satisfies readonly RoleId[];

export function seesSurveillance(role: RoleId): boolean {
  return (SURVEILLANCE_ROLES as readonly RoleId[]).includes(role);
}

const Count = z.number().int().min(0);
const Rate = z.number().min(0);
const Probability = z.number().min(0).max(1);

export const SurveillanceRuleSchema = z.strictObject({
  windowDays: z.number().int().min(1).max(28),
  minPatients: z.number().int().min(1),
  minHospitals: z.number().int().min(1),
});
export type SurveillanceRule = z.infer<typeof SurveillanceRuleSchema>;

export const ForecastRunSchema = z.strictObject({
  model: z.string().min(1),
  trainedAt: ErpInstantSchema,
  dataThrough: ErpDateSchema,
  horizonDays: z.number().int().min(1).max(28),
  trainingRows: Count,
  /** Mean absolute error on held-out recent windows, patients per hospital and condition. */
  modelMae: Rate,
  /** The same for "the next window equals the last one". */
  baselineMae: Rate,
  /** True only when the model's error is lower than the naive baseline's. */
  beatsBaseline: z.boolean(),
  notes: z.string().min(1),
});
export type ForecastRun = z.infer<typeof ForecastRunSchema>;

export const ConditionWatchSchema = z.strictObject({
  conditionId: z.uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  /** Group-wide, in the rule's window. */
  patients: Count,
  hospitals: Count,
  /** Mean of the four earlier windows, group-wide. */
  usualPatients: Rate,
  /** The rule fired: at least minPatients patients across at least minHospitals hospitals. */
  alert: z.boolean(),
  /** The latest forecast for the coming window, group-wide; null before the first run. */
  forecast: z
    .strictObject({
      expectedPatients: Rate,
      /** Probability the coming window reaches minPatients patients. */
      pPatients: Probability,
      /** Probability at least minHospitals hospitals see a case. */
      pHospitals: Probability,
    })
    .nullable(),
  /** Hospitals inside the caller's scope with a case or a forecast. */
  inScope: z.array(
    z.strictObject({
      facilityId: z.uuid(),
      name: z.string().min(1),
      patients: Count,
      expectedPatients: Rate.nullable(),
    }),
  ),
});
export type ConditionWatch = z.infer<typeof ConditionWatchSchema>;

export const SurveillanceResponseSchema = z.strictObject({
  asOf: ErpInstantSchema,
  rule: SurveillanceRuleSchema,
  forecastRun: ForecastRunSchema.nullable(),
  /** Alerts first, then by patients. */
  conditions: z.array(ConditionWatchSchema),
  limitations: z.array(z.string().min(1)),
  provenance: ProvenanceSchema,
  disclosure: DisclosureSchema,
});
export type SurveillanceResponse = z.infer<typeof SurveillanceResponseSchema>;
