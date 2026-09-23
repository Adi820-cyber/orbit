/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 * Produced by scripts/import-workbook.ts from Africare_Group_KPI_Framework.xlsx.
 * Regenerate with: npm run import -- <path-to-xlsx>
 */

import type { EnterpriseOutcome } from "../types.ts";

export const ENTERPRISE_OUTCOMES: readonly EnterpriseOutcome[] = [
  {
    "sourceRow": 5,
    "outcome": "Sustainable growth",
    "cmoAccountability": "Group net revenue vs approved budget",
    "primaryContributionOwners": "Regional COOs; Group CFO; DHOs; Corporate Revenue & Insurance Lead",
    "targetBasis": "Board-approved annual and monthly budget",
    "review": "Monthly",
    "dataSource": "Finance ERP / management accounts"
  },
  {
    "sourceRow": 6,
    "outcome": "Profitability",
    "cmoAccountability": "Group EBITDA vs approved budget",
    "primaryContributionOwners": "Group CFO; Regional COOs; Procurement Head; DHOs",
    "targetBasis": "Board-approved EBITDA plan",
    "review": "Monthly",
    "dataSource": "Finance ERP / management accounts"
  },
  {
    "sourceRow": 7,
    "outcome": "Cash conversion",
    "cmoAccountability": "Operating cash flow, collections and working capital vs plan",
    "primaryContributionOwners": "Group CFO; Billing & Revenue Leads; Regional COOs",
    "targetBasis": "Board-approved cash and collections plan",
    "review": "Monthly",
    "dataSource": "Treasury / finance ERP / billing"
  },
  {
    "sourceRow": 8,
    "outcome": "Clinical excellence",
    "cmoAccountability": "Group clinical quality and safety index",
    "primaryContributionOwners": "Chief / Group Clinical Medical Director; CoE Leads; Regional COOs",
    "targetBasis": "Board-approved clinical-quality plan",
    "review": "Monthly / quarterly clinical review",
    "dataSource": "Quality system / HIS / audit"
  },
  {
    "sourceRow": 9,
    "outcome": "Patient-centred care",
    "cmoAccountability": "Group patient experience index",
    "primaryContributionOwners": "Regional COOs; DHOs; Clinical Medical Director",
    "targetBasis": "Annual patient-experience plan",
    "review": "Monthly",
    "dataSource": "Feedback platform / complaint register"
  },
  {
    "sourceRow": 10,
    "outcome": "Strategic growth",
    "cmoAccountability": "COE, corporate and expansion milestones",
    "primaryContributionOwners": "Clinical Medical Director; CoE Leads; Corporate Revenue & Insurance Lead",
    "targetBasis": "Board-approved strategic plan",
    "review": "Monthly",
    "dataSource": "Strategy tracker / CRM / finance"
  },
  {
    "sourceRow": 11,
    "outcome": "People strength",
    "cmoAccountability": "Engagement, critical-role retention and capability",
    "primaryContributionOwners": "HR Head; People Executives; Regional COOs",
    "targetBasis": "Approved people and capability plan",
    "review": "Monthly / quarterly",
    "dataSource": "HRIS / engagement survey / LMS"
  },
  {
    "sourceRow": 12,
    "outcome": "Governance and resilience",
    "cmoAccountability": "Critical governance, legal, audit and data actions closed",
    "primaryContributionOwners": "Legal Head; Group CFO; Analytics Head; Procurement Head",
    "targetBasis": "Board governance calendar",
    "review": "Monthly / quarterly",
    "dataSource": "Governance, audit and compliance trackers"
  }
] as const;
