import { z } from 'zod';

/**
 * The 14 workbook role types (PRD §4).
 *
 * DRAFT: slugs mirror the `apps/web/src/roles/*` folders from the Gate 0
 * scaffold. Once `packages/kpi-framework` is generated from the workbook,
 * this list must be derived from (or verified against) that package.
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
