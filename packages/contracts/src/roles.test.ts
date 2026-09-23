import { describe, expect, it } from 'vitest';
import { FRAMEWORK_MANIFEST, ROLE_IDS as FRAMEWORK_ROLE_IDS, ROLE_KPI_ASSIGNMENTS } from '@orbit/kpi-framework';
import { ROLE_IDS, RoleIdSchema } from './roles.ts';

describe('roles against the generated kpi-framework', () => {
  it('lists exactly the 14 workbook role slugs, in the same order', () => {
    expect([...ROLE_IDS]).toEqual([...FRAMEWORK_ROLE_IDS]);
    expect(ROLE_IDS).toHaveLength(FRAMEWORK_MANIFEST.roleCount);
  });

  it('accepts the role of every one of the 109 assignments', () => {
    expect(ROLE_KPI_ASSIGNMENTS).toHaveLength(FRAMEWORK_MANIFEST.assignmentCount);
    for (const assignment of ROLE_KPI_ASSIGNMENTS) {
      expect(RoleIdSchema.safeParse(assignment.roleId).success).toBe(true);
    }
  });
});
