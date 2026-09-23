import { z } from 'zod';
import { GrainSchema } from './membership.ts';
import { RoleIdSchema } from './roles.ts';

/**
 * One row of the entitlement matrix: may `role` read `assignmentId`, at which
 * grains, with which breakdowns (ARCH §8.2).
 *
 * DRAFT: the matrix itself is owned by Aditya and not yet signed off. Evidence
 * fields, action permissions, and audit access are intentionally absent until
 * that review defines them.
 */
export const EntitlementSchema = z.strictObject({
  role: RoleIdSchema,
  assignmentId: z.string().min(1),
  grains: z.array(GrainSchema).min(1),
  breakdowns: z.array(GrainSchema),
});
export type Entitlement = z.infer<typeof EntitlementSchema>;
