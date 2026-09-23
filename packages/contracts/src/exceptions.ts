import { z } from 'zod';
import {
  DataQualitySchema,
  DisclosureSchema,
  EvidenceRefSchema,
  PeriodSchema,
  ProvenanceSchema,
} from './common.ts';
import { ScopeEntitySchema } from './membership.ts';
import { RoleIdSchema } from './roles.ts';

/*
 * Morning brief and priority inbox payloads (PRD FR-02, FR-03). DRAFT for Gate 1.
 */

/** Internal action lifecycle states named in PRD FR-06. Allowed transitions are Aditya's open decision. */
export const ActionStateSchema = z.enum(['open', 'acknowledged', 'in_progress', 'completed', 'cancelled']);
export type ActionState = z.infer<typeof ActionStateSchema>;

/**
 * How an exception was raised (PRD FR-03): by a reviewed rule, or as a
 * deliberately seeded scenario that the UI must label as such. There is no
 * third, unreviewed path.
 */
export const DetectionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('reviewed_rule'), ruleId: z.string().min(1) }),
  z.strictObject({ kind: z.literal('seeded_scenario'), scenarioLabel: z.string().min(1) }),
]);
export type Detection = z.infer<typeof DetectionSchema>;

/**
 * One exception. It answers "what changed, why it matters, who owns it, and
 * what can I do next" before the user opens the explorer (PRD FR-02).
 */
export const ExceptionSchema = z.strictObject({
  exceptionId: z.string().min(1),
  assignmentId: z.string().min(1),
  entity: ScopeEntitySchema,
  period: PeriodSchema,
  priority: z.enum(['act_now', 'monitor']),
  /** Safety, legal, and compliance exceptions stay visible regardless of weighted performance. */
  category: z.enum(['performance', 'safety', 'legal', 'compliance']),
  /** The brief must distinguish a prior-period comparison from a budget comparison. */
  comparisonBasis: z.enum(['prior_period', 'budget', 'target', 'none']),
  detection: DetectionSchema,
  whatChanged: z.string().min(1),
  whyItMatters: z.string().min(1),
  owner: z.strictObject({ role: RoleIdSchema }),
  actionState: z.union([z.literal('none'), ActionStateSchema]),
  evidence: EvidenceRefSchema,
  provenance: ProvenanceSchema,
  dataQuality: DataQualitySchema,
});
export type Exception = z.infer<typeof ExceptionSchema>;

/** Reassurance item for the "On track" section — not a wall of green cards. */
export const OnTrackItemSchema = z.strictObject({
  assignmentId: z.string().min(1),
  entity: ScopeEntitySchema,
  period: PeriodSchema,
  summary: z.string().min(1),
  evidence: EvidenceRefSchema,
  provenance: ProvenanceSchema,
  dataQuality: DataQualitySchema,
});
export type OnTrackItem = z.infer<typeof OnTrackItemSchema>;

/** A late, unreconciled, unavailable, or illustrative input, disclosed rather than filled in. */
export const DataLimitationSchema = z.strictObject({
  assignmentId: z.string().min(1).nullable(),
  issue: z.enum(['late', 'stale', 'unreconciled', 'unavailable']),
  detail: z.string().min(1),
});
export type DataLimitation = z.infer<typeof DataLimitationSchema>;

/** `GET /api/brief` — sections in the PRD FR-02 order. */
export const BriefResponseSchema = z.strictObject({
  period: PeriodSchema,
  /** Simulated as-of time of the dataset; a daily visit does not imply daily source updates. */
  asOf: z.iso.datetime({ offset: true }),
  actNow: z.array(ExceptionSchema),
  monitor: z.array(ExceptionSchema),
  onTrack: z.array(OnTrackItemSchema),
  dataLimitations: z.array(DataLimitationSchema),
  disclosure: DisclosureSchema,
});
export type BriefResponse = z.infer<typeof BriefResponseSchema>;

/** `GET /api/inbox` — exceptions in server order, with the ordering basis stated. */
export const InboxResponseSchema = z.strictObject({
  items: z.array(ExceptionSchema),
  /** Plain-language statement of how items are ordered (transparent severity, PRD FR-03). */
  orderingBasis: z.string().min(1),
  nextCursor: z.string().min(1).nullable(),
  disclosure: DisclosureSchema,
});
export type InboxResponse = z.infer<typeof InboxResponseSchema>;
