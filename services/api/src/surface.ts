/**
 * Which half of Orbit a deployment serves (ADR 0016 §9).
 *
 * - `all`:    both. The default, and what a single combined deployment runs.
 * - `leader`: the 14 leadership roles only. `/api/erp/*` is not registered
 *             (404) and an ERP operator account is refused.
 * - `erp`:    hospital operations only. The leader routes are not registered
 *             (404) and a leadership account is refused.
 *
 * Running the two as separate deployments gives each its own URL, environment
 * variables, CORS allow-list and request logs, and means a deployment cannot
 * serve a kind of data it was not set up for.
 */
export const API_SURFACES = ['all', 'leader', 'erp'] as const;
export type ApiSurface = (typeof API_SURFACES)[number];

export const servesLeaders = (surface: ApiSurface): boolean => surface !== 'erp';
export const servesOperators = (surface: ApiSurface): boolean => surface !== 'leader';
