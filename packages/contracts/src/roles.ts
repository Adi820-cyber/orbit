import { z } from 'zod';

/**
 * The 14 workbook role types (PRD §4).
 *
 * Slugs mirror the `apps/web/src/roles/*` folders and are verified against the
 * generated `@orbit/kpi-framework` role list by `roles.test.ts`, so the two
 * cannot drift. Kept as a literal here so this package stays dependency-light.
 */
export const ROLE_IDS = [
  'chairman',
  'clinical-director',
  'regional-coo',
  'hospital-dho',
  'people-executive',
  'bd-lead',
  'billing-lead',
  'coe-lead',
  'corporate-revenue-lead',
  'group-cfo',
  'procurement-head',
  'hr-head',
  'legal-head',
  'analytics-head',
] as const;

export const RoleIdSchema = z.enum(ROLE_IDS);
export type RoleId = z.infer<typeof RoleIdSchema>;

/**
 * ERP operator roles (ADR 0016). Deliberately NOT workbook roles: they carry no
 * KPI assignments and never appear in `ROLE_IDS`, so the 14-role invariant and
 * every leader entitlement stay exactly as they were.
 *
 * - `admin`: group scope. Maintains staff, doctors, the service catalogue and
 *   settings, and decides attendance corrections, for the whole organization.
 * - `hospital`: facility scope. Registers patients and visits, records services
 *   delivered, rosters and punches staff, and requests corrections, for its own
 *   facility only.
 *
 * Mirrors the `orbit.org_memberships.operator_role` CHECK constraint.
 */
export const OPERATOR_ROLE_IDS = ['admin', 'hospital'] as const;

export const OperatorRoleIdSchema = z.enum(OPERATOR_ROLE_IDS);
export type OperatorRoleId = z.infer<typeof OperatorRoleIdSchema>;
