import type { FastifyInstance } from 'fastify';
import { EntityDirectoryEntrySchema, EntityDirectoryResponseSchema, type Grain } from '@orbit/contracts';
import { membershipOf } from '../../plugins/auth.ts';
import { ApiError } from '../../plugins/errors.ts';
import type { ModuleDeps } from '../ports.ts';
import { parseRows } from '../shared.ts';

const GRAIN_ORDER: Record<Grain, number> = { group: 0, region: 1, facility: 2, coe: 3 };

/**
 * Entity names for display (`GET /api/entities`). The source reads under RLS;
 * every entry is re-checked with the scope resolver, and one the caller cannot
 * see fails the request rather than being dropped — the same rule as every
 * other module.
 */
export function registerEntityRoutes(api: FastifyInstance, deps: ModuleDeps): void {
  api.get('/entities', async (request) => {
    const membership = membershipOf(request);
    const entries = parseRows(EntityDirectoryEntrySchema, await deps.entities.visible(membership), 'entity_row_failed_contract');

    const checks = await Promise.all(
      entries.map((entry) => deps.scope.resolver.contains(membership, { grain: entry.grain, entityId: entry.entityId })),
    );
    if (checks.includes(false)) {
      throw new ApiError('internal', 'An internal error occurred.', 'entity_directory_returned_out_of_scope_entity');
    }

    const entities = [...entries].sort(
      (a, b) => GRAIN_ORDER[a.grain] - GRAIN_ORDER[b.grain] || a.label.localeCompare(b.label),
    );
    return EntityDirectoryResponseSchema.parse({ entities });
  });
}
