import { z } from 'zod';
import { DisclosureSchema, ObservationSchema } from './common.ts';
import { GrainSchema, ScopeEntitySchema } from './membership.ts';
import { RoleIdSchema } from './roles.ts';

/*
 * KPI explorer payloads (PRD FR-04). DRAFT for Gate 1.
 * Assignment metadata is copied from `@orbit/kpi-framework`; the API is the
 * one that decides which assignments a caller may see.
 */

/** One authorized role-KPI assignment, with the grains/breakdowns the caller holds. */
export const KpiAssignmentSummarySchema = z.strictObject({
  assignmentId: z.string().min(1),
  roleId: RoleIdSchema,
  kpi: z.string().min(1),
  keyDeliverable: z.string().min(1),
  /** Workbook weight as a fraction (0–1). A source weight, not a score. */
  weight: z.number().min(0).max(1),
  definitionFamilies: z.array(z.string().min(1)),
  /** True when the framework could not map this assignment; the UI must flag it (PRD §9.1). */
  unresolved: z.boolean(),
  targetBasis: z.string(),
  review: z.string(),
  primaryDataSource: z.string(),
  grains: z.array(GrainSchema).min(1),
  breakdowns: z.array(GrainSchema),
});
export type KpiAssignmentSummary = z.infer<typeof KpiAssignmentSummarySchema>;

/** `GET /api/kpi` — every assignment the caller's role is entitled to. */
export const KpiListResponseSchema = z.strictObject({
  frameworkVersion: z.string().min(1),
  assignments: z.array(KpiAssignmentSummarySchema),
  disclosure: DisclosureSchema,
});
export type KpiListResponse = z.infer<typeof KpiListResponseSchema>;

/**
 * `GET /api/kpi/:assignmentId` query. `grain` + `entityId` name the entity;
 * `breakdown` requests a permitted split. The server checks all of them
 * against the entitlement matrix and answers `out_of_scope` otherwise.
 */
export const KpiDetailQuerySchema = z
  .strictObject({
    grain: GrainSchema,
    entityId: z.string().min(1),
    breakdown: GrainSchema.optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: 'from must not be after to',
  });
export type KpiDetailQuery = z.infer<typeof KpiDetailQuerySchema>;

/** Definition text shown beside a KPI (PRD FR-04: definition and component measures). */
export const DefinitionBasisSchema = z.strictObject({
  family: z.string().min(1),
  standardDefinition: z.string(),
  numeratorDenominatorControl: z.string(),
});
export type DefinitionBasis = z.infer<typeof DefinitionBasisSchema>;

/** `GET /api/kpi/:assignmentId` — trend for one entity, and an optional permitted breakdown. */
export const KpiDetailResponseSchema = z.strictObject({
  assignment: KpiAssignmentSummarySchema,
  definitions: z.array(DefinitionBasisSchema),
  scope: ScopeEntitySchema,
  series: z.array(ObservationSchema),
  breakdown: z
    .strictObject({
      grain: GrainSchema,
      observations: z.array(ObservationSchema),
    })
    .nullable(),
  disclosure: DisclosureSchema,
});
export type KpiDetailResponse = z.infer<typeof KpiDetailResponseSchema>;
