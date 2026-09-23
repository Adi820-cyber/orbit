import type { FastifyInstance } from 'fastify';
import { AuditEventSchema, AuditListResponseSchema, PageQuerySchema } from '@orbit/contracts';
import { membershipOf } from '../../plugins/auth.ts';
import { ApiError } from '../../plugins/errors.ts';
import type { ModuleDeps } from '../ports.ts';
import { auditRead, parseInput, parseRows } from '../shared.ts';

/** The only audit events a caller may read: those about actions (ADR 0011 §7). */
const ACTION_EVENT_KINDS: ReadonlySet<string> = new Set(['action_created', 'action_transitioned']);

/**
 * Audit trail (PRD FR-07, ARCH §10). Every member reads the events for the
 * actions they created or are assigned, and nothing else (ADR 0011 §7): no
 * per-role toggle, and no one reads denials or Ask outcomes in v1. The store
 * filters by actor and assignee; the route re-checks that every returned event
 * is an action event and fails closed otherwise.
 */
export function registerAuditRoutes(api: FastifyInstance, deps: ModuleDeps): void {
  api.get('/audit', async (request) => {
    const membership = membershipOf(request);
    const page = parseInput(PageQuerySchema, request.query);
    const rows = await deps.audit.list(membership, page);
    const items = parseRows(AuditEventSchema, rows.items, 'audit_row_failed_contract');
    if (items.some((event) => !ACTION_EVENT_KINDS.has(event.kind) || event.target?.type !== 'action')) {
      throw new ApiError('internal', 'An internal error occurred.', 'audit_store_returned_non_action_event');
    }
    return AuditListResponseSchema.parse({ items, nextCursor: rows.nextCursor });
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
