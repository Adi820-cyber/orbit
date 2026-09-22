/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 * Produced by scripts/import-workbook.ts from Africare_Group_KPI_Framework.xlsx.
 * Regenerate with: npm run import -- <path-to-xlsx>
 */

import type { RoleKpiAssignment } from "../types.ts";

export const ROLE_KPI_ASSIGNMENTS: readonly RoleKpiAssignment[] = [
  {
    "sourceRow": 6,
    "level": "Group governance",
    "role": "Chairman",
    "reportsTo": "Board / shareholders",
    "keyDeliverable": "Profitable group growth",
    "kpi": "Group net revenue vs approved budget",
    "definition": "Finance-approved group net revenue for the period divided by the approved budget for the same period.",
    "weight": 0.2,
    "targetBasis": "Board-approved annual and monthly budget",
    "review": "Monthly",
    "primaryDataSource": "Finance ERP / management accounts",
    "keyCollaborator": "Group CFO; Regional COOs",
    "definitionFamilies": [
      "Net revenue"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 7,
    "level": "Group governance",
    "role": "Chairman",
    "reportsTo": "Board / shareholders",
    "keyDeliverable": "Profitable group growth",
    "kpi": "Group EBITDA vs approved budget",
    "definition": "Finance-approved group EBITDA compared with approved budget, using one group accounting definition.",
    "weight": 0.2,
    "targetBasis": "Board-approved EBITDA plan",
    "review": "Monthly",
    "primaryDataSource": "Finance ERP / management accounts",
    "keyCollaborator": "Group CFO; Regional COOs",
    "definitionFamilies": [
      "EBITDA"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 8,
    "level": "Group governance",
    "role": "Chairman",
    "reportsTo": "Board / shareholders",
    "keyDeliverable": "Financial sustainability",
    "kpi": "Operating cash flow and working capital vs plan",
    "definition": "Operating cash flow and working-capital position compared with the approved cash plan.",
    "weight": 0.15,
    "targetBasis": "Board-approved cash-flow plan",
    "review": "Monthly",
    "primaryDataSource": "Treasury / finance ERP",
    "keyCollaborator": "Group CFO; Billing & Revenue Leads",
    "definitionFamilies": [
      "Operating cash flow"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 9,
    "level": "Group governance",
    "role": "Chairman",
    "reportsTo": "Board / shareholders",
    "keyDeliverable": "Safe, effective clinical care",
    "kpi": "Group clinical quality and safety index",
    "definition": "Approved clinical-quality composite, reported with its approved component definitions and risk adjustment where applicable.",
    "weight": 0.15,
    "targetBasis": "Board-approved clinical quality plan",
    "review": "Monthly",
    "primaryDataSource": "Quality system / HIS / clinical audit",
    "keyCollaborator": "Chief / Group Clinical Medical Director",
    "definitionFamilies": [
      "Clinical quality scorecard"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 10,
    "level": "Group governance",
    "role": "Chairman",
    "reportsTo": "Board / shareholders",
    "keyDeliverable": "Patient-centred care",
    "kpi": "Group patient experience index",
    "definition": "Approved patient-experience survey composite for hospitals and clinics, with response-rate context.",
    "weight": 0.1,
    "targetBasis": "Annual patient-experience plan",
    "review": "Monthly",
    "primaryDataSource": "Patient feedback platform / complaint register",
    "keyCollaborator": "Regional COOs; DHOs",
    "definitionFamilies": [
      "Patient experience"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 11,
    "level": "Group governance",
    "role": "Chairman",
    "reportsTo": "Board / shareholders",
    "keyDeliverable": "Strategic growth",
    "kpi": "COE, corporate and expansion milestones",
    "definition": "Share of Board-approved growth milestones completed on time and to approved financial and clinical cases.",
    "weight": 0.1,
    "targetBasis": "Board-approved strategic plan",
    "review": "Monthly",
    "primaryDataSource": "Strategy tracker / finance / CRM",
    "keyCollaborator": "Clinical Medical Director; Corporate Revenue & Insurance Lead",
    "definitionFamilies": [
      "COE contribution",
      "Contract utilisation"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 12,
    "level": "Group governance",
    "role": "Chairman",
    "reportsTo": "Board / shareholders",
    "keyDeliverable": "Governance and resilience",
    "kpi": "Critical governance, legal and audit actions closed",
    "definition": "Critical actions closed by the agreed due date divided by critical actions due in the period.",
    "weight": 0.1,
    "targetBasis": "Board governance calendar",
    "review": "Monthly",
    "primaryDataSource": "Governance tracker / legal register / audit tracker",
    "keyCollaborator": "Legal Head; Group CFO; HR Head",
    "definitionFamilies": [
      "Legal and compliance closure"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 13,
    "level": "Group clinical leadership",
    "role": "Chief / Group Clinical Medical Director",
    "reportsTo": "Chairman",
    "keyDeliverable": "Clinical governance",
    "kpi": "Clinical quality scorecard",
    "definition": "Approved clinical-quality composite across the group, using documented indicators and valid denominators.",
    "weight": 0.2,
    "targetBasis": "Approved annual clinical-quality plan",
    "review": "Monthly",
    "primaryDataSource": "Quality system / HIS / clinical audit",
    "keyCollaborator": "Regional COOs; CoE Leads",
    "definitionFamilies": [
      "Clinical quality scorecard"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 14,
    "level": "Group clinical leadership",
    "role": "Chief / Group Clinical Medical Director",
    "reportsTo": "Chairman",
    "keyDeliverable": "Clinical safety",
    "kpi": "Serious adverse-event rate and review closure",
    "definition": "Risk-adjusted serious adverse events, together with completion of required reviews and corrective actions.",
    "weight": 0.15,
    "targetBasis": "Clinical governance plan and approved thresholds",
    "review": "Monthly",
    "primaryDataSource": "Incident reporting system / quality register",
    "keyCollaborator": "DHOs; CoE Leads",
    "definitionFamilies": [
      "Serious adverse events"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 15,
    "level": "Group clinical leadership",
    "role": "Chief / Group Clinical Medical Director",
    "reportsTo": "Chairman",
    "keyDeliverable": "Standardised practice",
    "kpi": "Protocol compliance and critical audit closure",
    "definition": "Compliance with approved protocols and clinical-audit critical actions closed by due date.",
    "weight": 0.15,
    "targetBasis": "Approved protocol and audit plan",
    "review": "Monthly",
    "primaryDataSource": "Clinical audit / quality system",
    "keyCollaborator": "CoE Leads; DHOs",
    "definitionFamilies": [
      "Protocol compliance"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 16,
    "level": "Group clinical leadership",
    "role": "Chief / Group Clinical Medical Director",
    "reportsTo": "Chairman",
    "keyDeliverable": "Clinical patient experience",
    "kpi": "Clinical patient experience score",
    "definition": "Approved clinical-care experience score, reported with response rate and service-line context.",
    "weight": 0.1,
    "targetBasis": "Annual patient-experience plan",
    "review": "Monthly",
    "primaryDataSource": "Patient feedback platform",
    "keyCollaborator": "Regional COOs; DHOs",
    "definitionFamilies": [
      "Patient experience"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 17,
    "level": "Group clinical leadership",
    "role": "Chief / Group Clinical Medical Director",
    "reportsTo": "Chairman",
    "keyDeliverable": "Medical capability",
    "kpi": "Medical credentialing and capability completion",
    "definition": "Required medical staff with current credentials and completed competency requirements divided by total required staff.",
    "weight": 0.1,
    "targetBasis": "Medical workforce and credentialing plan",
    "review": "Monthly",
    "primaryDataSource": "Medical affairs / HRIS",
    "keyCollaborator": "HR Head; People Executives",
    "definitionFamilies": [
      "Mandatory learning / credentialing"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 18,
    "level": "Group clinical leadership",
    "role": "Chief / Group Clinical Medical Director",
    "reportsTo": "Chairman",
    "keyDeliverable": "Centres of Excellence",
    "kpi": "COE revenue and contribution vs plan",
    "definition": "Finance-approved revenue and contribution from Board-approved COE programmes compared with plan.",
    "weight": 0.12,
    "targetBasis": "Approved COE business plan",
    "review": "Monthly",
    "primaryDataSource": "Finance ERP / HIS",
    "keyCollaborator": "CoE Leads; Group CFO",
    "definitionFamilies": [
      "COE contribution"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 19,
    "level": "Group clinical leadership",
    "role": "Chief / Group Clinical Medical Director",
    "reportsTo": "Chairman",
    "keyDeliverable": "Corporate and insurer solutions",
    "kpi": "Clinical propositions converted to revenue",
    "definition": "Approved corporate or insurer clinical propositions launched and generating revenue compared with plan.",
    "weight": 0.1,
    "targetBasis": "Corporate and insurer growth plan",
    "review": "Monthly",
    "primaryDataSource": "CRM / contract register / finance",
    "keyCollaborator": "Corporate Revenue & Insurance Lead",
    "definitionFamilies": [
      "New business revenue",
      "Qualified pipeline"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 20,
    "level": "Group clinical leadership",
    "role": "Chief / Group Clinical Medical Director",
    "reportsTo": "Chairman",
    "keyDeliverable": "Continuum of care",
    "kpi": "Priority-care referral conversion",
    "definition": "Eligible internal or external referrals completing the intended consultation, admission or procedure divided by eligible referrals.",
    "weight": 0.08,
    "targetBasis": "Service-line growth plan",
    "review": "Monthly",
    "primaryDataSource": "HIS / referral tracker",
    "keyCollaborator": "Regional COOs; DHOs",
    "definitionFamilies": [
      "Referral conversion"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 21,
    "level": "Regional management",
    "role": "Regional COO",
    "reportsTo": "Chairman",
    "keyDeliverable": "Regional financial performance",
    "kpi": "Regional net revenue vs approved budget",
    "definition": "Finance-approved regional net revenue compared with the approved budget for the period.",
    "weight": 0.15,
    "targetBasis": "Approved regional monthly budget",
    "review": "Monthly",
    "primaryDataSource": "Finance ERP / management accounts",
    "keyCollaborator": "DHOs; Group CFO",
    "definitionFamilies": [
      "Net revenue"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 22,
    "level": "Regional management",
    "role": "Regional COO",
    "reportsTo": "Chairman",
    "keyDeliverable": "Regional financial performance",
    "kpi": "Regional EBITDA vs approved budget",
    "definition": "Finance-approved regional EBITDA compared with the approved budget for the period.",
    "weight": 0.15,
    "targetBasis": "Approved regional monthly budget",
    "review": "Monthly",
    "primaryDataSource": "Finance ERP / management accounts",
    "keyCollaborator": "DHOs; Group CFO",
    "definitionFamilies": [
      "EBITDA"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 23,
    "level": "Regional management",
    "role": "Regional COO",
    "reportsTo": "Chairman",
    "keyDeliverable": "Capacity and throughput",
    "kpi": "Hospital and clinic capacity utilisation",
    "definition": "Service-line utilisation using staffed bed days, appointment slots, equipment hours or other approved capacity denominators; do not aggregate unlike units.",
    "weight": 0.1,
    "targetBasis": "Approved capacity plan by service line",
    "review": "Monthly",
    "primaryDataSource": "HIS / scheduling / equipment logs",
    "keyCollaborator": "DHOs",
    "definitionFamilies": [
      "Capacity utilisation"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 24,
    "level": "Regional management",
    "role": "Regional COO",
    "reportsTo": "Chairman",
    "keyDeliverable": "Demand and continuity",
    "kpi": "Patient volume and referral conversion",
    "definition": "Patient volume compared with plan and eligible referrals completing the intended next service divided by eligible referrals.",
    "weight": 0.1,
    "targetBasis": "Regional volume and referral plan",
    "review": "Monthly",
    "primaryDataSource": "HIS / referral tracker",
    "keyCollaborator": "DHOs; Business Development Leads",
    "definitionFamilies": [
      "Referral conversion"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 25,
    "level": "Regional management",
    "role": "Regional COO",
    "reportsTo": "Chairman",
    "keyDeliverable": "Cash conversion",
    "kpi": "Collections and DSO vs plan",
    "definition": "Cash collections versus plan and debtor days using the group-approved DSO calculation.",
    "weight": 0.12,
    "targetBasis": "Approved cash and collections plan",
    "review": "Monthly",
    "primaryDataSource": "Billing system / finance ERP",
    "keyCollaborator": "Billing & Revenue Leads; Group CFO",
    "definitionFamilies": [
      "Collections"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 26,
    "level": "Regional management",
    "role": "Regional COO",
    "reportsTo": "Chairman",
    "keyDeliverable": "Revenue-cycle discipline",
    "kpi": "Claim clean rate and denial value",
    "definition": "First-pass accepted claims divided by submitted claims, and rejected or denied claim value divided by submitted claim value.",
    "weight": 0.1,
    "targetBasis": "Approved revenue-cycle targets",
    "review": "Monthly",
    "primaryDataSource": "Billing / payer portals",
    "keyCollaborator": "Billing & Revenue Leads",
    "definitionFamilies": [
      "First-pass claim acceptance",
      "Denied or rejected claim value"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 27,
    "level": "Regional management",
    "role": "Regional COO",
    "reportsTo": "Chairman",
    "keyDeliverable": "Patient-centred operations",
    "kpi": "Patient experience and CAPA closure",
    "definition": "Approved patient-experience score and complaints or adverse feedback corrective actions closed by due date.",
    "weight": 0.1,
    "targetBasis": "Annual patient-experience and quality plan",
    "review": "Monthly",
    "primaryDataSource": "Feedback platform / complaint register",
    "keyCollaborator": "DHOs",
    "definitionFamilies": [
      "Patient experience"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 28,
    "level": "Regional management",
    "role": "Regional COO",
    "reportsTo": "Chairman",
    "keyDeliverable": "People performance",
    "kpi": "Engagement and critical-role retention",
    "definition": "Approved engagement score and retention of designated critical roles, reported by hospital.",
    "weight": 0.08,
    "targetBasis": "Regional people plan",
    "review": "Monthly",
    "primaryDataSource": "HRIS / engagement survey",
    "keyCollaborator": "People Executives; HR Head",
    "definitionFamilies": [
      "Engagement"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 29,
    "level": "Regional management",
    "role": "Regional COO",
    "reportsTo": "Chairman",
    "keyDeliverable": "Growth initiatives",
    "kpi": "New service, COE and corporate revenue vs plan",
    "definition": "Finance-approved revenue from approved new services, COE programmes and corporate channels versus plan.",
    "weight": 0.1,
    "targetBasis": "Regional growth plan",
    "review": "Monthly",
    "primaryDataSource": "Finance ERP / CRM / HIS",
    "keyCollaborator": "DHOs; Clinical Medical Director",
    "definitionFamilies": [
      "New business revenue",
      "COE contribution"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 30,
    "level": "Hospital leadership",
    "role": "Hospital DHO",
    "reportsTo": "Regional COO",
    "keyDeliverable": "Facility financial performance",
    "kpi": "Hospital net revenue vs approved budget",
    "definition": "Finance-approved hospital net revenue compared with approved budget for the period.",
    "weight": 0.15,
    "targetBasis": "Approved hospital monthly budget",
    "review": "Monthly",
    "primaryDataSource": "Finance ERP / management accounts",
    "keyCollaborator": "Billing & Revenue Lead; Business Development Lead",
    "definitionFamilies": [
      "Net revenue"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 31,
    "level": "Hospital leadership",
    "role": "Hospital DHO",
    "reportsTo": "Regional COO",
    "keyDeliverable": "Facility financial performance",
    "kpi": "Hospital EBITDA vs approved budget",
    "definition": "Finance-approved hospital EBITDA compared with approved budget for the period.",
    "weight": 0.12,
    "targetBasis": "Approved hospital monthly budget",
    "review": "Monthly",
    "primaryDataSource": "Finance ERP / management accounts",
    "keyCollaborator": "Regional COO; Group CFO",
    "definitionFamilies": [
      "EBITDA"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 32,
    "level": "Hospital leadership",
    "role": "Hospital DHO",
    "reportsTo": "Regional COO",
    "keyDeliverable": "Capacity and operations",
    "kpi": "Capacity utilisation and patient throughput",
    "definition": "Service-line utilisation against approved capacity and completed patient throughput versus plan, using consistent local definitions.",
    "weight": 0.12,
    "targetBasis": "Hospital capacity and volume plan",
    "review": "Monthly",
    "primaryDataSource": "HIS / scheduling / equipment logs",
    "keyCollaborator": "Service Heads",
    "definitionFamilies": [
      "Capacity utilisation"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 33,
    "level": "Hospital leadership",
    "role": "Hospital DHO",
    "reportsTo": "Regional COO",
    "keyDeliverable": "Growth and referrals",
    "kpi": "Referral conversion and new service revenue",
    "definition": "Eligible referrals completing the intended service divided by eligible referrals, plus net revenue from approved new services.",
    "weight": 0.1,
    "targetBasis": "Hospital growth plan",
    "review": "Monthly",
    "primaryDataSource": "HIS / CRM / finance",
    "keyCollaborator": "Business Development Lead; Clinical Leads",
    "definitionFamilies": [
      "Referral conversion"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 34,
    "level": "Hospital leadership",
    "role": "Hospital DHO",
    "reportsTo": "Regional COO",
    "keyDeliverable": "Patient experience",
    "kpi": "Patient experience and complaint CAPA closure",
    "definition": "Approved non-clinical patient-experience score and complaints or adverse feedback actions closed by due date.",
    "weight": 0.1,
    "targetBasis": "Annual patient-experience plan",
    "review": "Monthly",
    "primaryDataSource": "Feedback platform / complaint register",
    "keyCollaborator": "Facility team; Regional COO",
    "definitionFamilies": [
      "Patient experience"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 35,
    "level": "Hospital leadership",
    "role": "Hospital DHO",
    "reportsTo": "Regional COO",
    "keyDeliverable": "Cash conversion",
    "kpi": "Collections, DSO and unbilled revenue",
    "definition": "Cash collections versus plan, debtor days and completed services not yet billed, using group-approved definitions.",
    "weight": 0.12,
    "targetBasis": "Hospital cash and collections plan",
    "review": "Monthly",
    "primaryDataSource": "Billing system / finance ERP",
    "keyCollaborator": "Billing & Revenue Lead",
    "definitionFamilies": [
      "Collections"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 36,
    "level": "Hospital leadership",
    "role": "Hospital DHO",
    "reportsTo": "Regional COO",
    "keyDeliverable": "Revenue-cycle quality",
    "kpi": "Claim first-pass acceptance and rejection value",
    "definition": "Claims accepted at first submission divided by submitted claims, plus rejected or denied claim value divided by submitted value.",
    "weight": 0.1,
    "targetBasis": "Approved revenue-cycle targets",
    "review": "Monthly",
    "primaryDataSource": "Billing / payer portals",
    "keyCollaborator": "Billing & Revenue Lead",
    "definitionFamilies": [
      "First-pass claim acceptance",
      "Denied or rejected claim value"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 37,
    "level": "Hospital leadership",
    "role": "Hospital DHO",
    "reportsTo": "Regional COO",
    "keyDeliverable": "People effectiveness",
    "kpi": "People productivity, engagement and critical attrition",
    "definition": "Approved output-per-FTE measures by function, engagement score and attrition among designated critical roles.",
    "weight": 0.1,
    "targetBasis": "Hospital people plan",
    "review": "Monthly",
    "primaryDataSource": "HRIS / HIS / roster data",
    "keyCollaborator": "People Executive",
    "definitionFamilies": [
      "Engagement"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 38,
    "level": "Hospital leadership",
    "role": "Hospital DHO",
    "reportsTo": "Regional COO",
    "keyDeliverable": "Operational readiness",
    "kpi": "Facility readiness, licensure and safety actions",
    "definition": "Critical operational, safety, licensure and facility actions closed by due date; report exceptions separately.",
    "weight": 0.09,
    "targetBasis": "Hospital compliance and maintenance plan",
    "review": "Monthly",
    "primaryDataSource": "Facilities / compliance tracker",
    "keyCollaborator": "Facilities; Legal Head",
    "definitionFamilies": [
      "Legal and compliance closure"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 39,
    "level": "Hospital functional leadership",
    "role": "People Executive",
    "reportsTo": "Hospital DHO",
    "keyDeliverable": "Staffing readiness",
    "kpi": "Approved position fill rate and time to fill",
    "definition": "Approved positions filled divided by approved positions, plus median or approved time-to-fill for critical vacancies.",
    "weight": 0.15,
    "targetBasis": "Approved workforce plan",
    "review": "Monthly",
    "primaryDataSource": "HRIS / recruitment tracker",
    "keyCollaborator": "Hospital DHO; HR Head",
    "definitionFamilies": [
      "Critical-role attrition"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 40,
    "level": "Hospital functional leadership",
    "role": "People Executive",
    "reportsTo": "Hospital DHO",
    "keyDeliverable": "Workforce productivity",
    "kpi": "Roster adherence and labour productivity",
    "definition": "Rostered staffing delivered versus approved roster, and approved output-per-paid-FTE measures by function.",
    "weight": 0.15,
    "targetBasis": "Approved staffing and productivity plan",
    "review": "Monthly",
    "primaryDataSource": "HRIS / roster / HIS",
    "keyCollaborator": "Hospital DHO",
    "definitionFamilies": [
      "Workforce productivity"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 41,
    "level": "Hospital functional leadership",
    "role": "People Executive",
    "reportsTo": "Hospital DHO",
    "keyDeliverable": "Retention",
    "kpi": "Critical-role attrition",
    "definition": "Voluntary and total attrition among designated critical roles compared with the approved retention plan.",
    "weight": 0.15,
    "targetBasis": "Approved people plan",
    "review": "Monthly",
    "primaryDataSource": "HRIS",
    "keyCollaborator": "Hospital DHO; HR Head",
    "definitionFamilies": [
      "Critical-role attrition"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 42,
    "level": "Hospital functional leadership",
    "role": "People Executive",
    "reportsTo": "Hospital DHO",
    "keyDeliverable": "Employee experience",
    "kpi": "Engagement score and action closure",
    "definition": "Approved engagement survey score and action-plan items closed by due date.",
    "weight": 0.15,
    "targetBasis": "Annual engagement plan",
    "review": "Monthly",
    "primaryDataSource": "Engagement survey / HR action tracker",
    "keyCollaborator": "Hospital DHO",
    "definitionFamilies": [
      "Engagement"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 43,
    "level": "Hospital functional leadership",
    "role": "People Executive",
    "reportsTo": "Hospital DHO",
    "keyDeliverable": "Performance management",
    "kpi": "Performance review and talent-matrix completion",
    "definition": "Eligible employees with completed performance review and current talent assessment divided by eligible employees.",
    "weight": 0.1,
    "targetBasis": "Group performance calendar",
    "review": "Monthly",
    "primaryDataSource": "HRIS",
    "keyCollaborator": "HR Head",
    "definitionFamilies": [
      "Mandatory learning / credentialing"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 44,
    "level": "Hospital functional leadership",
    "role": "People Executive",
    "reportsTo": "Hospital DHO",
    "keyDeliverable": "Compliance and capability",
    "kpi": "Mandatory training and credentialing completion",
    "definition": "Required employees with completed mandatory learning and current role credentials divided by required employees.",
    "weight": 0.15,
    "targetBasis": "Approved training and credentialing plan",
    "review": "Monthly",
    "primaryDataSource": "LMS / HRIS / medical affairs",
    "keyCollaborator": "Clinical Medical Director; Hospital DHO",
    "definitionFamilies": [
      "Mandatory learning / credentialing"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 45,
    "level": "Hospital functional leadership",
    "role": "People Executive",
    "reportsTo": "Hospital DHO",
    "keyDeliverable": "Employment compliance",
    "kpi": "HR and statutory actions closed on time",
    "definition": "Required HR, employee-relations and statutory actions closed by due date divided by actions due.",
    "weight": 0.1,
    "targetBasis": "HR compliance calendar",
    "review": "Monthly",
    "primaryDataSource": "HR compliance tracker",
    "keyCollaborator": "HR Head; Legal Head",
    "definitionFamilies": [
      "Legal and compliance closure"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 46,
    "level": "Hospital functional leadership",
    "role": "People Executive",
    "reportsTo": "Hospital DHO",
    "keyDeliverable": "Cost discipline",
    "kpi": "Manpower cost vs plan",
    "definition": "Approved manpower cost for the facility compared with budget, with vacancy and overtime context.",
    "weight": 0.05,
    "targetBasis": "Approved manpower budget",
    "review": "Monthly",
    "primaryDataSource": "Payroll / finance ERP",
    "keyCollaborator": "Hospital DHO; Group CFO",
    "definitionFamilies": [
      "Workforce productivity"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 47,
    "level": "Hospital functional leadership",
    "role": "Business Development Lead",
    "reportsTo": "Hospital DHO",
    "keyDeliverable": "New demand generation",
    "kpi": "New business revenue vs plan",
    "definition": "Finance-approved revenue attributable to approved business-development channels or campaigns versus plan.",
    "weight": 0.2,
    "targetBasis": "Hospital growth plan",
    "review": "Monthly",
    "primaryDataSource": "CRM / HIS / finance",
    "keyCollaborator": "Hospital DHO",
    "definitionFamilies": [
      "New business revenue"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 48,
    "level": "Hospital functional leadership",
    "role": "Business Development Lead",
    "reportsTo": "Hospital DHO",
    "keyDeliverable": "Pipeline health",
    "kpi": "Qualified pipeline coverage",
    "definition": "Qualified, documented revenue pipeline compared with the approved future-period pipeline requirement.",
    "weight": 0.1,
    "targetBasis": "Approved pipeline coverage requirement",
    "review": "Monthly",
    "primaryDataSource": "CRM",
    "keyCollaborator": "Hospital DHO",
    "definitionFamilies": [
      "Qualified pipeline"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 49,
    "level": "Hospital functional leadership",
    "role": "Business Development Lead",
    "reportsTo": "Hospital DHO",
    "keyDeliverable": "Conversion",
    "kpi": "Lead-to-revenue conversion",
    "definition": "Qualified leads that generate a completed billable service or contract divided by qualified leads, using CRM attribution rules.",
    "weight": 0.15,
    "targetBasis": "Hospital conversion plan",
    "review": "Monthly",
    "primaryDataSource": "CRM / HIS",
    "keyCollaborator": "Hospital DHO; Billing & Revenue Lead",
    "definitionFamilies": [
      "New business revenue",
      "Qualified pipeline"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 50,
    "level": "Hospital functional leadership",
    "role": "Business Development Lead",
    "reportsTo": "Hospital DHO",
    "keyDeliverable": "Referrer ecosystem",
    "kpi": "Active referrer network and referral revenue",
    "definition": "Active referrers meeting the approved activity criterion and finance-approved revenue from their referrals.",
    "weight": 0.15,
    "targetBasis": "Referrer network plan",
    "review": "Monthly",
    "primaryDataSource": "CRM / HIS / finance",
    "keyCollaborator": "Clinical Leads; Hospital DHO",
    "definitionFamilies": [
      "Referral conversion",
      "New business revenue"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 51,
    "level": "Hospital functional leadership",
    "role": "Business Development Lead",
    "reportsTo": "Hospital DHO",
    "keyDeliverable": "COE and service development",
    "kpi": "New-service and COE lead conversion",
    "definition": "Qualified leads for approved new services or COEs that convert to completed service or revenue.",
    "weight": 0.15,
    "targetBasis": "COE and service-line growth plan",
    "review": "Monthly",
    "primaryDataSource": "CRM / HIS",
    "keyCollaborator": "CoE Lead; Clinical Medical Director",
    "definitionFamilies": [
      "Qualified pipeline",
      "COE contribution"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 52,
    "level": "Hospital functional leadership",
    "role": "Business Development Lead",
    "reportsTo": "Hospital DHO",
    "keyDeliverable": "Corporate channel support",
    "kpi": "Corporate opportunities handed over and accepted",
    "definition": "Qualified corporate opportunities formally accepted by the Corporate Revenue & Insurance team divided by qualified handovers.",
    "weight": 0.1,
    "targetBasis": "Corporate opportunity plan",
    "review": "Monthly",
    "primaryDataSource": "CRM",
    "keyCollaborator": "Corporate Revenue & Insurance Lead",
    "definitionFamilies": [
      "Qualified pipeline"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 53,
    "level": "Hospital functional leadership",
    "role": "Business Development Lead",
    "reportsTo": "Hospital DHO",
    "keyDeliverable": "Forecast discipline",
    "kpi": "CRM completeness and forecast accuracy",
    "definition": "Required CRM fields complete for active opportunities and forecast compared with realised attributed revenue.",
    "weight": 0.05,
    "targetBasis": "CRM data-quality standard",
    "review": "Monthly",
    "primaryDataSource": "CRM / analytics",
    "keyCollaborator": "Head of Analytics & Digital Transformation",
    "definitionFamilies": [
      "Forecast accuracy"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 54,
    "level": "Hospital functional leadership",
    "role": "Business Development Lead",
    "reportsTo": "Hospital DHO",
    "keyDeliverable": "Channel effectiveness",
    "kpi": "Acquisition economics vs plan",
    "definition": "Approved acquisition cost and attributable new revenue compared with channel plan; use finance-approved attribution.",
    "weight": 0.1,
    "targetBasis": "Approved channel plan",
    "review": "Monthly",
    "primaryDataSource": "CRM / finance",
    "keyCollaborator": "Hospital DHO; Group CFO",
    "definitionFamilies": [
      "New business revenue"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 55,
    "level": "Hospital functional leadership",
    "role": "Billing & Revenue Lead",
    "reportsTo": "Hospital DHO",
    "keyDeliverable": "Clean billing",
    "kpi": "Claim first-pass acceptance rate",
    "definition": "Claims accepted without resubmission divided by claims submitted in the period.",
    "weight": 0.15,
    "targetBasis": "Approved revenue-cycle target",
    "review": "Monthly",
    "primaryDataSource": "Billing system / payer portals",
    "keyCollaborator": "Hospital DHO; Clinical documentation owners",
    "definitionFamilies": [
      "First-pass claim acceptance"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 56,
    "level": "Hospital functional leadership",
    "role": "Billing & Revenue Lead",
    "reportsTo": "Hospital DHO",
    "keyDeliverable": "Timely submission",
    "kpi": "Claim submission turnaround time",
    "definition": "Median or approved percentile days from discharge or service completion to complete claim submission.",
    "weight": 0.1,
    "targetBasis": "Approved revenue-cycle target",
    "review": "Monthly",
    "primaryDataSource": "Billing system / HIS",
    "keyCollaborator": "Clinical documentation owners",
    "definitionFamilies": [
      "First-pass claim acceptance"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 57,
    "level": "Hospital functional leadership",
    "role": "Billing & Revenue Lead",
    "reportsTo": "Hospital DHO",
    "keyDeliverable": "Denial reduction",
    "kpi": "Rejected or denied claim value",
    "definition": "Rejected or denied claim value divided by submitted claim value, reported by payer and root cause.",
    "weight": 0.15,
    "targetBasis": "Approved denial-reduction plan",
    "review": "Monthly",
    "primaryDataSource": "Billing system / payer portals",
    "keyCollaborator": "Hospital DHO; Corporate Revenue & Insurance Lead",
    "definitionFamilies": [
      "Denied or rejected claim value"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 58,
    "level": "Hospital functional leadership",
    "role": "Billing & Revenue Lead",
    "reportsTo": "Hospital DHO",
    "keyDeliverable": "Cash collection",
    "kpi": "Cash collections vs monthly plan",
    "definition": "Cash posted and reconciled in the period compared with approved monthly collection plan.",
    "weight": 0.15,
    "targetBasis": "Approved cash collections plan",
    "review": "Monthly",
    "primaryDataSource": "Billing system / finance ERP",
    "keyCollaborator": "Hospital DHO; Group CFO",
    "definitionFamilies": [
      "Collections"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 59,
    "level": "Hospital functional leadership",
    "role": "Billing & Revenue Lead",
    "reportsTo": "Hospital DHO",
    "keyDeliverable": "Receivables control",
    "kpi": "DSO and aged receivables",
    "definition": "Debtor days using the group-approved calculation, with receivables beyond the approved ageing threshold separately reported.",
    "weight": 0.15,
    "targetBasis": "Approved DSO and ageing plan",
    "review": "Monthly",
    "primaryDataSource": "Finance ERP / billing system",
    "keyCollaborator": "Hospital DHO; Group CFO",
    "definitionFamilies": [
      "DSO"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 60,
    "level": "Hospital functional leadership",
    "role": "Billing & Revenue Lead",
    "reportsTo": "Hospital DHO",
    "keyDeliverable": "Revenue completeness",
    "kpi": "Unbilled revenue and cash-posting reconciliation",
    "definition": "Completed services not billed and unreconciled cash items, reported with age and action owner.",
    "weight": 0.15,
    "targetBasis": "Approved revenue-integrity target",
    "review": "Monthly",
    "primaryDataSource": "HIS / billing system / finance ERP",
    "keyCollaborator": "Hospital DHO",
    "definitionFamilies": [
      "Unbilled revenue"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 61,
    "level": "Hospital functional leadership",
    "role": "Billing & Revenue Lead",
    "reportsTo": "Hospital DHO",
    "keyDeliverable": "Payer discipline",
    "kpi": "Payer reconciliation and documentation completeness",
    "definition": "Payer accounts reconciled to schedule and submitted claims meeting required documentation standards.",
    "weight": 0.1,
    "targetBasis": "Payer reconciliation calendar",
    "review": "Monthly",
    "primaryDataSource": "Billing system / payer portals",
    "keyCollaborator": "Corporate Revenue & Insurance Lead",
    "definitionFamilies": [
      "Unbilled revenue"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 62,
    "level": "Hospital functional leadership",
    "role": "Billing & Revenue Lead",
    "reportsTo": "Hospital DHO",
    "keyDeliverable": "Leakage prevention",
    "kpi": "Revenue leakage and avoidable credit notes",
    "definition": "Finance-approved avoidable revenue leakage and credit-note value compared with approved target and root-cause actions.",
    "weight": 0.05,
    "targetBasis": "Approved revenue-integrity target",
    "review": "Monthly",
    "primaryDataSource": "Finance ERP / billing audit",
    "keyCollaborator": "Group CFO; Hospital DHO",
    "definitionFamilies": [
      "Unbilled revenue"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 63,
    "level": "Clinical growth",
    "role": "COE Lead",
    "reportsTo": "Chief / Group Clinical Medical Director",
    "keyDeliverable": "COE financial performance",
    "kpi": "COE net revenue vs plan",
    "definition": "Finance-approved revenue from the COE compared with its approved plan.",
    "weight": 0.2,
    "targetBasis": "Approved COE business plan",
    "review": "Monthly",
    "primaryDataSource": "Finance ERP / HIS",
    "keyCollaborator": "Group CFO; Regional COOs",
    "definitionFamilies": [
      "Net revenue"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 64,
    "level": "Clinical growth",
    "role": "COE Lead",
    "reportsTo": "Chief / Group Clinical Medical Director",
    "keyDeliverable": "COE financial performance",
    "kpi": "COE contribution margin or EBITDA vs plan",
    "definition": "Finance-approved contribution margin or EBITDA for the COE compared with approved plan.",
    "weight": 0.15,
    "targetBasis": "Approved COE business plan",
    "review": "Monthly",
    "primaryDataSource": "Finance ERP / management accounts",
    "keyCollaborator": "Group CFO",
    "definitionFamilies": [
      "EBITDA"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 65,
    "level": "Clinical growth",
    "role": "COE Lead",
    "reportsTo": "Chief / Group Clinical Medical Director",
    "keyDeliverable": "Capacity and throughput",
    "kpi": "COE capacity utilisation and case volume",
    "definition": "Approved COE capacity utilised and completed case volume compared with plan, using service-specific denominators.",
    "weight": 0.1,
    "targetBasis": "COE capacity and volume plan",
    "review": "Monthly",
    "primaryDataSource": "HIS / scheduling",
    "keyCollaborator": "Regional COOs; DHOs",
    "definitionFamilies": [
      "Capacity utilisation"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 66,
    "level": "Clinical growth",
    "role": "COE Lead",
    "reportsTo": "Chief / Group Clinical Medical Director",
    "keyDeliverable": "Referral continuity",
    "kpi": "COE referral conversion",
    "definition": "Eligible referrals that complete the intended COE consultation, procedure or care plan divided by eligible referrals.",
    "weight": 0.15,
    "targetBasis": "COE referral plan",
    "review": "Monthly",
    "primaryDataSource": "HIS / referral tracker",
    "keyCollaborator": "Business Development Leads; DHOs",
    "definitionFamilies": [
      "Referral conversion"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 67,
    "level": "Clinical growth",
    "role": "COE Lead",
    "reportsTo": "Chief / Group Clinical Medical Director",
    "keyDeliverable": "Clinical excellence",
    "kpi": "COE outcomes and protocol compliance",
    "definition": "COE clinical outcomes and protocol compliance, using the approved service-line scorecard and risk adjustment where applicable.",
    "weight": 0.15,
    "targetBasis": "Approved COE clinical-quality plan",
    "review": "Monthly",
    "primaryDataSource": "Quality system / HIS / clinical audit",
    "keyCollaborator": "Clinical Medical Director",
    "definitionFamilies": [
      "Protocol compliance"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 68,
    "level": "Clinical growth",
    "role": "COE Lead",
    "reportsTo": "Chief / Group Clinical Medical Director",
    "keyDeliverable": "Patient-centred care",
    "kpi": "COE patient experience score",
    "definition": "Approved patient-experience score for the COE, reported with response rate and key corrective actions.",
    "weight": 0.1,
    "targetBasis": "COE patient-experience plan",
    "review": "Monthly",
    "primaryDataSource": "Patient feedback platform",
    "keyCollaborator": "DHOs; Regional COOs",
    "definitionFamilies": [
      "Patient experience"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 69,
    "level": "Clinical growth",
    "role": "COE Lead",
    "reportsTo": "Chief / Group Clinical Medical Director",
    "keyDeliverable": "Innovation and expansion",
    "kpi": "Approved COE programme milestones",
    "definition": "Approved programme, technology or geographic expansion milestones completed on time and within approved business case.",
    "weight": 0.1,
    "targetBasis": "Approved COE roadmap",
    "review": "Monthly",
    "primaryDataSource": "COE roadmap / finance",
    "keyCollaborator": "Clinical Medical Director; Regional COOs",
    "definitionFamilies": [
      "COE contribution"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 70,
    "level": "Clinical growth",
    "role": "COE Lead",
    "reportsTo": "Chief / Group Clinical Medical Director",
    "keyDeliverable": "Medical capability",
    "kpi": "COE medical-team capability and engagement",
    "definition": "Required competency milestones achieved and approved medical-team engagement measure for the COE.",
    "weight": 0.05,
    "targetBasis": "COE workforce plan",
    "review": "Monthly",
    "primaryDataSource": "Medical affairs / HRIS",
    "keyCollaborator": "HR Head; People Executives",
    "definitionFamilies": [
      "Engagement"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 71,
    "level": "Commercial growth",
    "role": "Corporate Revenue & Insurance Lead",
    "reportsTo": "Chief / Group Clinical Medical Director",
    "keyDeliverable": "Corporate and insurance growth",
    "kpi": "Corporate and insurer net revenue and margin vs plan",
    "definition": "Finance-approved net revenue and margin from corporate and insurer accounts compared with plan.",
    "weight": 0.2,
    "targetBasis": "Approved corporate and insurer plan",
    "review": "Monthly",
    "primaryDataSource": "Finance ERP / contract register",
    "keyCollaborator": "Group CFO; Regional COOs",
    "definitionFamilies": [
      "Net revenue"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 72,
    "level": "Commercial growth",
    "role": "Corporate Revenue & Insurance Lead",
    "reportsTo": "Chief / Group Clinical Medical Director",
    "keyDeliverable": "Account portfolio",
    "kpi": "Active contracted accounts vs plan",
    "definition": "Accounts with active, compliant agreements and expected revenue activity compared with plan.",
    "weight": 0.15,
    "targetBasis": "Approved account-acquisition plan",
    "review": "Monthly",
    "primaryDataSource": "Contract register / CRM",
    "keyCollaborator": "Legal Head; Business Development Leads",
    "definitionFamilies": [
      "Contract utilisation"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 73,
    "level": "Commercial growth",
    "role": "Corporate Revenue & Insurance Lead",
    "reportsTo": "Chief / Group Clinical Medical Director",
    "keyDeliverable": "New tie-ups",
    "kpi": "New corporate and insurer tie-up conversion",
    "definition": "Qualified corporate or insurer opportunities converted to signed, approved agreements divided by qualified opportunities.",
    "weight": 0.15,
    "targetBasis": "Approved new tie-up plan",
    "review": "Monthly",
    "primaryDataSource": "CRM / contract register",
    "keyCollaborator": "Legal Head; Clinical Medical Director",
    "definitionFamilies": [
      "Qualified pipeline"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 74,
    "level": "Commercial growth",
    "role": "Corporate Revenue & Insurance Lead",
    "reportsTo": "Chief / Group Clinical Medical Director",
    "keyDeliverable": "Retention",
    "kpi": "Contract renewal and account retention rate",
    "definition": "Eligible accounts renewed by due date divided by eligible accounts due for renewal, with lost revenue reported.",
    "weight": 0.1,
    "targetBasis": "Annual account-retention plan",
    "review": "Monthly",
    "primaryDataSource": "Contract register / CRM",
    "keyCollaborator": "Legal Head; Group CFO",
    "definitionFamilies": [
      "Contract utilisation"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 75,
    "level": "Commercial growth",
    "role": "Corporate Revenue & Insurance Lead",
    "reportsTo": "Chief / Group Clinical Medical Director",
    "keyDeliverable": "Account activation",
    "kpi": "Contract utilisation and revenue per account",
    "definition": "Actual use of agreed services and revenue per active account compared with account plan.",
    "weight": 0.1,
    "targetBasis": "Approved account plans",
    "review": "Monthly",
    "primaryDataSource": "HIS / finance ERP / CRM",
    "keyCollaborator": "Regional COOs; DHOs",
    "definitionFamilies": [
      "Contract utilisation"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 76,
    "level": "Commercial growth",
    "role": "Corporate Revenue & Insurance Lead",
    "reportsTo": "Chief / Group Clinical Medical Director",
    "keyDeliverable": "Commercial discipline",
    "kpi": "Commercial term yield",
    "definition": "Net realised rates and approved commercial terms compared with contracted rate cards and approved margin floors.",
    "weight": 0.1,
    "targetBasis": "Approved pricing and margin guardrails",
    "review": "Monthly",
    "primaryDataSource": "Contract register / finance",
    "keyCollaborator": "Group CFO; Legal Head",
    "definitionFamilies": [
      "Contract utilisation"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 77,
    "level": "Commercial growth",
    "role": "Corporate Revenue & Insurance Lead",
    "reportsTo": "Chief / Group Clinical Medical Director",
    "keyDeliverable": "Payer issue resolution",
    "kpi": "Payer issue closure",
    "definition": "Payer or corporate billing issues resolved within agreed service levels, with root causes tracked.",
    "weight": 0.1,
    "targetBasis": "Approved payer-service standard",
    "review": "Monthly",
    "primaryDataSource": "Billing system / issue tracker",
    "keyCollaborator": "Billing & Revenue Leads",
    "definitionFamilies": [
      "Denied or rejected claim value"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 78,
    "level": "Commercial growth",
    "role": "Corporate Revenue & Insurance Lead",
    "reportsTo": "Chief / Group Clinical Medical Director",
    "keyDeliverable": "Commercial predictability",
    "kpi": "Pipeline forecast accuracy and CRM completeness",
    "definition": "Forecast compared with realised contracted revenue and completeness of required CRM fields for active accounts.",
    "weight": 0.1,
    "targetBasis": "CRM data-quality and forecast standard",
    "review": "Monthly",
    "primaryDataSource": "CRM / analytics",
    "keyCollaborator": "Head of Analytics & Digital Transformation",
    "definitionFamilies": [
      "Forecast accuracy"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 79,
    "level": "Group support",
    "role": "Group CFO",
    "reportsTo": "Chairman",
    "keyDeliverable": "Profitability",
    "kpi": "Group EBITDA vs approved budget",
    "definition": "Finance-approved group EBITDA compared with approved budget, with region and hospital drivers reconciled.",
    "weight": 0.2,
    "targetBasis": "Board-approved EBITDA plan",
    "review": "Monthly",
    "primaryDataSource": "Finance ERP / management accounts",
    "keyCollaborator": "Chairman; Regional COOs",
    "definitionFamilies": [
      "EBITDA"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 80,
    "level": "Group support",
    "role": "Group CFO",
    "reportsTo": "Chairman",
    "keyDeliverable": "Liquidity",
    "kpi": "Cash flow, liquidity and working capital vs plan",
    "definition": "Operating cash flow, liquidity headroom and working-capital position compared with approved cash plan.",
    "weight": 0.15,
    "targetBasis": "Board-approved cash-flow plan",
    "review": "Monthly",
    "primaryDataSource": "Treasury / finance ERP",
    "keyCollaborator": "Billing & Revenue Leads",
    "definitionFamilies": [
      "Operating cash flow"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 81,
    "level": "Group support",
    "role": "Group CFO",
    "reportsTo": "Chairman",
    "keyDeliverable": "Cash conversion",
    "kpi": "Group collections and DSO vs plan",
    "definition": "Group cash collections versus plan and debtor days using the group-approved calculation.",
    "weight": 0.15,
    "targetBasis": "Approved collections and DSO plan",
    "review": "Monthly",
    "primaryDataSource": "Billing system / finance ERP",
    "keyCollaborator": "Billing & Revenue Leads; Regional COOs",
    "definitionFamilies": [
      "Collections"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 82,
    "level": "Group support",
    "role": "Group CFO",
    "reportsTo": "Chairman",
    "keyDeliverable": "Planning discipline",
    "kpi": "Forecast and budget quality",
    "definition": "Timely forecast submission and approved forecast accuracy for revenue, EBITDA, cash and major cost drivers.",
    "weight": 0.1,
    "targetBasis": "Finance planning calendar and accuracy standard",
    "review": "Monthly",
    "primaryDataSource": "FP&A models / finance ERP",
    "keyCollaborator": "Head of Analytics & Digital Transformation",
    "definitionFamilies": [
      "Forecast accuracy"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 83,
    "level": "Group support",
    "role": "Group CFO",
    "reportsTo": "Chairman",
    "keyDeliverable": "Cost improvement",
    "kpi": "Controllable cost improvement vs plan",
    "definition": "Finance-validated controllable cost improvement and cost-per-service trend compared with plan, preserving quality and availability.",
    "weight": 0.15,
    "targetBasis": "Approved cost-improvement plan",
    "review": "Monthly",
    "primaryDataSource": "Finance ERP / procurement / HIS",
    "keyCollaborator": "Procurement Head; Regional COOs",
    "definitionFamilies": [
      "Procurement savings"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 84,
    "level": "Group support",
    "role": "Group CFO",
    "reportsTo": "Chairman",
    "keyDeliverable": "Financial control",
    "kpi": "Financial controls and leakage actions closed",
    "definition": "Material control gaps, reconciliations and leakage actions closed by due date, with residual risk reported.",
    "weight": 0.1,
    "targetBasis": "Finance control plan",
    "review": "Monthly",
    "primaryDataSource": "Finance controls / internal audit",
    "keyCollaborator": "Billing & Revenue Leads; Legal Head",
    "definitionFamilies": [
      "Legal and compliance closure"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 85,
    "level": "Group support",
    "role": "Group CFO",
    "reportsTo": "Chairman",
    "keyDeliverable": "Compliance",
    "kpi": "Finance compliance and audit-action closure",
    "definition": "Finance statutory and audit actions completed by due date divided by actions due.",
    "weight": 0.15,
    "targetBasis": "Finance compliance calendar",
    "review": "Monthly",
    "primaryDataSource": "Finance compliance / audit tracker",
    "keyCollaborator": "Legal Head",
    "definitionFamilies": [
      "Legal and compliance closure"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 86,
    "level": "Group support",
    "role": "Procurement Head",
    "reportsTo": "Chairman",
    "keyDeliverable": "Cost performance",
    "kpi": "Finance-validated procurement savings vs plan",
    "definition": "Finance-validated savings from negotiated purchasing versus approved baseline, compared with plan.",
    "weight": 0.2,
    "targetBasis": "Approved procurement savings plan",
    "review": "Monthly",
    "primaryDataSource": "Procurement system / finance ERP",
    "keyCollaborator": "Group CFO; Regional COOs",
    "definitionFamilies": [
      "Procurement savings"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 87,
    "level": "Group support",
    "role": "Procurement Head",
    "reportsTo": "Chairman",
    "keyDeliverable": "Buying compliance",
    "kpi": "Contract and purchase-order compliance",
    "definition": "Spend placed through approved contracts and purchase orders divided by addressable spend.",
    "weight": 0.1,
    "targetBasis": "Approved procurement compliance standard",
    "review": "Monthly",
    "primaryDataSource": "Procurement system / finance ERP",
    "keyCollaborator": "Group CFO",
    "definitionFamilies": [
      "Legal and compliance closure"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 88,
    "level": "Group support",
    "role": "Procurement Head",
    "reportsTo": "Chairman",
    "keyDeliverable": "Supply continuity",
    "kpi": "Critical consumable stockouts and service disruption",
    "definition": "Critical stockout events and related service disruption, reported by item and root cause; no universal threshold is assumed.",
    "weight": 0.15,
    "targetBasis": "Approved critical inventory plan",
    "review": "Monthly",
    "primaryDataSource": "Inventory system / incident register",
    "keyCollaborator": "DHOs; Clinical Medical Director",
    "definitionFamilies": [
      "Inventory days / obsolete stock"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 89,
    "level": "Group support",
    "role": "Procurement Head",
    "reportsTo": "Chairman",
    "keyDeliverable": "Inventory discipline",
    "kpi": "Inventory days and obsolete stock",
    "definition": "Inventory days and obsolete or expiring stock value measured using the group-approved inventory policy.",
    "weight": 0.15,
    "targetBasis": "Approved inventory plan",
    "review": "Monthly",
    "primaryDataSource": "Inventory system / finance ERP",
    "keyCollaborator": "Group CFO; DHOs",
    "definitionFamilies": [
      "Inventory days / obsolete stock"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 90,
    "level": "Group support",
    "role": "Procurement Head",
    "reportsTo": "Chairman",
    "keyDeliverable": "Service responsiveness",
    "kpi": "Purchase request to purchase-order turnaround",
    "definition": "Median or approved percentile time from complete approved request to issued purchase order.",
    "weight": 0.1,
    "targetBasis": "Approved procurement service level",
    "review": "Monthly",
    "primaryDataSource": "Procurement system",
    "keyCollaborator": "DHOs",
    "definitionFamilies": [
      "Procurement savings"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 91,
    "level": "Group support",
    "role": "Procurement Head",
    "reportsTo": "Chairman",
    "keyDeliverable": "Vendor performance",
    "kpi": "Supplier quality and service-level performance",
    "definition": "Supplier delivery, quality and service performance against approved service levels.",
    "weight": 0.1,
    "targetBasis": "Approved vendor scorecard",
    "review": "Monthly",
    "primaryDataSource": "Procurement system / user feedback",
    "keyCollaborator": "DHOs; Clinical Leads",
    "definitionFamilies": [
      "Procurement savings"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 92,
    "level": "Group support",
    "role": "Procurement Head",
    "reportsTo": "Chairman",
    "keyDeliverable": "Price discipline",
    "kpi": "Rate-card adherence and maverick spend",
    "definition": "Spend at approved prices and outside approved buying channels, reported with remediation actions.",
    "weight": 0.1,
    "targetBasis": "Approved rate-card and compliance standard",
    "review": "Monthly",
    "primaryDataSource": "Procurement system / finance ERP",
    "keyCollaborator": "Group CFO",
    "definitionFamilies": [
      "Procurement savings"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 93,
    "level": "Group support",
    "role": "Procurement Head",
    "reportsTo": "Chairman",
    "keyDeliverable": "Resilience",
    "kpi": "Supplier risk and continuity actions closed",
    "definition": "High-risk supplier continuity actions closed by due date divided by actions due.",
    "weight": 0.1,
    "targetBasis": "Approved supplier-risk plan",
    "review": "Monthly",
    "primaryDataSource": "Supplier risk register",
    "keyCollaborator": "Legal Head; DHOs",
    "definitionFamilies": [
      "Inventory days / obsolete stock"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 94,
    "level": "Group support",
    "role": "HR Head",
    "reportsTo": "Chairman",
    "keyDeliverable": "Workforce economics",
    "kpi": "Group workforce cost and productivity vs plan",
    "definition": "Approved workforce cost and output-per-FTE measures compared with plan, reported by function and facility.",
    "weight": 0.15,
    "targetBasis": "Approved workforce and productivity plan",
    "review": "Monthly",
    "primaryDataSource": "HRIS / payroll / HIS / finance",
    "keyCollaborator": "Group CFO; Regional COOs",
    "definitionFamilies": [
      "Workforce productivity"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 95,
    "level": "Group support",
    "role": "HR Head",
    "reportsTo": "Chairman",
    "keyDeliverable": "Critical talent",
    "kpi": "Critical-role staffing and time to hire",
    "definition": "Critical roles filled divided by approved critical roles, plus time-to-fill for critical vacancies.",
    "weight": 0.15,
    "targetBasis": "Approved workforce plan",
    "review": "Monthly",
    "primaryDataSource": "HRIS / recruitment tracker",
    "keyCollaborator": "People Executives; DHOs",
    "definitionFamilies": [
      "Critical-role attrition"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 96,
    "level": "Group support",
    "role": "HR Head",
    "reportsTo": "Chairman",
    "keyDeliverable": "Retention",
    "kpi": "Group and critical-role attrition",
    "definition": "Voluntary and total attrition, including designated critical roles, compared with approved retention plan.",
    "weight": 0.15,
    "targetBasis": "Approved retention plan",
    "review": "Monthly",
    "primaryDataSource": "HRIS",
    "keyCollaborator": "People Executives; Regional COOs",
    "definitionFamilies": [
      "Critical-role attrition"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 97,
    "level": "Group support",
    "role": "HR Head",
    "reportsTo": "Chairman",
    "keyDeliverable": "Employee experience",
    "kpi": "Group engagement score and action closure",
    "definition": "Approved group engagement score and action-plan completion by due date.",
    "weight": 0.15,
    "targetBasis": "Annual engagement plan",
    "review": "Monthly",
    "primaryDataSource": "Engagement survey / HR tracker",
    "keyCollaborator": "People Executives; Regional COOs",
    "definitionFamilies": [
      "Engagement"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 98,
    "level": "Group support",
    "role": "HR Head",
    "reportsTo": "Chairman",
    "keyDeliverable": "Capability and succession",
    "kpi": "Mandatory learning, capability and succession coverage",
    "definition": "Required workforce meeting learning or capability requirements and critical roles with approved succession coverage.",
    "weight": 0.15,
    "targetBasis": "Approved capability and succession plan",
    "review": "Monthly",
    "primaryDataSource": "LMS / HRIS / medical affairs",
    "keyCollaborator": "Clinical Medical Director",
    "definitionFamilies": [
      "Mandatory learning / credentialing"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 99,
    "level": "Group support",
    "role": "HR Head",
    "reportsTo": "Chairman",
    "keyDeliverable": "Performance culture",
    "kpi": "Performance-management and talent-review completion",
    "definition": "Eligible workforce with completed performance review and current talent review divided by eligible workforce.",
    "weight": 0.1,
    "targetBasis": "Group performance calendar",
    "review": "Monthly",
    "primaryDataSource": "HRIS",
    "keyCollaborator": "People Executives",
    "definitionFamilies": [
      "Mandatory learning / credentialing"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 100,
    "level": "Group support",
    "role": "HR Head",
    "reportsTo": "Chairman",
    "keyDeliverable": "Employment governance",
    "kpi": "Employment compliance and grievance closure",
    "definition": "Employment compliance actions and grievances closed to approved service levels, with material exceptions escalated.",
    "weight": 0.15,
    "targetBasis": "HR compliance calendar",
    "review": "Monthly",
    "primaryDataSource": "HR compliance tracker",
    "keyCollaborator": "Legal Head",
    "definitionFamilies": [
      "Legal and compliance closure"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 101,
    "level": "Group support",
    "role": "Legal Head",
    "reportsTo": "Chairman",
    "keyDeliverable": "Commercial enablement",
    "kpi": "Contract turnaround time",
    "definition": "Median or approved percentile time to complete standard and non-standard contracts, segmented by risk category.",
    "weight": 0.15,
    "targetBasis": "Approved legal service levels",
    "review": "Monthly",
    "primaryDataSource": "Contract lifecycle system",
    "keyCollaborator": "Corporate Revenue & Insurance Lead; Procurement Head",
    "definitionFamilies": [
      "Legal and compliance closure"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 102,
    "level": "Group support",
    "role": "Legal Head",
    "reportsTo": "Chairman",
    "keyDeliverable": "Risk management",
    "kpi": "High-risk contract review and approval compliance",
    "definition": "High-risk agreements receiving required review and approval before execution divided by high-risk agreements executed.",
    "weight": 0.15,
    "targetBasis": "Approved contract approval policy",
    "review": "Monthly",
    "primaryDataSource": "Contract register",
    "keyCollaborator": "Corporate Revenue & Insurance Lead; Procurement Head",
    "definitionFamilies": [
      "Legal and compliance closure"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 103,
    "level": "Group support",
    "role": "Legal Head",
    "reportsTo": "Chairman",
    "keyDeliverable": "Regulatory compliance",
    "kpi": "License, filing and regulatory-calendar compliance",
    "definition": "Required filings, licences and registrations completed or renewed by due date divided by items due.",
    "weight": 0.2,
    "targetBasis": "Approved regulatory calendar",
    "review": "Monthly",
    "primaryDataSource": "Legal compliance register",
    "keyCollaborator": "DHOs; HR Head",
    "definitionFamilies": [
      "Legal and compliance closure"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 104,
    "level": "Group support",
    "role": "Legal Head",
    "reportsTo": "Chairman",
    "keyDeliverable": "Dispute management",
    "kpi": "Material litigation and dispute action milestones",
    "definition": "Material matters with current strategy, owner and action milestones completed by due date; report exposure separately.",
    "weight": 0.15,
    "targetBasis": "Approved legal risk plan",
    "review": "Monthly",
    "primaryDataSource": "Legal matter tracker",
    "keyCollaborator": "Group CFO; Chairman",
    "definitionFamilies": [
      "Legal and compliance closure"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 105,
    "level": "Group support",
    "role": "Legal Head",
    "reportsTo": "Chairman",
    "keyDeliverable": "Revenue protection",
    "kpi": "Commercial and payer dispute support turnaround",
    "definition": "Commercial or payer disputes supported within agreed service levels, with recovery or avoidance value reported where validated.",
    "weight": 0.1,
    "targetBasis": "Approved legal service levels",
    "review": "Monthly",
    "primaryDataSource": "Legal matter tracker / billing tracker",
    "keyCollaborator": "Billing & Revenue Leads; Corporate Revenue & Insurance Lead",
    "definitionFamilies": [
      "Legal and compliance closure"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 106,
    "level": "Group support",
    "role": "Legal Head",
    "reportsTo": "Chairman",
    "keyDeliverable": "Policy governance",
    "kpi": "Policy refresh and required legal training completion",
    "definition": "Policies due for review refreshed and required legal or compliance learning completed by required employees.",
    "weight": 0.1,
    "targetBasis": "Policy calendar and training plan",
    "review": "Monthly",
    "primaryDataSource": "Policy register / LMS",
    "keyCollaborator": "HR Head",
    "definitionFamilies": [
      "Legal and compliance closure"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 107,
    "level": "Group support",
    "role": "Legal Head",
    "reportsTo": "Chairman",
    "keyDeliverable": "Assurance",
    "kpi": "Governance and audit legal actions closed",
    "definition": "Legal, governance and audit actions closed by due date divided by actions due, with critical exceptions escalated.",
    "weight": 0.15,
    "targetBasis": "Governance action plan",
    "review": "Monthly",
    "primaryDataSource": "Governance tracker / audit tracker",
    "keyCollaborator": "Chairman; Group CFO",
    "definitionFamilies": [
      "Legal and compliance closure"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 108,
    "level": "Group support",
    "role": "Head of Analytics & Digital Transformation",
    "reportsTo": "Chairman",
    "keyDeliverable": "Reliable decision support",
    "kpi": "KPI dashboard availability and refresh on time",
    "definition": "Critical approved dashboards available and refreshed to the agreed timetable divided by dashboards due.",
    "weight": 0.15,
    "targetBasis": "Approved reporting calendar and service level",
    "review": "Monthly",
    "primaryDataSource": "BI platform / data operations log",
    "keyCollaborator": "All executive owners",
    "definitionFamilies": [
      "KPI data quality"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 109,
    "level": "Group support",
    "role": "Head of Analytics & Digital Transformation",
    "reportsTo": "Chairman",
    "keyDeliverable": "Trusted data",
    "kpi": "KPI data quality and reconciliation",
    "definition": "Critical KPI data meeting defined completeness, consistency and finance or source-system reconciliation checks.",
    "weight": 0.2,
    "targetBasis": "Approved data-quality standards",
    "review": "Monthly",
    "primaryDataSource": "Data-quality controls / finance reconciliation",
    "keyCollaborator": "Group CFO; Billing & Revenue Leads",
    "definitionFamilies": [
      "KPI data quality"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 110,
    "level": "Group support",
    "role": "Head of Analytics & Digital Transformation",
    "reportsTo": "Chairman",
    "keyDeliverable": "Timely management information",
    "kpi": "Monthly KPI pack delivered to calendar",
    "definition": "Monthly management KPI pack delivered complete and accurate by the agreed date divided by packs due.",
    "weight": 0.15,
    "targetBasis": "Group reporting calendar",
    "review": "Monthly",
    "primaryDataSource": "BI platform / reporting calendar",
    "keyCollaborator": "Chairman; Group CFO",
    "definitionFamilies": [
      "KPI data quality"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 111,
    "level": "Group support",
    "role": "Head of Analytics & Digital Transformation",
    "reportsTo": "Chairman",
    "keyDeliverable": "Adoption",
    "kpi": "Priority dashboard adoption and report rationalisation",
    "definition": "Target users actively using priority dashboards and retirement of duplicate manual reports against plan.",
    "weight": 0.1,
    "targetBasis": "Approved analytics adoption plan",
    "review": "Monthly",
    "primaryDataSource": "BI usage logs / report inventory",
    "keyCollaborator": "All executive owners",
    "definitionFamilies": [
      "KPI data quality"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 112,
    "level": "Group support",
    "role": "Head of Analytics & Digital Transformation",
    "reportsTo": "Chairman",
    "keyDeliverable": "Forecast support",
    "kpi": "Revenue, collections and cash forecast accuracy",
    "definition": "Approved forecast accuracy measure comparing forecast with actual revenue, collections and cash over the agreed horizon.",
    "weight": 0.15,
    "targetBasis": "Finance planning accuracy standard",
    "review": "Monthly",
    "primaryDataSource": "BI platform / finance ERP",
    "keyCollaborator": "Group CFO; Regional COOs",
    "definitionFamilies": [
      "Collections"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 113,
    "level": "Group support",
    "role": "Head of Analytics & Digital Transformation",
    "reportsTo": "Chairman",
    "keyDeliverable": "Actionable insight",
    "kpi": "Approved insight actions closed",
    "definition": "Prioritised data-led actions accepted by owners and closed by due date divided by actions due.",
    "weight": 0.1,
    "targetBasis": "Approved insight-action plan",
    "review": "Monthly",
    "primaryDataSource": "Analytics action tracker",
    "keyCollaborator": "Regional COOs; DHOs",
    "definitionFamilies": [
      "KPI data quality"
    ],
    "unresolvedReason": null
  },
  {
    "sourceRow": 114,
    "level": "Group support",
    "role": "Head of Analytics & Digital Transformation",
    "reportsTo": "Chairman",
    "keyDeliverable": "Digital value",
    "kpi": "Digital roadmap and benefit realisation",
    "definition": "Approved digital milestones delivered and finance-validated benefits realised versus business case.",
    "weight": 0.15,
    "targetBasis": "Approved digital roadmap and business cases",
    "review": "Monthly",
    "primaryDataSource": "Project portfolio / finance",
    "keyCollaborator": "Chairman; Group CFO",
    "definitionFamilies": [
      "Forecast accuracy"
    ],
    "unresolvedReason": null
  }
] as const;
