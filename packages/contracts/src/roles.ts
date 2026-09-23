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
