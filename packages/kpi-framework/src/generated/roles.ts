/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 * Produced by scripts/import-workbook.ts from Africare_Group_KPI_Framework.xlsx.
 * Regenerate with: npm run import -- <path-to-xlsx>
 */

import type { RoleDefinition } from "../types.ts";

export const ROLES: readonly RoleDefinition[] = [
  {
    "name": "Chairman",
    "level": "Group governance",
    "deployment": "1 group role",
    "reportsTo": "Board / shareholders",
    "primaryFocus": "Enterprise value, risk and strategic direction",
    "kpiCount": 7,
    "cadence": "Monthly / quarterly"
  },
  {
    "name": "Chief / Group Clinical Medical Director",
    "level": "Group clinical leadership",
    "deployment": "1 group role",
    "reportsTo": "Chairman",
    "primaryFocus": "Clinical governance, COEs, corporate clinical propositions",
    "kpiCount": 8,
    "cadence": "Monthly / quarterly clinical review"
  },
  {
    "name": "Regional COO",
    "level": "Regional management",
    "deployment": "2 roles; 3 hospitals each",
    "reportsTo": "Chairman",
    "primaryFocus": "Regional P&L, operations, patient experience and growth",
    "kpiCount": 9,
    "cadence": "Monthly"
  },
  {
    "name": "Hospital DHO",
    "level": "Hospital leadership",
    "deployment": "6 roles; one per hospital",
    "reportsTo": "Regional COO",
    "primaryFocus": "Hospital P&L, operations, people and revenue cycle",
    "kpiCount": 9,
    "cadence": "Monthly"
  },
  {
    "name": "People Executive",
    "level": "Hospital functional leadership",
    "deployment": "6 roles; one per hospital",
    "reportsTo": "Hospital DHO",
    "primaryFocus": "Workforce readiness, engagement, compliance and productivity",
    "kpiCount": 8,
    "cadence": "Monthly"
  },
  {
    "name": "Business Development Lead",
    "level": "Hospital functional leadership",
    "deployment": "6 roles; one per hospital",
    "reportsTo": "Hospital DHO",
    "primaryFocus": "Demand, referrals, service-line and channel growth",
    "kpiCount": 8,
    "cadence": "Weekly / monthly"
  },
  {
    "name": "Billing & Revenue Lead",
    "level": "Hospital functional leadership",
    "deployment": "6 roles; one per hospital",
    "reportsTo": "Hospital DHO",
    "primaryFocus": "Billing quality, claims, collections and receivables",
    "kpiCount": 8,
    "cadence": "Weekly / monthly"
  },
  {
    "name": "COE Lead",
    "level": "Clinical growth",
    "deployment": "As approved by COE plan",
    "reportsTo": "Clinical Medical Director",
    "primaryFocus": "COE care, outcomes, capacity and contribution",
    "kpiCount": 8,
    "cadence": "Monthly"
  },
  {
    "name": "Corporate Revenue & Insurance Lead",
    "level": "Commercial growth",
    "deployment": "1 group role",
    "reportsTo": "Clinical Medical Director",
    "primaryFocus": "Corporate and insurer contracts, activation and yield",
    "kpiCount": 8,
    "cadence": "Monthly"
  },
  {
    "name": "Group CFO",
    "level": "Group support",
    "deployment": "1 group role",
    "reportsTo": "Chairman",
    "primaryFocus": "Profitability, cash, planning, controls and compliance",
    "kpiCount": 7,
    "cadence": "Monthly"
  },
  {
    "name": "Procurement Head",
    "level": "Group support",
    "deployment": "1 group role",
    "reportsTo": "Chairman",
    "primaryFocus": "Cost, supply continuity, inventory and vendor performance",
    "kpiCount": 8,
    "cadence": "Monthly"
  },
  {
    "name": "HR Head",
    "level": "Group support",
    "deployment": "1 group role",
    "reportsTo": "Chairman",
    "primaryFocus": "Workforce economics, talent, engagement and employment governance",
    "kpiCount": 7,
    "cadence": "Monthly / quarterly"
  },
  {
    "name": "Legal Head",
    "level": "Group support",
    "deployment": "1 group role",
    "reportsTo": "Chairman",
    "primaryFocus": "Contract enablement, legal risk and compliance",
    "kpiCount": 7,
    "cadence": "Monthly / quarterly"
  },
  {
    "name": "Head of Analytics & Digital Transformation",
    "level": "Group support",
    "deployment": "1 group role",
    "reportsTo": "Chairman",
    "primaryFocus": "Trusted data, performance insight and digital value",
    "kpiCount": 7,
    "cadence": "Monthly"
  }
] as const;
