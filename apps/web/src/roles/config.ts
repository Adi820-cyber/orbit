import type { RoleId } from "@orbit/contracts";

export interface RoleViewConfig {
  description: string;
  eyebrow: string;
  roleId: RoleId;
  title: string;
}

export const roleViewConfigs: Record<"chairman" | "regional-coo", RoleViewConfig> = {
  chairman: {
    description:
      "Review the enterprise decisions that need Board-level attention across your authorized group scope.",
    eyebrow: "Group governance",
    roleId: "chairman",
    title: "Chairman",
  },
  "regional-coo": {
    description:
      "Review the decisions that need attention across your authorized regional scope.",
    eyebrow: "Assigned-region operations",
    roleId: "regional-coo",
    title: "Regional COO",
  },
};

export function roleViewConfigFor(role: RoleId): RoleViewConfig | null {
  return role === "chairman" || role === "regional-coo" ? roleViewConfigs[role] : null;
}
