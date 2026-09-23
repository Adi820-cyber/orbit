import { z } from 'zod';
import { ScopeEntitySchema } from './membership.ts';

/*
 * Building blocks shared by every number-bearing payload (brief, inbox, kpi,
 * ask, actions). DRAFT for Gate 1: authored by Ghansham, to be reviewed by
 * Ayas (UI states), Maruti (generator output), and Aditya (arbitration).
 */

/** Every public record is illustrative in v1 (PRD §8.4). Anything else fails to parse. */
export const ProvenanceSchema = z.literal('illustrative');
export type Provenance = z.infer<typeof ProvenanceSchema>;

/**
 * Data-quality dimensions (PRD FR-04, FR-08, §8.4). `state` is always
 * `illustrative`; reconciliation and freshness are separate dimensions so they
 * can never make the data look real. `refreshedAt` is the simulated refresh
 * time from the generator, not a live-source claim.
 */
export const DataQualitySchema = z.strictObject({
  state: z.literal('illustrative'),
  reconciliation: z.enum(['reconciled', 'unreconciled', 'not_applicable']),
  freshness: z.enum(['current', 'late', 'stale']),
  refreshedAt: z.iso.datetime({ offset: true }),
  limitations: z.array(z.string().min(1)),
});
export type DataQuality = z.infer<typeof DataQualitySchema>;

/** The disclosure string the UI must render on every number surface (PRD §8.4). */
export const DisclosureSchema = z.string().min(1);

/**
 * A reporting period at the measure's real cadence. Annual or quarterly
 * measures keep their cadence rather than acquiring monthly observations
 * (PRD §8.1).
 */
export const PeriodSchema = z
  .strictObject({
    cadence: z.enum(['month', 'quarter', 'year']),
    start: z.iso.date(),
    end: z.iso.date(),
  })
  .refine((period) => period.start <= period.end, { message: 'period start must not be after end' });
export type Period = z.infer<typeof PeriodSchema>;

/**
 * A measured value. Missing is never zero, and a zero or invalid denominator
 * is an explicit not-applicable result (PRD §7.9).
 */
export const MeasureValueSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('available'), value: z.number().finite() }),
  z.strictObject({ status: z.literal('missing'), reason: z.enum(['not_reported', 'missing_denominator']) }),
  z.strictObject({ status: z.literal('not_applicable'), reason: z.enum(['zero_denominator', 'invalid_denominator']) }),
]);
export type MeasureValue = z.infer<typeof MeasureValueSchema>;

/**
 * Target semantics (PRD §7.3–7.5). v1 has no client-approved targets: a
 * configured target is either a reviewed demo parameter or explicitly
 * unapproved. Direction must be stated before any comparison is scored.
 */
const TargetApprovalSchema = z.enum(['demo_parameter', 'unapproved']);

export const TargetSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('not_configured') }),
  z.strictObject({
    state: z.literal('configured'),
    value: z.number().finite(),
    direction: z.enum(['higher_is_better', 'lower_is_better']),
    approval: TargetApprovalSchema,
    basis: z.string().min(1),
  }),
  z
    .strictObject({
      state: z.literal('configured_range'),
      low: z.number().finite(),
      high: z.number().finite(),
      approval: TargetApprovalSchema,
      basis: z.string().min(1),
    })
    .refine((target) => target.low <= target.high, { message: 'target range low must not exceed high' }),
]);
export type Target = z.infer<typeof TargetSchema>;

/**
 * One component of a KPI (PRD FR-04): a numerator, a denominator, or a
 * separately reported measure of a bundled assignment. Components are never
 * collapsed into an unexplained composite.
 */
export const ComponentMeasureSchema = z.strictObject({
  componentId: z.string().min(1),
  label: z.string().min(1),
  role: z.enum(['numerator', 'denominator', 'measure']),
  unit: z.string().min(1),
  value: MeasureValueSchema,
});
export type ComponentMeasure = z.infer<typeof ComponentMeasureSchema>;

/** One derived KPI observation for one entity and period, with its lineage. */
export const ObservationSchema = z.strictObject({
  observationId: z.string().min(1),
  assignmentId: z.string().min(1),
  definitionFamily: z.string().min(1),
  definitionVersion: z.string().min(1),
  entity: ScopeEntitySchema,
  period: PeriodSchema,
  unit: z.string().min(1),
  value: MeasureValueSchema,
  components: z.array(ComponentMeasureSchema),
  target: TargetSchema,
  provenance: ProvenanceSchema,
  dataQuality: DataQualitySchema,
});
export type Observation = z.infer<typeof ObservationSchema>;

/**
 * What a brief item, Ask answer, or action points at (PRD FR-07): the
 * observations used plus the dataset and definition version they came from,
 * so an action keeps its original evidence when observations change.
 */
export const EvidenceRefSchema = z.strictObject({
  observationIds: z.array(z.string().min(1)).min(1),
  definitionVersion: z.string().min(1),
  datasetChecksum: z.string().min(1),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

/** Cursor pagination for list endpoints (Vercel 4.5 MB body limit, ARCH §11.4). */
export const PageQuerySchema = z.strictObject({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;
