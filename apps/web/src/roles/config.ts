import type { RoleId } from "@orbit/contracts";

export interface RoleViewConfig {
  description: string;
  eyebrow: string;
  roleId: RoleId;
  title: string;
}

export const roleViewConfigs: Record<"bd-lead" | "billing-lead" | "chairman" | "clinical-director" | "hospital-dho" | "people-executive" | "regional-coo", RoleViewConfig> = {
  "bd-lead": {
    description:
      "Review demand generation, pipeline health, referral channels, handovers, and acquisition economics for your authorized facility.",
    eyebrow: "Hospital functional leadership",
    roleId: "bd-lead",
    title: "Business Development Lead",
  },
  "billing-lead": {
    description:
      "Review billing quality, claims, collections, receivables, reconciliation, and revenue leakage for your authorized facility.",
    eyebrow: "Hospital functional leadership",
    roleId: "billing-lead",
    title: "Billing & Revenue Lead",
  },
  chairman: {
    description:
      "Review the enterprise decisions that need Board-level attention across your authorized group scope.",
    eyebrow: "Group governance",
    roleId: "chairman",
    title: "Chairman",
  },
  "clinical-director": {
    description:
      "Review clinical governance, safety, standardised practice, and capability signals across your authorized group scope.",
    eyebrow: "Group clinical leadership",
    roleId: "clinical-director",
    title: "Clinical Director",
  },
  "hospital-dho": {
    description:
      "Run the day-to-day decisions for your authorized hospital across operations, finance, access, experience, workforce, and readiness.",
    eyebrow: "Hospital leadership",
    roleId: "hospital-dho",
    title: "Hospital DHO",
  },
  "people-executive": {
    description:
      "Review workforce readiness, capability, engagement, employment compliance, and manpower cost for your authorized facility.",
    eyebrow: "Hospital functional leadership",
    roleId: "people-executive",
    title: "People Executive",
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
  return role === "bd-lead" || role === "billing-lead" || role === "chairman" || role === "clinical-director" || role === "hospital-dho" || role === "people-executive" || role === "regional-coo" ? roleViewConfigs[role] : null;
}
