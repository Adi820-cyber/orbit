/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 * Produced by scripts/import-workbook.ts from Africare_Group_KPI_Framework.xlsx.
 * Regenerate with: npm run import -- <path-to-xlsx>
 */

import type { KpiDefinitionFamily } from "../types.ts";

export const KPI_DEFINITIONS: readonly KpiDefinitionFamily[] = [
  {
    "sourceRow": 6,
    "family": "Net revenue",
    "standardDefinition": "Finance-approved gross billable revenue less approved discounts, contractual adjustments and other finance-defined deductions.",
    "numeratorDenominatorControl": "Use the same approved accounting definition at hospital, regional and group levels.",
    "targetSteward": "Group CFO",
    "primarySource": "Finance ERP / management accounts",
    "notes": "Do not mix gross billings with net revenue."
  },
  {
    "sourceRow": 7,
    "family": "EBITDA",
    "standardDefinition": "Finance-approved earnings before interest, tax, depreciation and amortisation under the group chart of accounts.",
    "numeratorDenominatorControl": "Reconcile hospital and regional views to the Group CFO's official close.",
    "targetSteward": "Group CFO",
    "primarySource": "Finance ERP / management accounts",
    "notes": "Exclude unapproved management adjustments."
  },
  {
    "sourceRow": 8,
    "family": "Operating cash flow",
    "standardDefinition": "Cash generated from operating activities measured against the approved cash plan.",
    "numeratorDenominatorControl": "Use Finance-approved classification and reconcile to treasury.",
    "targetSteward": "Group CFO",
    "primarySource": "Treasury / finance ERP",
    "notes": "Report liquidity headroom separately."
  },
  {
    "sourceRow": 9,
    "family": "Collections",
    "standardDefinition": "Cash posted and reconciled during the period compared with approved collection plan.",
    "numeratorDenominatorControl": "Include only reconciled cash. Separate recoveries, advances and unidentified cash where material.",
    "targetSteward": "Group CFO",
    "primarySource": "Billing system / finance ERP",
    "notes": "Track by payer and facility."
  },
  {
    "sourceRow": 10,
    "family": "DSO",
    "standardDefinition": "Closing trade receivables divided by trailing net revenue, multiplied by the group-approved day convention.",
    "numeratorDenominatorControl": "Use one group DSO formula and exclude non-trade balances consistently.",
    "targetSteward": "Group CFO",
    "primarySource": "Finance ERP",
    "notes": "Always show ageing alongside DSO."
  },
  {
    "sourceRow": 11,
    "family": "Capacity utilisation",
    "standardDefinition": "Used approved capacity divided by available approved capacity for the same service line and period.",
    "numeratorDenominatorControl": "Use staffed bed days, appointment slots, equipment hours or other approved service-specific capacity. Do not combine unlike units.",
    "targetSteward": "Regional COO",
    "primarySource": "HIS / scheduling / equipment log",
    "notes": "State capacity unit in every report."
  },
  {
    "sourceRow": 12,
    "family": "Patient throughput",
    "standardDefinition": "Completed patient activity measured using the approved encounter, admission, procedure or visit definition.",
    "numeratorDenominatorControl": "Count each activity once according to the defined reporting unit.",
    "targetSteward": "Regional COO",
    "primarySource": "HIS",
    "notes": "Separate hospitals, clinics and service lines when definitions differ."
  },
  {
    "sourceRow": 13,
    "family": "Referral conversion",
    "standardDefinition": "Eligible referrals completing the intended next consultation, admission or procedure divided by eligible referrals.",
    "numeratorDenominatorControl": "Define eligible referrals and completion event before reporting.",
    "targetSteward": "Clinical Medical Director",
    "primarySource": "HIS / referral tracker",
    "notes": "Report internal and external referral sources separately."
  },
  {
    "sourceRow": 14,
    "family": "Patient experience",
    "standardDefinition": "Approved survey composite, reported with response rate and complaint context.",
    "numeratorDenominatorControl": "Use the approved survey population, scoring scale and response-rate threshold.",
    "targetSteward": "Regional COO",
    "primarySource": "Patient feedback platform",
    "notes": "Do not compare surveys with changed methods without disclosure."
  },
  {
    "sourceRow": 15,
    "family": "Complaint CAPA closure",
    "standardDefinition": "Complaints or adverse feedback corrective actions closed by due date divided by actions due.",
    "numeratorDenominatorControl": "Critical complaints remain separately visible until resolved.",
    "targetSteward": "Hospital DHO",
    "primarySource": "Complaint register / quality tracker",
    "notes": "Closure must include effectiveness verification where required."
  },
  {
    "sourceRow": 16,
    "family": "Clinical quality scorecard",
    "standardDefinition": "Approved clinical quality composite using documented indicators, reporting period, case mix and exception rules.",
    "numeratorDenominatorControl": "Maintain definitions and denominators in the clinical governance policy.",
    "targetSteward": "Clinical Medical Director",
    "primarySource": "Quality system / HIS / clinical audit",
    "notes": "No universal clinical threshold is assumed here."
  },
  {
    "sourceRow": 17,
    "family": "Serious adverse events",
    "standardDefinition": "Serious events rate and required review / corrective-action completion under the approved incident policy.",
    "numeratorDenominatorControl": "Use the approved event taxonomy, exposure denominator and risk adjustment where applicable.",
    "targetSteward": "Clinical Medical Director",
    "primarySource": "Incident reporting system",
    "notes": "Never use raw counts alone for comparison."
  },
  {
    "sourceRow": 18,
    "family": "Protocol compliance",
    "standardDefinition": "Compliant audited cases divided by audited cases under the approved protocol and audit plan.",
    "numeratorDenominatorControl": "Retain sample, eligibility and audit method; show critical findings separately.",
    "targetSteward": "Clinical Medical Director",
    "primarySource": "Clinical audit system",
    "notes": "Use service-line-specific standards."
  },
  {
    "sourceRow": 19,
    "family": "First-pass claim acceptance",
    "standardDefinition": "Claims accepted without rework or resubmission divided by claims submitted.",
    "numeratorDenominatorControl": "Use payer acceptance status captured in the billing or payer system.",
    "targetSteward": "Billing & Revenue Lead",
    "primarySource": "Billing system / payer portals",
    "notes": "Segment by payer and rejection reason."
  },
  {
    "sourceRow": 20,
    "family": "Denied or rejected claim value",
    "standardDefinition": "Denied or rejected claim value divided by submitted claim value.",
    "numeratorDenominatorControl": "Use the approved payer status and distinguish temporary rejection from final denial.",
    "targetSteward": "Billing & Revenue Lead",
    "primarySource": "Billing system / payer portals",
    "notes": "Show root cause and recovery status."
  },
  {
    "sourceRow": 21,
    "family": "Unbilled revenue",
    "standardDefinition": "Completed services recorded in source systems but not invoiced or claimed, valued under the group-approved method.",
    "numeratorDenominatorControl": "Define completion and billing cut-off consistently.",
    "targetSteward": "Billing & Revenue Lead",
    "primarySource": "HIS / billing system / finance ERP",
    "notes": "Report by age and accountable resolver."
  },
  {
    "sourceRow": 22,
    "family": "Engagement",
    "standardDefinition": "Approved employee-engagement score and action-plan closure.",
    "numeratorDenominatorControl": "Use defined survey population, response rate and scoring approach.",
    "targetSteward": "HR Head",
    "primarySource": "Engagement survey / HR tracker",
    "notes": "Compare only like survey methods."
  },
  {
    "sourceRow": 23,
    "family": "Critical-role attrition",
    "standardDefinition": "Voluntary and total exits in designated critical roles divided by average headcount in those roles.",
    "numeratorDenominatorControl": "Maintain an approved critical-role list and use average headcount consistently.",
    "targetSteward": "HR Head",
    "primarySource": "HRIS",
    "notes": "Show regretted attrition separately if defined."
  },
  {
    "sourceRow": 24,
    "family": "Mandatory learning / credentialing",
    "standardDefinition": "Required staff completing mandatory learning or holding current credentials divided by required staff.",
    "numeratorDenominatorControl": "Use approved requirements by role and current roster.",
    "targetSteward": "HR Head / Clinical Medical Director",
    "primarySource": "LMS / HRIS / medical affairs",
    "notes": "Expired credentials require exception reporting."
  },
  {
    "sourceRow": 25,
    "family": "Workforce productivity",
    "standardDefinition": "Approved output measure divided by paid FTE or paid hours, by function.",
    "numeratorDenominatorControl": "Use function-specific output units and comparable roster / paid-hour definitions.",
    "targetSteward": "HR Head",
    "primarySource": "HRIS / HIS / roster",
    "notes": "Do not compare clinical and non-clinical functions using one unit."
  },
  {
    "sourceRow": 26,
    "family": "New business revenue",
    "standardDefinition": "Finance-approved net revenue attributable to an approved new channel, service, campaign or account.",
    "numeratorDenominatorControl": "Apply documented CRM attribution and finance reconciliation.",
    "targetSteward": "Business Development Lead",
    "primarySource": "CRM / HIS / finance",
    "notes": "Separate pipeline from realised revenue."
  },
  {
    "sourceRow": 27,
    "family": "Qualified pipeline",
    "standardDefinition": "Documented opportunity value meeting the approved qualification criteria.",
    "numeratorDenominatorControl": "Use stage, probability and expected close-date rules consistently.",
    "targetSteward": "Business Development Lead",
    "primarySource": "CRM",
    "notes": "Do not count duplicate opportunities."
  },
  {
    "sourceRow": 28,
    "family": "COE contribution",
    "standardDefinition": "Finance-approved COE revenue less approved direct costs, or EBITDA, as defined in the COE plan.",
    "numeratorDenominatorControl": "Use one approved COE contribution definition and allocate shared costs consistently.",
    "targetSteward": "Group CFO",
    "primarySource": "Finance ERP / management accounts",
    "notes": "State whether contribution margin or EBITDA is reported."
  },
  {
    "sourceRow": 29,
    "family": "Contract utilisation",
    "standardDefinition": "Actual use of contracted services divided by the approved account expectation or contracted access base.",
    "numeratorDenominatorControl": "Use the contract-specific denominator and valid active-account population.",
    "targetSteward": "Corporate Revenue & Insurance Lead",
    "primarySource": "Contract register / HIS / finance",
    "notes": "Report by account and contract type."
  },
  {
    "sourceRow": 30,
    "family": "Procurement savings",
    "standardDefinition": "Finance-validated difference between approved baseline and actual purchase cost for comparable volume and specification.",
    "numeratorDenominatorControl": "Use a documented baseline; separate savings, cost avoidance and price variance.",
    "targetSteward": "Procurement Head",
    "primarySource": "Procurement system / finance ERP",
    "notes": "No benefit without Finance validation."
  },
  {
    "sourceRow": 31,
    "family": "Inventory days / obsolete stock",
    "standardDefinition": "Inventory value divided by relevant consumption under the group-approved inventory convention; obsolete or expiring stock valued separately.",
    "numeratorDenominatorControl": "Use consistent valuation and consumption period.",
    "targetSteward": "Procurement Head",
    "primarySource": "Inventory system / finance ERP",
    "notes": "Critical stockouts are reported separately."
  },
  {
    "sourceRow": 32,
    "family": "Legal and compliance closure",
    "standardDefinition": "Required legal, licence, filing, governance or audit actions closed by due date divided by actions due.",
    "numeratorDenominatorControl": "Maintain a controlled action register with risk rating, owner and due date.",
    "targetSteward": "Legal Head",
    "primarySource": "Legal / governance / audit tracker",
    "notes": "Critical exceptions must be escalated, not averaged away."
  },
  {
    "sourceRow": 33,
    "family": "KPI data quality",
    "standardDefinition": "Critical KPI records meeting approved completeness, consistency, timeliness and reconciliation checks.",
    "numeratorDenominatorControl": "Define each check and source-of-truth system before publication.",
    "targetSteward": "Head of Analytics & Digital Transformation",
    "primarySource": "Data-quality controls / finance reconciliation",
    "notes": "Data-quality status should accompany the KPI pack."
  },
  {
    "sourceRow": 34,
    "family": "Forecast accuracy",
    "standardDefinition": "Difference between approved forecast and actual measured under the agreed error method and time horizon.",
    "numeratorDenominatorControl": "Use the same horizon, actual close and error definition for each reporting cycle.",
    "targetSteward": "Group CFO",
    "primarySource": "FP&A / BI platform",
    "notes": "Report bias as well as absolute accuracy where approved."
  }
] as const;
