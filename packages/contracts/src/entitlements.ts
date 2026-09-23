import { z } from 'zod';
import { GrainSchema } from './membership.ts';
import { RoleIdSchema } from './roles.ts';

/**
 * One row of the entitlement matrix: may `role` read `assignmentId`, at which
 * grains, with which breakdowns (ARCH §8.2).
 *
 * The matrix is global, keyed per role and per framework version, with no
 * organization column (ADR 0005 §1). Organization isolation comes from the
 * membership claims and RLS, not from this row.
 *
 * DRAFT: the matrix content is owned by Aditya and not yet signed off. Evidence
 * fields, action permissions, and audit access are intentionally absent until
 * that review defines them.
 */
export const EntitlementSchema = z.strictObject({
  role: RoleIdSchema,
  /** `definitionVersion` from the kpi-framework manifest this row belongs to. */
  frameworkVersion: z.string().min(1),
  assignmentId: z.string().min(1),
  grains: z.array(GrainSchema).min(1),
  breakdowns: z.array(GrainSchema),
});
export type Entitlement = z.infer<typeof EntitlementSchema>;
