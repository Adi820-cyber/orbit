/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 * Produced by scripts/import-workbook.ts from Africare_Group_KPI_Framework.xlsx.
 * Regenerate with: npm run import -- <path-to-xlsx>
 */

import type { GovernanceRule } from "../types.ts";

export const GOVERNANCE_RULES: readonly GovernanceRule[] = [
  {
    "sourceRow": 5,
    "kpiFamily": "Financial: revenue, EBITDA, cash, collections, DSO",
    "targetSettingApproach": "Translate Board-approved annual budget into monthly facility, regional and group targets. Reconcile to the official Finance close.",
    "targetOwner": "Group CFO",
    "definitionOwner": "Group CFO",
    "reportingCadence": "Weekly for collections; monthly for other measures",
    "escalationReview": "Review variance, drivers, corrective actions and forecast in monthly business review."
  },
  {
    "sourceRow": 6,
    "kpiFamily": "Capacity, volume and referral conversion",
    "targetSettingApproach": "Use approved service-line capacity and volume plans. Define capacity units before targets are distributed.",
    "targetOwner": "Regional COO",
    "definitionOwner": "Regional COO / Clinical Medical Director",
    "reportingCadence": "Weekly / monthly",
    "escalationReview": "Escalate sustained capacity constraints, referral leakage and access issues."
  },
  {
    "sourceRow": 7,
    "kpiFamily": "Clinical quality, safety and protocols",
    "targetSettingApproach": "Set only through approved clinical governance plan and applicable protocols. Use risk adjustment where the approved indicator requires it.",
    "targetOwner": "Clinical Medical Director",
    "definitionOwner": "Clinical Medical Director",
    "reportingCadence": "Monthly / quarterly clinical review",
    "escalationReview": "Escalate serious events and critical audit exceptions under the incident policy."
  },
  {
    "sourceRow": 8,
    "kpiFamily": "Patient experience and complaint closure",
    "targetSettingApproach": "Set annual target using approved survey method and service plan. Define action closure service levels.",
    "targetOwner": "Regional COO",
    "definitionOwner": "Regional COO",
    "reportingCadence": "Monthly",
    "escalationReview": "Review adverse feedback, response rates, overdue actions and evidence of effective closure."
  },
  {
    "sourceRow": 9,
    "kpiFamily": "People, learning and workforce productivity",
    "targetSettingApproach": "Set from approved workforce, productivity, engagement and capability plans, with role-specific definitions.",
    "targetOwner": "HR Head",
    "definitionOwner": "HR Head",
    "reportingCadence": "Monthly / quarterly",
    "escalationReview": "Review critical vacancies, attrition, staffing gaps and overdue capability actions."
  },
  {
    "sourceRow": 10,
    "kpiFamily": "Claims, denials, unbilled revenue and payer issues",
    "targetSettingApproach": "Set from revenue-cycle baseline, payer terms and approved collection plan; segment targets by material payer where needed.",
    "targetOwner": "Group CFO",
    "definitionOwner": "Billing & Revenue Lead",
    "reportingCadence": "Weekly / monthly",
    "escalationReview": "Review payer root causes, aged receivables, unbilled items and recovery action owners."
  },
  {
    "sourceRow": 11,
    "kpiFamily": "COE, corporate and insurer growth",
    "targetSettingApproach": "Set from approved business cases, contract pipeline and contribution expectations. Separate signed contracts from realised revenue.",
    "targetOwner": "Clinical Medical Director",
    "definitionOwner": "Corporate Revenue & Insurance Lead / CoE Lead",
    "reportingCadence": "Monthly",
    "escalationReview": "Review pipeline, contract status, activation, utilisation, clinical readiness and margin."
  },
  {
    "sourceRow": 12,
    "kpiFamily": "Procurement and inventory",
    "targetSettingApproach": "Set from approved savings, inventory and supply-continuity plan. Validate financial benefit before recognition.",
    "targetOwner": "Procurement Head",
    "definitionOwner": "Procurement Head",
    "reportingCadence": "Monthly",
    "escalationReview": "Escalate critical stockouts, supplier risks, obsolete stock and procurement constraints."
  },
  {
    "sourceRow": 13,
    "kpiFamily": "Legal, governance and compliance",
    "targetSettingApproach": "Set as due-date compliance against controlled calendars and risk-rated action registers.",
    "targetOwner": "Legal Head",
    "definitionOwner": "Legal Head",
    "reportingCadence": "Monthly / quarterly",
    "escalationReview": "Escalate critical overdue filings, licences, disputes, legal exposure and audit actions."
  },
  {
    "sourceRow": 14,
    "kpiFamily": "Data, dashboards and digital value",
    "targetSettingApproach": "Set from reporting calendar, data-quality standards, approved analytics roadmap and business cases.",
    "targetOwner": "Head of Analytics & Digital Transformation",
    "definitionOwner": "Head of Analytics & Digital Transformation",
    "reportingCadence": "Monthly",
    "escalationReview": "Do not publish unsupported metrics; disclose data quality, reconciliation status and material limitations."
  }
] as const;
