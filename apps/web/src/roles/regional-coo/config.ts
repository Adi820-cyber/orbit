import type { RoleId } from "@orbit/contracts";

export interface RegionalCooViewConfig {
  description: string;
  eyebrow: string;
  roleId: RoleId;
  title: string;
}

export const regionalCooViewConfig: RegionalCooViewConfig = {
  description:
    "Review the decisions that need attention across your authorized regional scope.",
  eyebrow: "Assigned-region operations",
  roleId: "regional-coo",
  title: "Regional COO",
};
