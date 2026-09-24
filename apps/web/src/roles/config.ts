import type { RoleId } from "@orbit/contracts";
import { getRole } from "@orbit/kpi-framework";

/**
 * The view configuration for a role: what the workspace shell shows in its
 * header. This selects *presentation* only — never data scope, which comes from
 * verified membership (ARCH §5).
 *
 * ── Why this is derived rather than a hand-written list ────────────────────
 *
 * This file previously held a literal registry plus a guard of the form
 *
 *     role === "bd-lead" || role === "billing-lead" || role === "chairman" || ...
 *
 * which had two problems. The smaller one: adding a role to the registry without
 * also editing the guard compiled clean and still returned `null`, so the new
 * role silently got "view unavailable" with its config sitting right there in
 * the file. Verified by doing it — adding `group-cfo` typechecked and still
 * returned null.
 *
 * The larger one: seven of the fourteen roles had no entry at all, and
 * `workspaceLoader` throws `RoleViewUnavailableError` when `roleViewConfigFor`
 * returns null. So `group-cfo`, `coe-lead`, `corporate-revenue-lead`, `hr-head`,
 * `legal-head`, `procurement-head` and `analytics-head` could authenticate
 * successfully, hold correct entitlements in the database, and still be unable
 * to open the product. A hand-maintained list of roles is a list that will be
 * incomplete.
 *
 * So the role set now comes from `@orbit/kpi-framework`, which is generated from
 * the workbook. Every role the framework knows about has a view, automatically.
 * `title` and `eyebrow` default to the workbook's own `name` and `level` — not
 * invented labels — and `COPY` below overrides them where we have better
 * user-facing wording.
 */
export interface RoleViewConfig {
  description: string;
  eyebrow: string;
  roleId: RoleId;
  title: string;
}

type RoleCopy = Omit<RoleViewConfig, "roleId">;

/**
 * Hand-written copy, where it exists.
 *
 * Partial on purpose. A role missing from here still works — it falls back to
 * the workbook — so adding better wording is an improvement rather than a
 * prerequisite for that role being able to log in. Ayas owns this text; the
 * seven entries below are his, kept verbatim, including the two places he
 * deliberately departed from the workbook: `regional-coo`'s eyebrow reads
 * "Assigned-region operations" rather than the workbook's "Regional
 * management", and `clinical-director` is shortened from "Chief / Group Clinical
 * Medical Director".
 */
const COPY: Partial<Record<RoleId, RoleCopy>> = {
  "analytics-head": {
    description:
      "Review dashboard reliability, data quality, reporting cadence, adoption, forecasting support, insight actions, and digital benefits within your authorized group scope.",
    eyebrow: "Group analytics leadership",
    title: "Head of Analytics & Digital Transformation",
  },
  "bd-lead": {
    description:
      "Review demand generation, pipeline health, referral channels, handovers, and acquisition economics for your authorized facility.",
    eyebrow: "Hospital functional leadership",
    title: "Business Development Lead",
  },
  "billing-lead": {
    description:
      "Review billing quality, claims, collections, receivables, reconciliation, and revenue leakage for your authorized facility.",
    eyebrow: "Hospital functional leadership",
    title: "Billing & Revenue Lead",
  },
  chairman: {
    description:
      "Review the enterprise decisions that need Board-level attention across your authorized group scope.",
    eyebrow: "Group governance",
    title: "Chairman",
  },
  "clinical-director": {
    description:
      "Review clinical governance, safety, standardised practice, and capability signals across your authorized group scope.",
    eyebrow: "Group clinical leadership",
    title: "Clinical Director",
  },
  "coe-lead": {
    description:
      "Review COE financial contribution, capacity, referrals, outcomes, milestones, and capability within your authorized centre-of-excellence scope.",
    eyebrow: "Clinical growth",
    title: "COE Lead",
  },
  "corporate-revenue-lead": {
    description:
      "Review corporate and insurer revenue, account activation, renewals, commercial terms, payer issues, and forecast quality across your authorized group scope.",
    eyebrow: "Commercial growth",
    title: "Corporate Revenue & Insurance Lead",
  },
  "group-cfo": {
    description:
      "Review group profitability, liquidity, cash conversion, planning quality, cost improvement, controls, and finance compliance within your authorized group scope.",
    eyebrow: "Group finance leadership",
    title: "Group CFO",
  },
  "hr-head": {
    description:
      "Review group workforce cost, critical staffing, retention, engagement, capability, talent reviews, and employment compliance within your authorized group scope.",
    eyebrow: "Group people leadership",
    title: "HR Head",
  },
  "legal-head": {
    description:
      "Review contract service levels, regulatory compliance, litigation milestones, commercial disputes, policy governance, and legal action closure within your authorized group scope.",
    eyebrow: "Group legal leadership",
    title: "Legal Head",
  },
  "procurement-head": {
    description:
      "Review procurement savings, buying compliance, inventory continuity, supplier performance, purchasing responsiveness, and supply risk across your authorized group scope.",
    eyebrow: "Group supply leadership",
    title: "Procurement Head",
  },
  "hospital-dho": {
    description:
      "Run the day-to-day decisions for your authorized hospital across operations, finance, access, experience, workforce, and readiness.",
    eyebrow: "Hospital leadership",
    title: "Hospital DHO",
  },
  "people-executive": {
    description:
      "Review workforce readiness, capability, engagement, employment compliance, and manpower cost for your authorized facility.",
    eyebrow: "Hospital functional leadership",
    title: "People Executive",
  },
  "regional-coo": {
    description:
      "Review the decisions that need attention across your authorized regional scope.",
    eyebrow: "Assigned-region operations",
    title: "Regional COO",
  },
};

/**
 * Fallback description for a role with no hand-written copy.
 *
 * Built from the workbook's own `primaryFocus` text rather than composed from
 * nothing, so it describes what the workbook says the role is accountable for
 * and claims nothing beyond it. Deliberately generic about scope — "your
 * authorized scope" — because the grain differs per role and the real entities
 * come from membership, not from this file.
 *
 * This is placeholder wording, not a design. Replacing it with copy in `COPY`
 * is an improvement worth making; leaving it does not lock anyone out.
 */
function describeFromFramework(primaryFocus: string): string {
  const focus = primaryFocus.trim().replace(/\.$/, "");
  return `Review the decisions that need attention across your authorized scope: ${
    focus.charAt(0).toLowerCase() + focus.slice(1)
  }.`;
}

/**
 * The view configuration for `role`, or `null` if the framework does not define
 * it.
 *
 * Returns a config for every role in the workbook. `null` means "not a role
 * this framework version knows about", which is a genuine fail-closed case —
 * not "we have not written the copy yet".
 */
export function roleViewConfigFor(role: RoleId): RoleViewConfig | null {
  const definition = getRole(role);
  if (!definition) {
    return null;
  }
  const copy = COPY[role];
  return {
    roleId: role,
    title: copy?.title ?? definition.name,
    eyebrow: copy?.eyebrow ?? definition.level,
    description: copy?.description ?? describeFromFramework(definition.primaryFocus),
  };
}
