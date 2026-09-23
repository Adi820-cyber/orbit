import type { FastifyInstance } from 'fastify';
import { ExceptionSchema, InboxResponseSchema, PageQuerySchema } from '@orbit/contracts';
import { membershipOf } from '../../plugins/auth.ts';
import type { ModuleDeps } from '../ports.ts';
import { assertRowsInScope, parseInput, parseRows } from '../shared.ts';

/**
 * Priority inbox (PRD FR-03). The source owns the ordering and states its
 * basis; the API returns that basis verbatim so the order is transparent.
 */
export function registerInboxRoutes(api: FastifyInstance, deps: ModuleDeps): void {
  api.get('/inbox', async (request) => {
    const membership = membershipOf(request);
    const page = parseInput(PageQuerySchema, request.query);
    const rows = await deps.exceptions.inbox(membership, page);

    const items = parseRows(ExceptionSchema, rows.items, 'exception_row_failed_contract');
    await assertRowsInScope(membership, items, deps);

    return InboxResponseSchema.parse({
      items,
      orderingBasis: rows.orderingBasis,
      nextCursor: rows.nextCursor,
      disclosure: deps.disclosure,
    });
  });
}
