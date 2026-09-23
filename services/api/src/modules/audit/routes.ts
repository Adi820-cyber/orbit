import type { FastifyInstance } from 'fastify';
import { AuditEventSchema, AuditListResponseSchema, PageQuerySchema } from '@orbit/contracts';
import { membershipOf } from '../../plugins/auth.ts';
import { ApiError } from '../../plugins/errors.ts';
import type { ModuleDeps } from '../ports.ts';
import { auditRead, parseInput, parseRows } from '../shared.ts';

/**
 * Audit trail (PRD FR-07, ARCH §10). Reading it needs explicit permission;
 * which roles hold it is an open matrix column, so the policy is a port.
 */
export function registerAuditRoutes(api: FastifyInstance, deps: ModuleDeps): void {
  api.get('/audit', async (request) => {
    const membership = membershipOf(request);
    if (!(await deps.auditAccess.mayRead(membership.role))) {
      throw new ApiError('out_of_scope', 'The requested data is outside your authorized scope.', 'audit_access_not_granted');
    }
    const page = parseInput(PageQuerySchema, request.query);
    const rows = await deps.audit.list(membership, page);
    return AuditListResponseSchema.parse({
      items: parseRows(AuditEventSchema, rows.items, 'audit_row_failed_contract'),
      nextCursor: rows.nextCursor,
    });
  });
}

/**
 * Records authorization denials for members (PRD FR-07). Requests denied
 * before a membership is resolved have no role to attribute and are only
 * logged, so an anonymous caller cannot write to the audit table.
 */
export function recordDenials(api: FastifyInstance, deps: ModuleDeps): void {
  api.addHook('onError', async (request, _reply, error) => {
    if (!(error instanceof ApiError) || (error.code !== 'out_of_scope' && error.code !== 'forbidden')) {
      return;
    }
    const membership = request.membership;
    if (!membership) {
      return;
    }
    await auditRead(deps, request, membership, {
      kind: 'access_denied',
      target: { type: 'route', id: request.routeOptions.url ?? 'unknown' },
      outcome: error.code,
    });
  });
}
