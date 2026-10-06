import type { FastifyInstance } from 'fastify';
import type { ModuleDeps } from '../ports.ts';
import { registerErpAttendanceRoutes } from './attendance-routes.ts';
import { registerErpBillingRoutes } from './billing-routes.ts';
import { registerErpCareRoutes } from './care-routes.ts';
import { registerErpPeopleRoutes } from './people-routes.ts';

/**
 * Hospital operations (ADR 0016), under `/api/erp/*`. Every handler starts with
 * `operatorOf(request)`, so a leader account is refused with `forbidden` and
 * only `admin` and `hospital` operator accounts are served.
 */
export function registerErpModule(api: FastifyInstance, deps: ModuleDeps): void {
  registerErpPeopleRoutes(api, deps);
  registerErpAttendanceRoutes(api, deps);
  registerErpCareRoutes(api, deps);
  registerErpBillingRoutes(api, deps);
}
