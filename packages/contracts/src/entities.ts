import { z } from 'zod';
import { GrainSchema, ScopeEntitySchema } from './membership.ts';

/*
 * Entity display names (DRAFT for Ayas's review). Every other payload names an
 * entity only by `ScopeEntity` ids, so the UI had no way to show "North" or a
 * hospital's name. This is additive: no existing shape changes, and the UI can
 * adopt it when ready. Names are fictional (Maruti's company manifest).
 */

/** One entity the caller can see, with its name and the entity one level up. */
export const EntityDirectoryEntrySchema = z.strictObject({
  grain: GrainSchema,
  entityId: z.string().min(1),
  label: z.string().min(1),
  /** The parent entity (a facility's region, a region's organization), or null for the organization itself. */
  parent: ScopeEntitySchema.nullable(),
});
export type EntityDirectoryEntry = z.infer<typeof EntityDirectoryEntrySchema>;

/**
 * `GET /api/entities` — every organizational entity visible to the caller
 * under RLS, and nothing else. Grain order: group, region, facility, coe.
 */
export const EntityDirectoryResponseSchema = z.strictObject({
  entities: z.array(EntityDirectoryEntrySchema),
});
export type EntityDirectoryResponse = z.infer<typeof EntityDirectoryResponseSchema>;
