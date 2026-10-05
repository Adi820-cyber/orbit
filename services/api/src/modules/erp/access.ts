import type { z } from 'zod';
import { ERP_DISCLOSURE, type OperatorClaims } from '@orbit/contracts';
import { ApiError } from '../../plugins/errors.ts';
import { parseRow } from '../shared.ts';
import type { ErpStore, ErpWrite } from './ports.ts';

/*
 * Authorization helpers for the ERP routes (ADR 0016 §3). The database
 * enforces the same rules again through RLS; these give the caller an explicit,
 * typed answer instead of an empty result.
 */

/** The facilities a hospital operator is scoped to (an admin has group scope instead). */
function scopedFacilities(operator: OperatorClaims): string[] {
  return operator.scopes.filter((scope) => scope.grain === 'facility').map((scope) => scope.entityId);
}

export function isAdmin(operator: OperatorClaims): boolean {
  return operator.operatorRole === 'admin' && operator.scopes.some((scope) => scope.grain === 'group');
}

/** Admin-only operations: maintaining people, the catalogue, and deciding corrections. */
export function requireAdmin(operator: OperatorClaims): void {
  if (!isAdmin(operator)) {
    throw new ApiError('forbidden', 'Only an admin account can make this change.', 'erp_admin_required');
  }
}

/**
 * The facility a request is about. A hospital operator defaults to its own
 * facility and is refused, explicitly, for any other. An admin must name one,
 * and it must exist in the admin's organization.
 */
export async function resolveFacility(store: ErpStore, operator: OperatorClaims, requested: string | undefined): Promise<string> {
  if (operator.operatorRole === 'hospital') {
    const own = scopedFacilities(operator);
    if (requested === undefined) {
      const [only] = own;
      if (own.length === 1 && only) return only;
      throw new ApiError('invalid_request', 'Choose a facility.', 'facility_required');
    }
    if (!own.includes(requested)) {
      throw new ApiError('out_of_scope', 'That facility is outside your authorized scope.', 'erp_facility_out_of_scope');
    }
    return requested;
  }
  if (requested === undefined) {
    throw new ApiError('invalid_request', 'Choose a facility.', 'facility_required');
  }
  if (!(await store.facility(operator, requested))) {
    throw new ApiError('not_found', 'That facility was not found.', 'erp_facility_not_found');
  }
  return requested;
}

/** Narrows an optional filter: unset stays unset, a named facility must be in scope. */
export async function facilityFilter(store: ErpStore, operator: OperatorClaims, requested: string | undefined) {
  return requested === undefined ? undefined : resolveFacility(store, operator, requested);
}

export function found<T>(row: T | null | undefined, what: string): T {
  if (row === null || row === undefined) {
    throw new ApiError('not_found', `${what} was not found.`, 'erp_not_found_or_not_visible');
  }
  return row;
}

export function written(result: ErpWrite, what: string): unknown {
  if (result.status === 'not_found') {
    throw new ApiError('not_found', `${what} was not found.`, 'erp_not_found_or_not_visible');
  }
  if (result.status === 'stale') {
    throw new ApiError('conflict', 'This record changed since you opened it. Reload and try again.', 'stale_version');
  }
  return result.row;
}

/** Adds the illustrative provenance and disclosure, then parses the response: a mismatch is our defect. */
export function respond<S extends z.ZodType>(schema: S, body: Record<string, unknown>, reason: string): z.infer<S> {
  return parseRow(schema, { ...body, provenance: 'illustrative', disclosure: ERP_DISCLOSURE }, reason);
}

/** First and last day of a `YYYY-MM` month. */
export function monthRange(month: string): { from: string; to: string } {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** Request times may not be in the future (small allowance for clock skew). */
export function assertNotFuture(instant: string | undefined, what: string): void {
  if (instant !== undefined && Date.parse(instant) > Date.now() + 5 * 60_000) {
    throw new ApiError('invalid_request', `${what} cannot be in the future.`, 'erp_time_in_future');
  }
}
