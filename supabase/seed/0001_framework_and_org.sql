-- =========================================================================
-- 0001_framework_and_org.sql
--
-- GENERATED FILE — DO NOT EDIT BY HAND.
-- Produced by packages/data-gen/scripts/generate-seed.ts
-- Regenerate with: npm run generate --workspace=@orbit/data-gen
--
-- Framework source : Africare_Group_KPI_Framework.xlsx
-- Framework version: v1
-- Source checksum  : 2562c5b179077037300b7ae8908c476c515d1904571d526c9764ece00590d046
-- Company manifest : v1 (seed 20260923)
--
-- Idempotent: safe to re-run. Contains no memberships, no facts, and no KPI
-- observations — see the script header for why each is excluded.
-- =========================================================================

begin;

-- Framework version -------------------------------------------------------
insert into orbit.framework_versions
  (version, source_file_name, source_checksum, role_count, assignment_count,
   definition_count, is_current)
values (
  'v1',
  'Africare_Group_KPI_Framework.xlsx',
  '2562c5b179077037300b7ae8908c476c515d1904571d526c9764ece00590d046',
  14, 109,
  29, true
)
on conflict (version) do nothing;

-- Resolved once and reused below, so the seed never depends on a literal id.
create temp table _fv on commit drop as
  select id from orbit.framework_versions where version = 'v1';

-- Canonical role slugs (version-independent) -----------------------------
insert into orbit.role_ids (role_id) values
  ('chairman'),
  ('clinical-director'),
  ('regional-coo'),
  ('hospital-dho'),
  ('people-executive'),
  ('bd-lead'),
  ('billing-lead'),
  ('coe-lead'),
  ('corporate-revenue-lead'),
  ('group-cfo'),
  ('procurement-head'),
  ('hr-head'),
  ('legal-head'),
  ('analytics-head')
on conflict (role_id) do nothing;

-- Roles (versioned detail) ------------------------------------------------
insert into orbit.roles
  (framework_version_id, role_id, name, level, reports_to, deployment,
   primary_focus, cadence, kpi_count)
select fv.id, v.* from _fv fv, (values
  ('chairman', 'Chairman', 'Group governance', 'Board / shareholders', '1 group role', 'Enterprise value, risk and strategic direction', 'Monthly / quarterly', 7),
  ('clinical-director', 'Chief / Group Clinical Medical Director', 'Group clinical leadership', 'Chairman', '1 group role', 'Clinical governance, COEs, corporate clinical propositions', 'Monthly / quarterly clinical review', 8),
  ('regional-coo', 'Regional COO', 'Regional management', 'Chairman', '2 roles; 3 hospitals each', 'Regional P&L, operations, patient experience and growth', 'Monthly', 9),
  ('hospital-dho', 'Hospital DHO', 'Hospital leadership', 'Regional COO', '6 roles; one per hospital', 'Hospital P&L, operations, people and revenue cycle', 'Monthly', 9),
  ('people-executive', 'People Executive', 'Hospital functional leadership', 'Hospital DHO', '6 roles; one per hospital', 'Workforce readiness, engagement, compliance and productivity', 'Monthly', 8),
  ('bd-lead', 'Business Development Lead', 'Hospital functional leadership', 'Hospital DHO', '6 roles; one per hospital', 'Demand, referrals, service-line and channel growth', 'Weekly / monthly', 8),
  ('billing-lead', 'Billing & Revenue Lead', 'Hospital functional leadership', 'Hospital DHO', '6 roles; one per hospital', 'Billing quality, claims, collections and receivables', 'Weekly / monthly', 8),
  ('coe-lead', 'COE Lead', 'Clinical growth', 'Clinical Medical Director', 'As approved by COE plan', 'COE care, outcomes, capacity and contribution', 'Monthly', 8),
  ('corporate-revenue-lead', 'Corporate Revenue & Insurance Lead', 'Commercial growth', 'Clinical Medical Director', '1 group role', 'Corporate and insurer contracts, activation and yield', 'Monthly', 8),
  ('group-cfo', 'Group CFO', 'Group support', 'Chairman', '1 group role', 'Profitability, cash, planning, controls and compliance', 'Monthly', 7),
  ('procurement-head', 'Procurement Head', 'Group support', 'Chairman', '1 group role', 'Cost, supply continuity, inventory and vendor performance', 'Monthly', 8),
  ('hr-head', 'HR Head', 'Group support', 'Chairman', '1 group role', 'Workforce economics, talent, engagement and employment governance', 'Monthly / quarterly', 7),
  ('legal-head', 'Legal Head', 'Group support', 'Chairman', '1 group role', 'Contract enablement, legal risk and compliance', 'Monthly / quarterly', 7),
  ('analytics-head', 'Head of Analytics & Digital Transformation', 'Group support', 'Chairman', '1 group role', 'Trusted data, performance insight and digital value', 'Monthly', 7)
) as v(role_id, name, level, reports_to, deployment, primary_focus, cadence, kpi_count)
on conflict (framework_version_id, role_id) do nothing;

-- KPI definition families (29) -------------------------------------------
insert into orbit.kpi_definitions
  (framework_version_id, family, standard_definition,
   numerator_denominator_control, target_steward, primary_source, notes, source_row)
select fv.id, v.* from _fv fv, (values
  ('Net revenue', 'Finance-approved gross billable revenue less approved discounts, contractual adjustments and other finance-defined deductions.', 'Use the same approved accounting definition at hospital, regional and group levels.', 'Group CFO', 'Finance ERP / management accounts', 'Do not mix gross billings with net revenue.', 6),
  ('EBITDA', 'Finance-approved earnings before interest, tax, depreciation and amortisation under the group chart of accounts.', 'Reconcile hospital and regional views to the Group CFO''s official close.', 'Group CFO', 'Finance ERP / management accounts', 'Exclude unapproved management adjustments.', 7),
  ('Operating cash flow', 'Cash generated from operating activities measured against the approved cash plan.', 'Use Finance-approved classification and reconcile to treasury.', 'Group CFO', 'Treasury / finance ERP', 'Report liquidity headroom separately.', 8),
  ('Collections', 'Cash posted and reconciled during the period compared with approved collection plan.', 'Include only reconciled cash. Separate recoveries, advances and unidentified cash where material.', 'Group CFO', 'Billing system / finance ERP', 'Track by payer and facility.', 9),
  ('DSO', 'Closing trade receivables divided by trailing net revenue, multiplied by the group-approved day convention.', 'Use one group DSO formula and exclude non-trade balances consistently.', 'Group CFO', 'Finance ERP', 'Always show ageing alongside DSO.', 10),
  ('Capacity utilisation', 'Used approved capacity divided by available approved capacity for the same service line and period.', 'Use staffed bed days, appointment slots, equipment hours or other approved service-specific capacity. Do not combine unlike units.', 'Regional COO', 'HIS / scheduling / equipment log', 'State capacity unit in every report.', 11),
  ('Patient throughput', 'Completed patient activity measured using the approved encounter, admission, procedure or visit definition.', 'Count each activity once according to the defined reporting unit.', 'Regional COO', 'HIS', 'Separate hospitals, clinics and service lines when definitions differ.', 12),
  ('Referral conversion', 'Eligible referrals completing the intended next consultation, admission or procedure divided by eligible referrals.', 'Define eligible referrals and completion event before reporting.', 'Clinical Medical Director', 'HIS / referral tracker', 'Report internal and external referral sources separately.', 13),
  ('Patient experience', 'Approved survey composite, reported with response rate and complaint context.', 'Use the approved survey population, scoring scale and response-rate threshold.', 'Regional COO', 'Patient feedback platform', 'Do not compare surveys with changed methods without disclosure.', 14),
  ('Complaint CAPA closure', 'Complaints or adverse feedback corrective actions closed by due date divided by actions due.', 'Critical complaints remain separately visible until resolved.', 'Hospital DHO', 'Complaint register / quality tracker', 'Closure must include effectiveness verification where required.', 15),
  ('Clinical quality scorecard', 'Approved clinical quality composite using documented indicators, reporting period, case mix and exception rules.', 'Maintain definitions and denominators in the clinical governance policy.', 'Clinical Medical Director', 'Quality system / HIS / clinical audit', 'No universal clinical threshold is assumed here.', 16),
  ('Serious adverse events', 'Serious events rate and required review / corrective-action completion under the approved incident policy.', 'Use the approved event taxonomy, exposure denominator and risk adjustment where applicable.', 'Clinical Medical Director', 'Incident reporting system', 'Never use raw counts alone for comparison.', 17),
  ('Protocol compliance', 'Compliant audited cases divided by audited cases under the approved protocol and audit plan.', 'Retain sample, eligibility and audit method; show critical findings separately.', 'Clinical Medical Director', 'Clinical audit system', 'Use service-line-specific standards.', 18),
  ('First-pass claim acceptance', 'Claims accepted without rework or resubmission divided by claims submitted.', 'Use payer acceptance status captured in the billing or payer system.', 'Billing & Revenue Lead', 'Billing system / payer portals', 'Segment by payer and rejection reason.', 19),
  ('Denied or rejected claim value', 'Denied or rejected claim value divided by submitted claim value.', 'Use the approved payer status and distinguish temporary rejection from final denial.', 'Billing & Revenue Lead', 'Billing system / payer portals', 'Show root cause and recovery status.', 20),
  ('Unbilled revenue', 'Completed services recorded in source systems but not invoiced or claimed, valued under the group-approved method.', 'Define completion and billing cut-off consistently.', 'Billing & Revenue Lead', 'HIS / billing system / finance ERP', 'Report by age and accountable resolver.', 21),
  ('Engagement', 'Approved employee-engagement score and action-plan closure.', 'Use defined survey population, response rate and scoring approach.', 'HR Head', 'Engagement survey / HR tracker', 'Compare only like survey methods.', 22),
  ('Critical-role attrition', 'Voluntary and total exits in designated critical roles divided by average headcount in those roles.', 'Maintain an approved critical-role list and use average headcount consistently.', 'HR Head', 'HRIS', 'Show regretted attrition separately if defined.', 23),
  ('Mandatory learning / credentialing', 'Required staff completing mandatory learning or holding current credentials divided by required staff.', 'Use approved requirements by role and current roster.', 'HR Head / Clinical Medical Director', 'LMS / HRIS / medical affairs', 'Expired credentials require exception reporting.', 24),
  ('Workforce productivity', 'Approved output measure divided by paid FTE or paid hours, by function.', 'Use function-specific output units and comparable roster / paid-hour definitions.', 'HR Head', 'HRIS / HIS / roster', 'Do not compare clinical and non-clinical functions using one unit.', 25),
  ('New business revenue', 'Finance-approved net revenue attributable to an approved new channel, service, campaign or account.', 'Apply documented CRM attribution and finance reconciliation.', 'Business Development Lead', 'CRM / HIS / finance', 'Separate pipeline from realised revenue.', 26),
  ('Qualified pipeline', 'Documented opportunity value meeting the approved qualification criteria.', 'Use stage, probability and expected close-date rules consistently.', 'Business Development Lead', 'CRM', 'Do not count duplicate opportunities.', 27),
  ('COE contribution', 'Finance-approved COE revenue less approved direct costs, or EBITDA, as defined in the COE plan.', 'Use one approved COE contribution definition and allocate shared costs consistently.', 'Group CFO', 'Finance ERP / management accounts', 'State whether contribution margin or EBITDA is reported.', 28),
  ('Contract utilisation', 'Actual use of contracted services divided by the approved account expectation or contracted access base.', 'Use the contract-specific denominator and valid active-account population.', 'Corporate Revenue & Insurance Lead', 'Contract register / HIS / finance', 'Report by account and contract type.', 29),
  ('Procurement savings', 'Finance-validated difference between approved baseline and actual purchase cost for comparable volume and specification.', 'Use a documented baseline; separate savings, cost avoidance and price variance.', 'Procurement Head', 'Procurement system / finance ERP', 'No benefit without Finance validation.', 30),
  ('Inventory days / obsolete stock', 'Inventory value divided by relevant consumption under the group-approved inventory convention; obsolete or expiring stock valued separately.', 'Use consistent valuation and consumption period.', 'Procurement Head', 'Inventory system / finance ERP', 'Critical stockouts are reported separately.', 31),
  ('Legal and compliance closure', 'Required legal, licence, filing, governance or audit actions closed by due date divided by actions due.', 'Maintain a controlled action register with risk rating, owner and due date.', 'Legal Head', 'Legal / governance / audit tracker', 'Critical exceptions must be escalated, not averaged away.', 32),
  ('KPI data quality', 'Critical KPI records meeting approved completeness, consistency, timeliness and reconciliation checks.', 'Define each check and source-of-truth system before publication.', 'Head of Analytics & Digital Transformation', 'Data-quality controls / finance reconciliation', 'Data-quality status should accompany the KPI pack.', 33),
  ('Forecast accuracy', 'Difference between approved forecast and actual measured under the agreed error method and time horizon.', 'Use the same horizon, actual close and error definition for each reporting cycle.', 'Group CFO', 'FP&A / BI platform', 'Report bias as well as absolute accuracy where approved.', 34)
) as v(family, standard_definition, numerator_denominator_control,
       target_steward, primary_source, notes, source_row)
on conflict (framework_version_id, family) do nothing;

-- Role-KPI assignments (109) ---------------------------------------------
insert into orbit.role_kpi_assignments
  (framework_version_id, assignment_id, role_id, kpi, key_deliverable, definition,
   weight, target_basis, review, primary_data_source, key_collaborator, source_row)
select fv.id, v.* from _fv fv, (values
  ('chairman:group-net-revenue-vs-approved-budget', 'chairman', 'Group net revenue vs approved budget', 'Profitable group growth', 'Finance-approved group net revenue for the period divided by the approved budget for the same period.', 0.2, 'Board-approved annual and monthly budget', 'Monthly', 'Finance ERP / management accounts', 'Group CFO; Regional COOs', 6),
  ('chairman:group-ebitda-vs-approved-budget', 'chairman', 'Group EBITDA vs approved budget', 'Profitable group growth', 'Finance-approved group EBITDA compared with approved budget, using one group accounting definition.', 0.2, 'Board-approved EBITDA plan', 'Monthly', 'Finance ERP / management accounts', 'Group CFO; Regional COOs', 7),
  ('chairman:operating-cash-flow-and-working-capital-vs-plan', 'chairman', 'Operating cash flow and working capital vs plan', 'Financial sustainability', 'Operating cash flow and working-capital position compared with the approved cash plan.', 0.15, 'Board-approved cash-flow plan', 'Monthly', 'Treasury / finance ERP', 'Group CFO; Billing & Revenue Leads', 8),
  ('chairman:group-clinical-quality-and-safety-index', 'chairman', 'Group clinical quality and safety index', 'Safe, effective clinical care', 'Approved clinical-quality composite, reported with its approved component definitions and risk adjustment where applicable.', 0.15, 'Board-approved clinical quality plan', 'Monthly', 'Quality system / HIS / clinical audit', 'Chief / Group Clinical Medical Director', 9),
  ('chairman:group-patient-experience-index', 'chairman', 'Group patient experience index', 'Patient-centred care', 'Approved patient-experience survey composite for hospitals and clinics, with response-rate context.', 0.1, 'Annual patient-experience plan', 'Monthly', 'Patient feedback platform / complaint register', 'Regional COOs; DHOs', 10),
  ('chairman:coe-corporate-and-expansion-milestones', 'chairman', 'COE, corporate and expansion milestones', 'Strategic growth', 'Share of Board-approved growth milestones completed on time and to approved financial and clinical cases.', 0.1, 'Board-approved strategic plan', 'Monthly', 'Strategy tracker / finance / CRM', 'Clinical Medical Director; Corporate Revenue & Insurance Lead', 11),
  ('chairman:critical-governance-legal-and-audit-actions-closed', 'chairman', 'Critical governance, legal and audit actions closed', 'Governance and resilience', 'Critical actions closed by the agreed due date divided by critical actions due in the period.', 0.1, 'Board governance calendar', 'Monthly', 'Governance tracker / legal register / audit tracker', 'Legal Head; Group CFO; HR Head', 12),
  ('clinical-director:clinical-quality-scorecard', 'clinical-director', 'Clinical quality scorecard', 'Clinical governance', 'Approved clinical-quality composite across the group, using documented indicators and valid denominators.', 0.2, 'Approved annual clinical-quality plan', 'Monthly', 'Quality system / HIS / clinical audit', 'Regional COOs; CoE Leads', 13),
  ('clinical-director:serious-adverse-event-rate-and-review-closure', 'clinical-director', 'Serious adverse-event rate and review closure', 'Clinical safety', 'Risk-adjusted serious adverse events, together with completion of required reviews and corrective actions.', 0.15, 'Clinical governance plan and approved thresholds', 'Monthly', 'Incident reporting system / quality register', 'DHOs; CoE Leads', 14),
  ('clinical-director:protocol-compliance-and-critical-audit-closure', 'clinical-director', 'Protocol compliance and critical audit closure', 'Standardised practice', 'Compliance with approved protocols and clinical-audit critical actions closed by due date.', 0.15, 'Approved protocol and audit plan', 'Monthly', 'Clinical audit / quality system', 'CoE Leads; DHOs', 15),
  ('clinical-director:clinical-patient-experience-score', 'clinical-director', 'Clinical patient experience score', 'Clinical patient experience', 'Approved clinical-care experience score, reported with response rate and service-line context.', 0.1, 'Annual patient-experience plan', 'Monthly', 'Patient feedback platform', 'Regional COOs; DHOs', 16),
  ('clinical-director:medical-credentialing-and-capability-completion', 'clinical-director', 'Medical credentialing and capability completion', 'Medical capability', 'Required medical staff with current credentials and completed competency requirements divided by total required staff.', 0.1, 'Medical workforce and credentialing plan', 'Monthly', 'Medical affairs / HRIS', 'HR Head; People Executives', 17),
  ('clinical-director:coe-revenue-and-contribution-vs-plan', 'clinical-director', 'COE revenue and contribution vs plan', 'Centres of Excellence', 'Finance-approved revenue and contribution from Board-approved COE programmes compared with plan.', 0.12, 'Approved COE business plan', 'Monthly', 'Finance ERP / HIS', 'CoE Leads; Group CFO', 18),
  ('clinical-director:clinical-propositions-converted-to-revenue', 'clinical-director', 'Clinical propositions converted to revenue', 'Corporate and insurer solutions', 'Approved corporate or insurer clinical propositions launched and generating revenue compared with plan.', 0.1, 'Corporate and insurer growth plan', 'Monthly', 'CRM / contract register / finance', 'Corporate Revenue & Insurance Lead', 19),
  ('clinical-director:priority-care-referral-conversion', 'clinical-director', 'Priority-care referral conversion', 'Continuum of care', 'Eligible internal or external referrals completing the intended consultation, admission or procedure divided by eligible referrals.', 0.08, 'Service-line growth plan', 'Monthly', 'HIS / referral tracker', 'Regional COOs; DHOs', 20),
  ('regional-coo:regional-net-revenue-vs-approved-budget', 'regional-coo', 'Regional net revenue vs approved budget', 'Regional financial performance', 'Finance-approved regional net revenue compared with the approved budget for the period.', 0.15, 'Approved regional monthly budget', 'Monthly', 'Finance ERP / management accounts', 'DHOs; Group CFO', 21),
  ('regional-coo:regional-ebitda-vs-approved-budget', 'regional-coo', 'Regional EBITDA vs approved budget', 'Regional financial performance', 'Finance-approved regional EBITDA compared with the approved budget for the period.', 0.15, 'Approved regional monthly budget', 'Monthly', 'Finance ERP / management accounts', 'DHOs; Group CFO', 22),
  ('regional-coo:hospital-and-clinic-capacity-utilisation', 'regional-coo', 'Hospital and clinic capacity utilisation', 'Capacity and throughput', 'Service-line utilisation using staffed bed days, appointment slots, equipment hours or other approved capacity denominators; do not aggregate unlike units.', 0.1, 'Approved capacity plan by service line', 'Monthly', 'HIS / scheduling / equipment logs', 'DHOs', 23),
  ('regional-coo:patient-volume-and-referral-conversion', 'regional-coo', 'Patient volume and referral conversion', 'Demand and continuity', 'Patient volume compared with plan and eligible referrals completing the intended next service divided by eligible referrals.', 0.1, 'Regional volume and referral plan', 'Monthly', 'HIS / referral tracker', 'DHOs; Business Development Leads', 24),
  ('regional-coo:collections-and-dso-vs-plan', 'regional-coo', 'Collections and DSO vs plan', 'Cash conversion', 'Cash collections versus plan and debtor days using the group-approved DSO calculation.', 0.12, 'Approved cash and collections plan', 'Monthly', 'Billing system / finance ERP', 'Billing & Revenue Leads; Group CFO', 25),
  ('regional-coo:claim-clean-rate-and-denial-value', 'regional-coo', 'Claim clean rate and denial value', 'Revenue-cycle discipline', 'First-pass accepted claims divided by submitted claims, and rejected or denied claim value divided by submitted claim value.', 0.1, 'Approved revenue-cycle targets', 'Monthly', 'Billing / payer portals', 'Billing & Revenue Leads', 26),
  ('regional-coo:patient-experience-and-capa-closure', 'regional-coo', 'Patient experience and CAPA closure', 'Patient-centred operations', 'Approved patient-experience score and complaints or adverse feedback corrective actions closed by due date.', 0.1, 'Annual patient-experience and quality plan', 'Monthly', 'Feedback platform / complaint register', 'DHOs', 27),
  ('regional-coo:engagement-and-critical-role-retention', 'regional-coo', 'Engagement and critical-role retention', 'People performance', 'Approved engagement score and retention of designated critical roles, reported by hospital.', 0.08, 'Regional people plan', 'Monthly', 'HRIS / engagement survey', 'People Executives; HR Head', 28),
  ('regional-coo:new-service-coe-and-corporate-revenue-vs-plan', 'regional-coo', 'New service, COE and corporate revenue vs plan', 'Growth initiatives', 'Finance-approved revenue from approved new services, COE programmes and corporate channels versus plan.', 0.1, 'Regional growth plan', 'Monthly', 'Finance ERP / CRM / HIS', 'DHOs; Clinical Medical Director', 29),
  ('hospital-dho:hospital-net-revenue-vs-approved-budget', 'hospital-dho', 'Hospital net revenue vs approved budget', 'Facility financial performance', 'Finance-approved hospital net revenue compared with approved budget for the period.', 0.15, 'Approved hospital monthly budget', 'Monthly', 'Finance ERP / management accounts', 'Billing & Revenue Lead; Business Development Lead', 30),
  ('hospital-dho:hospital-ebitda-vs-approved-budget', 'hospital-dho', 'Hospital EBITDA vs approved budget', 'Facility financial performance', 'Finance-approved hospital EBITDA compared with approved budget for the period.', 0.12, 'Approved hospital monthly budget', 'Monthly', 'Finance ERP / management accounts', 'Regional COO; Group CFO', 31),
  ('hospital-dho:capacity-utilisation-and-patient-throughput', 'hospital-dho', 'Capacity utilisation and patient throughput', 'Capacity and operations', 'Service-line utilisation against approved capacity and completed patient throughput versus plan, using consistent local definitions.', 0.12, 'Hospital capacity and volume plan', 'Monthly', 'HIS / scheduling / equipment logs', 'Service Heads', 32),
  ('hospital-dho:referral-conversion-and-new-service-revenue', 'hospital-dho', 'Referral conversion and new service revenue', 'Growth and referrals', 'Eligible referrals completing the intended service divided by eligible referrals, plus net revenue from approved new services.', 0.1, 'Hospital growth plan', 'Monthly', 'HIS / CRM / finance', 'Business Development Lead; Clinical Leads', 33),
  ('hospital-dho:patient-experience-and-complaint-capa-closure', 'hospital-dho', 'Patient experience and complaint CAPA closure', 'Patient experience', 'Approved non-clinical patient-experience score and complaints or adverse feedback actions closed by due date.', 0.1, 'Annual patient-experience plan', 'Monthly', 'Feedback platform / complaint register', 'Facility team; Regional COO', 34),
  ('hospital-dho:collections-dso-and-unbilled-revenue', 'hospital-dho', 'Collections, DSO and unbilled revenue', 'Cash conversion', 'Cash collections versus plan, debtor days and completed services not yet billed, using group-approved definitions.', 0.12, 'Hospital cash and collections plan', 'Monthly', 'Billing system / finance ERP', 'Billing & Revenue Lead', 35),
  ('hospital-dho:claim-first-pass-acceptance-and-rejection-value', 'hospital-dho', 'Claim first-pass acceptance and rejection value', 'Revenue-cycle quality', 'Claims accepted at first submission divided by submitted claims, plus rejected or denied claim value divided by submitted value.', 0.1, 'Approved revenue-cycle targets', 'Monthly', 'Billing / payer portals', 'Billing & Revenue Lead', 36),
  ('hospital-dho:people-productivity-engagement-and-critical-attrition', 'hospital-dho', 'People productivity, engagement and critical attrition', 'People effectiveness', 'Approved output-per-FTE measures by function, engagement score and attrition among designated critical roles.', 0.1, 'Hospital people plan', 'Monthly', 'HRIS / HIS / roster data', 'People Executive', 37),
  ('hospital-dho:facility-readiness-licensure-and-safety-actions', 'hospital-dho', 'Facility readiness, licensure and safety actions', 'Operational readiness', 'Critical operational, safety, licensure and facility actions closed by due date; report exceptions separately.', 0.09, 'Hospital compliance and maintenance plan', 'Monthly', 'Facilities / compliance tracker', 'Facilities; Legal Head', 38),
  ('people-executive:approved-position-fill-rate-and-time-to-fill', 'people-executive', 'Approved position fill rate and time to fill', 'Staffing readiness', 'Approved positions filled divided by approved positions, plus median or approved time-to-fill for critical vacancies.', 0.15, 'Approved workforce plan', 'Monthly', 'HRIS / recruitment tracker', 'Hospital DHO; HR Head', 39),
  ('people-executive:roster-adherence-and-labour-productivity', 'people-executive', 'Roster adherence and labour productivity', 'Workforce productivity', 'Rostered staffing delivered versus approved roster, and approved output-per-paid-FTE measures by function.', 0.15, 'Approved staffing and productivity plan', 'Monthly', 'HRIS / roster / HIS', 'Hospital DHO', 40),
  ('people-executive:critical-role-attrition', 'people-executive', 'Critical-role attrition', 'Retention', 'Voluntary and total attrition among designated critical roles compared with the approved retention plan.', 0.15, 'Approved people plan', 'Monthly', 'HRIS', 'Hospital DHO; HR Head', 41),
  ('people-executive:engagement-score-and-action-closure', 'people-executive', 'Engagement score and action closure', 'Employee experience', 'Approved engagement survey score and action-plan items closed by due date.', 0.15, 'Annual engagement plan', 'Monthly', 'Engagement survey / HR action tracker', 'Hospital DHO', 42),
  ('people-executive:performance-review-and-talent-matrix-completion', 'people-executive', 'Performance review and talent-matrix completion', 'Performance management', 'Eligible employees with completed performance review and current talent assessment divided by eligible employees.', 0.1, 'Group performance calendar', 'Monthly', 'HRIS', 'HR Head', 43),
  ('people-executive:mandatory-training-and-credentialing-completion', 'people-executive', 'Mandatory training and credentialing completion', 'Compliance and capability', 'Required employees with completed mandatory learning and current role credentials divided by required employees.', 0.15, 'Approved training and credentialing plan', 'Monthly', 'LMS / HRIS / medical affairs', 'Clinical Medical Director; Hospital DHO', 44),
  ('people-executive:hr-and-statutory-actions-closed-on-time', 'people-executive', 'HR and statutory actions closed on time', 'Employment compliance', 'Required HR, employee-relations and statutory actions closed by due date divided by actions due.', 0.1, 'HR compliance calendar', 'Monthly', 'HR compliance tracker', 'HR Head; Legal Head', 45),
  ('people-executive:manpower-cost-vs-plan', 'people-executive', 'Manpower cost vs plan', 'Cost discipline', 'Approved manpower cost for the facility compared with budget, with vacancy and overtime context.', 0.05, 'Approved manpower budget', 'Monthly', 'Payroll / finance ERP', 'Hospital DHO; Group CFO', 46),
  ('bd-lead:new-business-revenue-vs-plan', 'bd-lead', 'New business revenue vs plan', 'New demand generation', 'Finance-approved revenue attributable to approved business-development channels or campaigns versus plan.', 0.2, 'Hospital growth plan', 'Monthly', 'CRM / HIS / finance', 'Hospital DHO', 47),
  ('bd-lead:qualified-pipeline-coverage', 'bd-lead', 'Qualified pipeline coverage', 'Pipeline health', 'Qualified, documented revenue pipeline compared with the approved future-period pipeline requirement.', 0.1, 'Approved pipeline coverage requirement', 'Monthly', 'CRM', 'Hospital DHO', 48),
  ('bd-lead:lead-to-revenue-conversion', 'bd-lead', 'Lead-to-revenue conversion', 'Conversion', 'Qualified leads that generate a completed billable service or contract divided by qualified leads, using CRM attribution rules.', 0.15, 'Hospital conversion plan', 'Monthly', 'CRM / HIS', 'Hospital DHO; Billing & Revenue Lead', 49),
  ('bd-lead:active-referrer-network-and-referral-revenue', 'bd-lead', 'Active referrer network and referral revenue', 'Referrer ecosystem', 'Active referrers meeting the approved activity criterion and finance-approved revenue from their referrals.', 0.15, 'Referrer network plan', 'Monthly', 'CRM / HIS / finance', 'Clinical Leads; Hospital DHO', 50),
  ('bd-lead:new-service-and-coe-lead-conversion', 'bd-lead', 'New-service and COE lead conversion', 'COE and service development', 'Qualified leads for approved new services or COEs that convert to completed service or revenue.', 0.15, 'COE and service-line growth plan', 'Monthly', 'CRM / HIS', 'CoE Lead; Clinical Medical Director', 51),
  ('bd-lead:corporate-opportunities-handed-over-and-accepted', 'bd-lead', 'Corporate opportunities handed over and accepted', 'Corporate channel support', 'Qualified corporate opportunities formally accepted by the Corporate Revenue & Insurance team divided by qualified handovers.', 0.1, 'Corporate opportunity plan', 'Monthly', 'CRM', 'Corporate Revenue & Insurance Lead', 52),
  ('bd-lead:crm-completeness-and-forecast-accuracy', 'bd-lead', 'CRM completeness and forecast accuracy', 'Forecast discipline', 'Required CRM fields complete for active opportunities and forecast compared with realised attributed revenue.', 0.05, 'CRM data-quality standard', 'Monthly', 'CRM / analytics', 'Head of Analytics & Digital Transformation', 53),
  ('bd-lead:acquisition-economics-vs-plan', 'bd-lead', 'Acquisition economics vs plan', 'Channel effectiveness', 'Approved acquisition cost and attributable new revenue compared with channel plan; use finance-approved attribution.', 0.1, 'Approved channel plan', 'Monthly', 'CRM / finance', 'Hospital DHO; Group CFO', 54),
  ('billing-lead:claim-first-pass-acceptance-rate', 'billing-lead', 'Claim first-pass acceptance rate', 'Clean billing', 'Claims accepted without resubmission divided by claims submitted in the period.', 0.15, 'Approved revenue-cycle target', 'Monthly', 'Billing system / payer portals', 'Hospital DHO; Clinical documentation owners', 55),
  ('billing-lead:claim-submission-turnaround-time', 'billing-lead', 'Claim submission turnaround time', 'Timely submission', 'Median or approved percentile days from discharge or service completion to complete claim submission.', 0.1, 'Approved revenue-cycle target', 'Monthly', 'Billing system / HIS', 'Clinical documentation owners', 56),
  ('billing-lead:rejected-or-denied-claim-value', 'billing-lead', 'Rejected or denied claim value', 'Denial reduction', 'Rejected or denied claim value divided by submitted claim value, reported by payer and root cause.', 0.15, 'Approved denial-reduction plan', 'Monthly', 'Billing system / payer portals', 'Hospital DHO; Corporate Revenue & Insurance Lead', 57),
  ('billing-lead:cash-collections-vs-monthly-plan', 'billing-lead', 'Cash collections vs monthly plan', 'Cash collection', 'Cash posted and reconciled in the period compared with approved monthly collection plan.', 0.15, 'Approved cash collections plan', 'Monthly', 'Billing system / finance ERP', 'Hospital DHO; Group CFO', 58),
  ('billing-lead:dso-and-aged-receivables', 'billing-lead', 'DSO and aged receivables', 'Receivables control', 'Debtor days using the group-approved calculation, with receivables beyond the approved ageing threshold separately reported.', 0.15, 'Approved DSO and ageing plan', 'Monthly', 'Finance ERP / billing system', 'Hospital DHO; Group CFO', 59),
  ('billing-lead:unbilled-revenue-and-cash-posting-reconciliation', 'billing-lead', 'Unbilled revenue and cash-posting reconciliation', 'Revenue completeness', 'Completed services not billed and unreconciled cash items, reported with age and action owner.', 0.15, 'Approved revenue-integrity target', 'Monthly', 'HIS / billing system / finance ERP', 'Hospital DHO', 60),
  ('billing-lead:payer-reconciliation-and-documentation-completeness', 'billing-lead', 'Payer reconciliation and documentation completeness', 'Payer discipline', 'Payer accounts reconciled to schedule and submitted claims meeting required documentation standards.', 0.1, 'Payer reconciliation calendar', 'Monthly', 'Billing system / payer portals', 'Corporate Revenue & Insurance Lead', 61),
  ('billing-lead:revenue-leakage-and-avoidable-credit-notes', 'billing-lead', 'Revenue leakage and avoidable credit notes', 'Leakage prevention', 'Finance-approved avoidable revenue leakage and credit-note value compared with approved target and root-cause actions.', 0.05, 'Approved revenue-integrity target', 'Monthly', 'Finance ERP / billing audit', 'Group CFO; Hospital DHO', 62),
  ('coe-lead:coe-net-revenue-vs-plan', 'coe-lead', 'COE net revenue vs plan', 'COE financial performance', 'Finance-approved revenue from the COE compared with its approved plan.', 0.2, 'Approved COE business plan', 'Monthly', 'Finance ERP / HIS', 'Group CFO; Regional COOs', 63),
  ('coe-lead:coe-contribution-margin-or-ebitda-vs-plan', 'coe-lead', 'COE contribution margin or EBITDA vs plan', 'COE financial performance', 'Finance-approved contribution margin or EBITDA for the COE compared with approved plan.', 0.15, 'Approved COE business plan', 'Monthly', 'Finance ERP / management accounts', 'Group CFO', 64),
  ('coe-lead:coe-capacity-utilisation-and-case-volume', 'coe-lead', 'COE capacity utilisation and case volume', 'Capacity and throughput', 'Approved COE capacity utilised and completed case volume compared with plan, using service-specific denominators.', 0.1, 'COE capacity and volume plan', 'Monthly', 'HIS / scheduling', 'Regional COOs; DHOs', 65),
  ('coe-lead:coe-referral-conversion', 'coe-lead', 'COE referral conversion', 'Referral continuity', 'Eligible referrals that complete the intended COE consultation, procedure or care plan divided by eligible referrals.', 0.15, 'COE referral plan', 'Monthly', 'HIS / referral tracker', 'Business Development Leads; DHOs', 66),
  ('coe-lead:coe-outcomes-and-protocol-compliance', 'coe-lead', 'COE outcomes and protocol compliance', 'Clinical excellence', 'COE clinical outcomes and protocol compliance, using the approved service-line scorecard and risk adjustment where applicable.', 0.15, 'Approved COE clinical-quality plan', 'Monthly', 'Quality system / HIS / clinical audit', 'Clinical Medical Director', 67),
  ('coe-lead:coe-patient-experience-score', 'coe-lead', 'COE patient experience score', 'Patient-centred care', 'Approved patient-experience score for the COE, reported with response rate and key corrective actions.', 0.1, 'COE patient-experience plan', 'Monthly', 'Patient feedback platform', 'DHOs; Regional COOs', 68),
  ('coe-lead:approved-coe-programme-milestones', 'coe-lead', 'Approved COE programme milestones', 'Innovation and expansion', 'Approved programme, technology or geographic expansion milestones completed on time and within approved business case.', 0.1, 'Approved COE roadmap', 'Monthly', 'COE roadmap / finance', 'Clinical Medical Director; Regional COOs', 69),
  ('coe-lead:coe-medical-team-capability-and-engagement', 'coe-lead', 'COE medical-team capability and engagement', 'Medical capability', 'Required competency milestones achieved and approved medical-team engagement measure for the COE.', 0.05, 'COE workforce plan', 'Monthly', 'Medical affairs / HRIS', 'HR Head; People Executives', 70),
  ('corporate-revenue-lead:corporate-and-insurer-net-revenue-and-margin-vs-plan', 'corporate-revenue-lead', 'Corporate and insurer net revenue and margin vs plan', 'Corporate and insurance growth', 'Finance-approved net revenue and margin from corporate and insurer accounts compared with plan.', 0.2, 'Approved corporate and insurer plan', 'Monthly', 'Finance ERP / contract register', 'Group CFO; Regional COOs', 71),
  ('corporate-revenue-lead:active-contracted-accounts-vs-plan', 'corporate-revenue-lead', 'Active contracted accounts vs plan', 'Account portfolio', 'Accounts with active, compliant agreements and expected revenue activity compared with plan.', 0.15, 'Approved account-acquisition plan', 'Monthly', 'Contract register / CRM', 'Legal Head; Business Development Leads', 72),
  ('corporate-revenue-lead:new-corporate-and-insurer-tie-up-conversion', 'corporate-revenue-lead', 'New corporate and insurer tie-up conversion', 'New tie-ups', 'Qualified corporate or insurer opportunities converted to signed, approved agreements divided by qualified opportunities.', 0.15, 'Approved new tie-up plan', 'Monthly', 'CRM / contract register', 'Legal Head; Clinical Medical Director', 73),
  ('corporate-revenue-lead:contract-renewal-and-account-retention-rate', 'corporate-revenue-lead', 'Contract renewal and account retention rate', 'Retention', 'Eligible accounts renewed by due date divided by eligible accounts due for renewal, with lost revenue reported.', 0.1, 'Annual account-retention plan', 'Monthly', 'Contract register / CRM', 'Legal Head; Group CFO', 74),
  ('corporate-revenue-lead:contract-utilisation-and-revenue-per-account', 'corporate-revenue-lead', 'Contract utilisation and revenue per account', 'Account activation', 'Actual use of agreed services and revenue per active account compared with account plan.', 0.1, 'Approved account plans', 'Monthly', 'HIS / finance ERP / CRM', 'Regional COOs; DHOs', 75),
  ('corporate-revenue-lead:commercial-term-yield', 'corporate-revenue-lead', 'Commercial term yield', 'Commercial discipline', 'Net realised rates and approved commercial terms compared with contracted rate cards and approved margin floors.', 0.1, 'Approved pricing and margin guardrails', 'Monthly', 'Contract register / finance', 'Group CFO; Legal Head', 76),
  ('corporate-revenue-lead:payer-issue-closure', 'corporate-revenue-lead', 'Payer issue closure', 'Payer issue resolution', 'Payer or corporate billing issues resolved within agreed service levels, with root causes tracked.', 0.1, 'Approved payer-service standard', 'Monthly', 'Billing system / issue tracker', 'Billing & Revenue Leads', 77),
  ('corporate-revenue-lead:pipeline-forecast-accuracy-and-crm-completeness', 'corporate-revenue-lead', 'Pipeline forecast accuracy and CRM completeness', 'Commercial predictability', 'Forecast compared with realised contracted revenue and completeness of required CRM fields for active accounts.', 0.1, 'CRM data-quality and forecast standard', 'Monthly', 'CRM / analytics', 'Head of Analytics & Digital Transformation', 78),
  ('group-cfo:group-ebitda-vs-approved-budget', 'group-cfo', 'Group EBITDA vs approved budget', 'Profitability', 'Finance-approved group EBITDA compared with approved budget, with region and hospital drivers reconciled.', 0.2, 'Board-approved EBITDA plan', 'Monthly', 'Finance ERP / management accounts', 'Chairman; Regional COOs', 79),
  ('group-cfo:cash-flow-liquidity-and-working-capital-vs-plan', 'group-cfo', 'Cash flow, liquidity and working capital vs plan', 'Liquidity', 'Operating cash flow, liquidity headroom and working-capital position compared with approved cash plan.', 0.15, 'Board-approved cash-flow plan', 'Monthly', 'Treasury / finance ERP', 'Billing & Revenue Leads', 80),
  ('group-cfo:group-collections-and-dso-vs-plan', 'group-cfo', 'Group collections and DSO vs plan', 'Cash conversion', 'Group cash collections versus plan and debtor days using the group-approved calculation.', 0.15, 'Approved collections and DSO plan', 'Monthly', 'Billing system / finance ERP', 'Billing & Revenue Leads; Regional COOs', 81),
  ('group-cfo:forecast-and-budget-quality', 'group-cfo', 'Forecast and budget quality', 'Planning discipline', 'Timely forecast submission and approved forecast accuracy for revenue, EBITDA, cash and major cost drivers.', 0.1, 'Finance planning calendar and accuracy standard', 'Monthly', 'FP&A models / finance ERP', 'Head of Analytics & Digital Transformation', 82),
  ('group-cfo:controllable-cost-improvement-vs-plan', 'group-cfo', 'Controllable cost improvement vs plan', 'Cost improvement', 'Finance-validated controllable cost improvement and cost-per-service trend compared with plan, preserving quality and availability.', 0.15, 'Approved cost-improvement plan', 'Monthly', 'Finance ERP / procurement / HIS', 'Procurement Head; Regional COOs', 83),
  ('group-cfo:financial-controls-and-leakage-actions-closed', 'group-cfo', 'Financial controls and leakage actions closed', 'Financial control', 'Material control gaps, reconciliations and leakage actions closed by due date, with residual risk reported.', 0.1, 'Finance control plan', 'Monthly', 'Finance controls / internal audit', 'Billing & Revenue Leads; Legal Head', 84),
  ('group-cfo:finance-compliance-and-audit-action-closure', 'group-cfo', 'Finance compliance and audit-action closure', 'Compliance', 'Finance statutory and audit actions completed by due date divided by actions due.', 0.15, 'Finance compliance calendar', 'Monthly', 'Finance compliance / audit tracker', 'Legal Head', 85),
  ('procurement-head:finance-validated-procurement-savings-vs-plan', 'procurement-head', 'Finance-validated procurement savings vs plan', 'Cost performance', 'Finance-validated savings from negotiated purchasing versus approved baseline, compared with plan.', 0.2, 'Approved procurement savings plan', 'Monthly', 'Procurement system / finance ERP', 'Group CFO; Regional COOs', 86),
  ('procurement-head:contract-and-purchase-order-compliance', 'procurement-head', 'Contract and purchase-order compliance', 'Buying compliance', 'Spend placed through approved contracts and purchase orders divided by addressable spend.', 0.1, 'Approved procurement compliance standard', 'Monthly', 'Procurement system / finance ERP', 'Group CFO', 87),
  ('procurement-head:critical-consumable-stockouts-and-service-disruption', 'procurement-head', 'Critical consumable stockouts and service disruption', 'Supply continuity', 'Critical stockout events and related service disruption, reported by item and root cause; no universal threshold is assumed.', 0.15, 'Approved critical inventory plan', 'Monthly', 'Inventory system / incident register', 'DHOs; Clinical Medical Director', 88),
  ('procurement-head:inventory-days-and-obsolete-stock', 'procurement-head', 'Inventory days and obsolete stock', 'Inventory discipline', 'Inventory days and obsolete or expiring stock value measured using the group-approved inventory policy.', 0.15, 'Approved inventory plan', 'Monthly', 'Inventory system / finance ERP', 'Group CFO; DHOs', 89),
  ('procurement-head:purchase-request-to-purchase-order-turnaround', 'procurement-head', 'Purchase request to purchase-order turnaround', 'Service responsiveness', 'Median or approved percentile time from complete approved request to issued purchase order.', 0.1, 'Approved procurement service level', 'Monthly', 'Procurement system', 'DHOs', 90),
  ('procurement-head:supplier-quality-and-service-level-performance', 'procurement-head', 'Supplier quality and service-level performance', 'Vendor performance', 'Supplier delivery, quality and service performance against approved service levels.', 0.1, 'Approved vendor scorecard', 'Monthly', 'Procurement system / user feedback', 'DHOs; Clinical Leads', 91),
  ('procurement-head:rate-card-adherence-and-maverick-spend', 'procurement-head', 'Rate-card adherence and maverick spend', 'Price discipline', 'Spend at approved prices and outside approved buying channels, reported with remediation actions.', 0.1, 'Approved rate-card and compliance standard', 'Monthly', 'Procurement system / finance ERP', 'Group CFO', 92),
  ('procurement-head:supplier-risk-and-continuity-actions-closed', 'procurement-head', 'Supplier risk and continuity actions closed', 'Resilience', 'High-risk supplier continuity actions closed by due date divided by actions due.', 0.1, 'Approved supplier-risk plan', 'Monthly', 'Supplier risk register', 'Legal Head; DHOs', 93),
  ('hr-head:group-workforce-cost-and-productivity-vs-plan', 'hr-head', 'Group workforce cost and productivity vs plan', 'Workforce economics', 'Approved workforce cost and output-per-FTE measures compared with plan, reported by function and facility.', 0.15, 'Approved workforce and productivity plan', 'Monthly', 'HRIS / payroll / HIS / finance', 'Group CFO; Regional COOs', 94),
  ('hr-head:critical-role-staffing-and-time-to-hire', 'hr-head', 'Critical-role staffing and time to hire', 'Critical talent', 'Critical roles filled divided by approved critical roles, plus time-to-fill for critical vacancies.', 0.15, 'Approved workforce plan', 'Monthly', 'HRIS / recruitment tracker', 'People Executives; DHOs', 95),
  ('hr-head:group-and-critical-role-attrition', 'hr-head', 'Group and critical-role attrition', 'Retention', 'Voluntary and total attrition, including designated critical roles, compared with approved retention plan.', 0.15, 'Approved retention plan', 'Monthly', 'HRIS', 'People Executives; Regional COOs', 96),
  ('hr-head:group-engagement-score-and-action-closure', 'hr-head', 'Group engagement score and action closure', 'Employee experience', 'Approved group engagement score and action-plan completion by due date.', 0.15, 'Annual engagement plan', 'Monthly', 'Engagement survey / HR tracker', 'People Executives; Regional COOs', 97),
  ('hr-head:mandatory-learning-capability-and-succession-coverage', 'hr-head', 'Mandatory learning, capability and succession coverage', 'Capability and succession', 'Required workforce meeting learning or capability requirements and critical roles with approved succession coverage.', 0.15, 'Approved capability and succession plan', 'Monthly', 'LMS / HRIS / medical affairs', 'Clinical Medical Director', 98),
  ('hr-head:performance-management-and-talent-review-completion', 'hr-head', 'Performance-management and talent-review completion', 'Performance culture', 'Eligible workforce with completed performance review and current talent review divided by eligible workforce.', 0.1, 'Group performance calendar', 'Monthly', 'HRIS', 'People Executives', 99),
  ('hr-head:employment-compliance-and-grievance-closure', 'hr-head', 'Employment compliance and grievance closure', 'Employment governance', 'Employment compliance actions and grievances closed to approved service levels, with material exceptions escalated.', 0.15, 'HR compliance calendar', 'Monthly', 'HR compliance tracker', 'Legal Head', 100),
  ('legal-head:contract-turnaround-time', 'legal-head', 'Contract turnaround time', 'Commercial enablement', 'Median or approved percentile time to complete standard and non-standard contracts, segmented by risk category.', 0.15, 'Approved legal service levels', 'Monthly', 'Contract lifecycle system', 'Corporate Revenue & Insurance Lead; Procurement Head', 101),
  ('legal-head:high-risk-contract-review-and-approval-compliance', 'legal-head', 'High-risk contract review and approval compliance', 'Risk management', 'High-risk agreements receiving required review and approval before execution divided by high-risk agreements executed.', 0.15, 'Approved contract approval policy', 'Monthly', 'Contract register', 'Corporate Revenue & Insurance Lead; Procurement Head', 102),
  ('legal-head:license-filing-and-regulatory-calendar-compliance', 'legal-head', 'License, filing and regulatory-calendar compliance', 'Regulatory compliance', 'Required filings, licences and registrations completed or renewed by due date divided by items due.', 0.2, 'Approved regulatory calendar', 'Monthly', 'Legal compliance register', 'DHOs; HR Head', 103),
  ('legal-head:material-litigation-and-dispute-action-milestones', 'legal-head', 'Material litigation and dispute action milestones', 'Dispute management', 'Material matters with current strategy, owner and action milestones completed by due date; report exposure separately.', 0.15, 'Approved legal risk plan', 'Monthly', 'Legal matter tracker', 'Group CFO; Chairman', 104),
  ('legal-head:commercial-and-payer-dispute-support-turnaround', 'legal-head', 'Commercial and payer dispute support turnaround', 'Revenue protection', 'Commercial or payer disputes supported within agreed service levels, with recovery or avoidance value reported where validated.', 0.1, 'Approved legal service levels', 'Monthly', 'Legal matter tracker / billing tracker', 'Billing & Revenue Leads; Corporate Revenue & Insurance Lead', 105),
  ('legal-head:policy-refresh-and-required-legal-training-completion', 'legal-head', 'Policy refresh and required legal training completion', 'Policy governance', 'Policies due for review refreshed and required legal or compliance learning completed by required employees.', 0.1, 'Policy calendar and training plan', 'Monthly', 'Policy register / LMS', 'HR Head', 106),
  ('legal-head:governance-and-audit-legal-actions-closed', 'legal-head', 'Governance and audit legal actions closed', 'Assurance', 'Legal, governance and audit actions closed by due date divided by actions due, with critical exceptions escalated.', 0.15, 'Governance action plan', 'Monthly', 'Governance tracker / audit tracker', 'Chairman; Group CFO', 107),
  ('analytics-head:kpi-dashboard-availability-and-refresh-on-time', 'analytics-head', 'KPI dashboard availability and refresh on time', 'Reliable decision support', 'Critical approved dashboards available and refreshed to the agreed timetable divided by dashboards due.', 0.15, 'Approved reporting calendar and service level', 'Monthly', 'BI platform / data operations log', 'All executive owners', 108),
  ('analytics-head:kpi-data-quality-and-reconciliation', 'analytics-head', 'KPI data quality and reconciliation', 'Trusted data', 'Critical KPI data meeting defined completeness, consistency and finance or source-system reconciliation checks.', 0.2, 'Approved data-quality standards', 'Monthly', 'Data-quality controls / finance reconciliation', 'Group CFO; Billing & Revenue Leads', 109),
  ('analytics-head:monthly-kpi-pack-delivered-to-calendar', 'analytics-head', 'Monthly KPI pack delivered to calendar', 'Timely management information', 'Monthly management KPI pack delivered complete and accurate by the agreed date divided by packs due.', 0.15, 'Group reporting calendar', 'Monthly', 'BI platform / reporting calendar', 'Chairman; Group CFO', 110),
  ('analytics-head:priority-dashboard-adoption-and-report-rationalisation', 'analytics-head', 'Priority dashboard adoption and report rationalisation', 'Adoption', 'Target users actively using priority dashboards and retirement of duplicate manual reports against plan.', 0.1, 'Approved analytics adoption plan', 'Monthly', 'BI usage logs / report inventory', 'All executive owners', 111),
  ('analytics-head:revenue-collections-and-cash-forecast-accuracy', 'analytics-head', 'Revenue, collections and cash forecast accuracy', 'Forecast support', 'Approved forecast accuracy measure comparing forecast with actual revenue, collections and cash over the agreed horizon.', 0.15, 'Finance planning accuracy standard', 'Monthly', 'BI platform / finance ERP', 'Group CFO; Regional COOs', 112),
  ('analytics-head:approved-insight-actions-closed', 'analytics-head', 'Approved insight actions closed', 'Actionable insight', 'Prioritised data-led actions accepted by owners and closed by due date divided by actions due.', 0.1, 'Approved insight-action plan', 'Monthly', 'Analytics action tracker', 'Regional COOs; DHOs', 113),
  ('analytics-head:digital-roadmap-and-benefit-realisation', 'analytics-head', 'Digital roadmap and benefit realisation', 'Digital value', 'Approved digital milestones delivered and finance-validated benefits realised versus business case.', 0.15, 'Approved digital roadmap and business cases', 'Monthly', 'Project portfolio / finance', 'Chairman; Group CFO', 114)
) as v(assignment_id, role_id, kpi, key_deliverable, definition, weight,
       target_basis, review, primary_data_source, key_collaborator, source_row)
on conflict (framework_version_id, assignment_id) do nothing;

-- Assignment -> definition family mapping --------------------------------
-- 8 of the 109 map to two families (ADR 0004). component_position preserves
-- the order the assignment's own title presents the measures in.
insert into orbit.definition_components
  (framework_version_id, assignment_id, family, component_position, unresolved_reason)
select fv.id, v.* from _fv fv, (values
  ('chairman:group-net-revenue-vs-approved-budget', 'Net revenue', 0, null),
  ('chairman:group-ebitda-vs-approved-budget', 'EBITDA', 0, null),
  ('chairman:operating-cash-flow-and-working-capital-vs-plan', 'Operating cash flow', 0, null),
  ('chairman:group-clinical-quality-and-safety-index', 'Clinical quality scorecard', 0, null),
  ('chairman:group-patient-experience-index', 'Patient experience', 0, null),
  ('chairman:coe-corporate-and-expansion-milestones', 'COE contribution', 0, null),
  ('chairman:coe-corporate-and-expansion-milestones', 'Contract utilisation', 1, null),
  ('chairman:critical-governance-legal-and-audit-actions-closed', 'Legal and compliance closure', 0, null),
  ('clinical-director:clinical-quality-scorecard', 'Clinical quality scorecard', 0, null),
  ('clinical-director:serious-adverse-event-rate-and-review-closure', 'Serious adverse events', 0, null),
  ('clinical-director:protocol-compliance-and-critical-audit-closure', 'Protocol compliance', 0, null),
  ('clinical-director:clinical-patient-experience-score', 'Patient experience', 0, null),
  ('clinical-director:medical-credentialing-and-capability-completion', 'Mandatory learning / credentialing', 0, null),
  ('clinical-director:coe-revenue-and-contribution-vs-plan', 'COE contribution', 0, null),
  ('clinical-director:clinical-propositions-converted-to-revenue', 'New business revenue', 0, null),
  ('clinical-director:clinical-propositions-converted-to-revenue', 'Qualified pipeline', 1, null),
  ('clinical-director:priority-care-referral-conversion', 'Referral conversion', 0, null),
  ('regional-coo:regional-net-revenue-vs-approved-budget', 'Net revenue', 0, null),
  ('regional-coo:regional-ebitda-vs-approved-budget', 'EBITDA', 0, null),
  ('regional-coo:hospital-and-clinic-capacity-utilisation', 'Capacity utilisation', 0, null),
  ('regional-coo:patient-volume-and-referral-conversion', 'Referral conversion', 0, null),
  ('regional-coo:collections-and-dso-vs-plan', 'Collections', 0, null),
  ('regional-coo:claim-clean-rate-and-denial-value', 'First-pass claim acceptance', 0, null),
  ('regional-coo:claim-clean-rate-and-denial-value', 'Denied or rejected claim value', 1, null),
  ('regional-coo:patient-experience-and-capa-closure', 'Patient experience', 0, null),
  ('regional-coo:engagement-and-critical-role-retention', 'Engagement', 0, null),
  ('regional-coo:new-service-coe-and-corporate-revenue-vs-plan', 'New business revenue', 0, null),
  ('regional-coo:new-service-coe-and-corporate-revenue-vs-plan', 'COE contribution', 1, null),
  ('hospital-dho:hospital-net-revenue-vs-approved-budget', 'Net revenue', 0, null),
  ('hospital-dho:hospital-ebitda-vs-approved-budget', 'EBITDA', 0, null),
  ('hospital-dho:capacity-utilisation-and-patient-throughput', 'Capacity utilisation', 0, null),
  ('hospital-dho:referral-conversion-and-new-service-revenue', 'Referral conversion', 0, null),
  ('hospital-dho:patient-experience-and-complaint-capa-closure', 'Patient experience', 0, null),
  ('hospital-dho:collections-dso-and-unbilled-revenue', 'Collections', 0, null),
  ('hospital-dho:claim-first-pass-acceptance-and-rejection-value', 'First-pass claim acceptance', 0, null),
  ('hospital-dho:claim-first-pass-acceptance-and-rejection-value', 'Denied or rejected claim value', 1, null),
  ('hospital-dho:people-productivity-engagement-and-critical-attrition', 'Engagement', 0, null),
  ('hospital-dho:facility-readiness-licensure-and-safety-actions', 'Legal and compliance closure', 0, null),
  ('people-executive:approved-position-fill-rate-and-time-to-fill', 'Critical-role attrition', 0, null),
  ('people-executive:roster-adherence-and-labour-productivity', 'Workforce productivity', 0, null),
  ('people-executive:critical-role-attrition', 'Critical-role attrition', 0, null),
  ('people-executive:engagement-score-and-action-closure', 'Engagement', 0, null),
  ('people-executive:performance-review-and-talent-matrix-completion', 'Mandatory learning / credentialing', 0, null),
  ('people-executive:mandatory-training-and-credentialing-completion', 'Mandatory learning / credentialing', 0, null),
  ('people-executive:hr-and-statutory-actions-closed-on-time', 'Legal and compliance closure', 0, null),
  ('people-executive:manpower-cost-vs-plan', 'Workforce productivity', 0, null),
  ('bd-lead:new-business-revenue-vs-plan', 'New business revenue', 0, null),
  ('bd-lead:qualified-pipeline-coverage', 'Qualified pipeline', 0, null),
  ('bd-lead:lead-to-revenue-conversion', 'New business revenue', 0, null),
  ('bd-lead:lead-to-revenue-conversion', 'Qualified pipeline', 1, null),
  ('bd-lead:active-referrer-network-and-referral-revenue', 'Referral conversion', 0, null),
  ('bd-lead:active-referrer-network-and-referral-revenue', 'New business revenue', 1, null),
  ('bd-lead:new-service-and-coe-lead-conversion', 'Qualified pipeline', 0, null),
  ('bd-lead:new-service-and-coe-lead-conversion', 'COE contribution', 1, null),
  ('bd-lead:corporate-opportunities-handed-over-and-accepted', 'Qualified pipeline', 0, null),
  ('bd-lead:crm-completeness-and-forecast-accuracy', 'Forecast accuracy', 0, null),
  ('bd-lead:acquisition-economics-vs-plan', 'New business revenue', 0, null),
  ('billing-lead:claim-first-pass-acceptance-rate', 'First-pass claim acceptance', 0, null),
  ('billing-lead:claim-submission-turnaround-time', 'First-pass claim acceptance', 0, null),
  ('billing-lead:rejected-or-denied-claim-value', 'Denied or rejected claim value', 0, null),
  ('billing-lead:cash-collections-vs-monthly-plan', 'Collections', 0, null),
  ('billing-lead:dso-and-aged-receivables', 'DSO', 0, null),
  ('billing-lead:unbilled-revenue-and-cash-posting-reconciliation', 'Unbilled revenue', 0, null),
  ('billing-lead:payer-reconciliation-and-documentation-completeness', 'Unbilled revenue', 0, null),
  ('billing-lead:revenue-leakage-and-avoidable-credit-notes', 'Unbilled revenue', 0, null),
  ('coe-lead:coe-net-revenue-vs-plan', 'Net revenue', 0, null),
  ('coe-lead:coe-contribution-margin-or-ebitda-vs-plan', 'EBITDA', 0, null),
  ('coe-lead:coe-capacity-utilisation-and-case-volume', 'Capacity utilisation', 0, null),
  ('coe-lead:coe-referral-conversion', 'Referral conversion', 0, null),
  ('coe-lead:coe-outcomes-and-protocol-compliance', 'Protocol compliance', 0, null),
  ('coe-lead:coe-patient-experience-score', 'Patient experience', 0, null),
  ('coe-lead:approved-coe-programme-milestones', 'COE contribution', 0, null),
  ('coe-lead:coe-medical-team-capability-and-engagement', 'Engagement', 0, null),
  ('corporate-revenue-lead:corporate-and-insurer-net-revenue-and-margin-vs-plan', 'Net revenue', 0, null),
  ('corporate-revenue-lead:active-contracted-accounts-vs-plan', 'Contract utilisation', 0, null),
  ('corporate-revenue-lead:new-corporate-and-insurer-tie-up-conversion', 'Qualified pipeline', 0, null),
  ('corporate-revenue-lead:contract-renewal-and-account-retention-rate', 'Contract utilisation', 0, null),
  ('corporate-revenue-lead:contract-utilisation-and-revenue-per-account', 'Contract utilisation', 0, null),
  ('corporate-revenue-lead:commercial-term-yield', 'Contract utilisation', 0, null),
  ('corporate-revenue-lead:payer-issue-closure', 'Denied or rejected claim value', 0, null),
  ('corporate-revenue-lead:pipeline-forecast-accuracy-and-crm-completeness', 'Forecast accuracy', 0, null),
  ('group-cfo:group-ebitda-vs-approved-budget', 'EBITDA', 0, null),
  ('group-cfo:cash-flow-liquidity-and-working-capital-vs-plan', 'Operating cash flow', 0, null),
  ('group-cfo:group-collections-and-dso-vs-plan', 'Collections', 0, null),
  ('group-cfo:forecast-and-budget-quality', 'Forecast accuracy', 0, null),
  ('group-cfo:controllable-cost-improvement-vs-plan', 'Procurement savings', 0, null),
  ('group-cfo:financial-controls-and-leakage-actions-closed', 'Legal and compliance closure', 0, null),
  ('group-cfo:finance-compliance-and-audit-action-closure', 'Legal and compliance closure', 0, null),
  ('procurement-head:finance-validated-procurement-savings-vs-plan', 'Procurement savings', 0, null),
  ('procurement-head:contract-and-purchase-order-compliance', 'Legal and compliance closure', 0, null),
  ('procurement-head:critical-consumable-stockouts-and-service-disruption', 'Inventory days / obsolete stock', 0, null),
  ('procurement-head:inventory-days-and-obsolete-stock', 'Inventory days / obsolete stock', 0, null),
  ('procurement-head:purchase-request-to-purchase-order-turnaround', 'Procurement savings', 0, null),
  ('procurement-head:supplier-quality-and-service-level-performance', 'Procurement savings', 0, null),
  ('procurement-head:rate-card-adherence-and-maverick-spend', 'Procurement savings', 0, null),
  ('procurement-head:supplier-risk-and-continuity-actions-closed', 'Inventory days / obsolete stock', 0, null),
  ('hr-head:group-workforce-cost-and-productivity-vs-plan', 'Workforce productivity', 0, null),
  ('hr-head:critical-role-staffing-and-time-to-hire', 'Critical-role attrition', 0, null),
  ('hr-head:group-and-critical-role-attrition', 'Critical-role attrition', 0, null),
  ('hr-head:group-engagement-score-and-action-closure', 'Engagement', 0, null),
  ('hr-head:mandatory-learning-capability-and-succession-coverage', 'Mandatory learning / credentialing', 0, null),
  ('hr-head:performance-management-and-talent-review-completion', 'Mandatory learning / credentialing', 0, null),
  ('hr-head:employment-compliance-and-grievance-closure', 'Legal and compliance closure', 0, null),
  ('legal-head:contract-turnaround-time', 'Legal and compliance closure', 0, null),
  ('legal-head:high-risk-contract-review-and-approval-compliance', 'Legal and compliance closure', 0, null),
  ('legal-head:license-filing-and-regulatory-calendar-compliance', 'Legal and compliance closure', 0, null),
  ('legal-head:material-litigation-and-dispute-action-milestones', 'Legal and compliance closure', 0, null),
  ('legal-head:commercial-and-payer-dispute-support-turnaround', 'Legal and compliance closure', 0, null),
  ('legal-head:policy-refresh-and-required-legal-training-completion', 'Legal and compliance closure', 0, null),
  ('legal-head:governance-and-audit-legal-actions-closed', 'Legal and compliance closure', 0, null),
  ('analytics-head:kpi-dashboard-availability-and-refresh-on-time', 'KPI data quality', 0, null),
  ('analytics-head:kpi-data-quality-and-reconciliation', 'KPI data quality', 0, null),
  ('analytics-head:monthly-kpi-pack-delivered-to-calendar', 'KPI data quality', 0, null),
  ('analytics-head:priority-dashboard-adoption-and-report-rationalisation', 'KPI data quality', 0, null),
  ('analytics-head:revenue-collections-and-cash-forecast-accuracy', 'Collections', 0, null),
  ('analytics-head:approved-insight-actions-closed', 'KPI data quality', 0, null),
  ('analytics-head:digital-roadmap-and-benefit-realisation', 'Forecast accuracy', 0, null)
) as v(assignment_id, family, component_position, unresolved_reason)
on conflict (framework_version_id, assignment_id, family) do nothing;

-- Governance and targeting rules -----------------------------------------
-- Records HOW targets are set. Contains no approved numeric targets: the
-- workbook has none (PRD §3.1) and inventing them is forbidden.
insert into orbit.governance_rules
  (framework_version_id, kpi_family_group, target_setting_approach, target_owner,
   definition_owner, reporting_cadence, escalation_review, source_row)
select fv.id, v.* from _fv fv, (values
  ('Financial: revenue, EBITDA, cash, collections, DSO', 'Translate Board-approved annual budget into monthly facility, regional and group targets. Reconcile to the official Finance close.', 'Group CFO', 'Group CFO', 'Weekly for collections; monthly for other measures', 'Review variance, drivers, corrective actions and forecast in monthly business review.', 5),
  ('Capacity, volume and referral conversion', 'Use approved service-line capacity and volume plans. Define capacity units before targets are distributed.', 'Regional COO', 'Regional COO / Clinical Medical Director', 'Weekly / monthly', 'Escalate sustained capacity constraints, referral leakage and access issues.', 6),
  ('Clinical quality, safety and protocols', 'Set only through approved clinical governance plan and applicable protocols. Use risk adjustment where the approved indicator requires it.', 'Clinical Medical Director', 'Clinical Medical Director', 'Monthly / quarterly clinical review', 'Escalate serious events and critical audit exceptions under the incident policy.', 7),
  ('Patient experience and complaint closure', 'Set annual target using approved survey method and service plan. Define action closure service levels.', 'Regional COO', 'Regional COO', 'Monthly', 'Review adverse feedback, response rates, overdue actions and evidence of effective closure.', 8),
  ('People, learning and workforce productivity', 'Set from approved workforce, productivity, engagement and capability plans, with role-specific definitions.', 'HR Head', 'HR Head', 'Monthly / quarterly', 'Review critical vacancies, attrition, staffing gaps and overdue capability actions.', 9),
  ('Claims, denials, unbilled revenue and payer issues', 'Set from revenue-cycle baseline, payer terms and approved collection plan; segment targets by material payer where needed.', 'Group CFO', 'Billing & Revenue Lead', 'Weekly / monthly', 'Review payer root causes, aged receivables, unbilled items and recovery action owners.', 10),
  ('COE, corporate and insurer growth', 'Set from approved business cases, contract pipeline and contribution expectations. Separate signed contracts from realised revenue.', 'Clinical Medical Director', 'Corporate Revenue & Insurance Lead / CoE Lead', 'Monthly', 'Review pipeline, contract status, activation, utilisation, clinical readiness and margin.', 11),
  ('Procurement and inventory', 'Set from approved savings, inventory and supply-continuity plan. Validate financial benefit before recognition.', 'Procurement Head', 'Procurement Head', 'Monthly', 'Escalate critical stockouts, supplier risks, obsolete stock and procurement constraints.', 12),
  ('Legal, governance and compliance', 'Set as due-date compliance against controlled calendars and risk-rated action registers.', 'Legal Head', 'Legal Head', 'Monthly / quarterly', 'Escalate critical overdue filings, licences, disputes, legal exposure and audit actions.', 13),
  ('Data, dashboards and digital value', 'Set from reporting calendar, data-quality standards, approved analytics roadmap and business cases.', 'Head of Analytics & Digital Transformation', 'Head of Analytics & Digital Transformation', 'Monthly', 'Do not publish unsupported metrics; disclose data quality, reconciliation status and material limitations.', 14)
) as v(kpi_family_group, target_setting_approach, target_owner,
       definition_owner, reporting_cadence, escalation_review, source_row)
on conflict (framework_version_id, kpi_family_group) do nothing;

-- Enterprise outcomes (8) ------------------------------------------------
insert into orbit.enterprise_outcomes
  (framework_version_id, outcome, cmo_accountability, primary_contribution_owners,
   target_basis, review, data_source, source_row)
select fv.id, v.* from _fv fv, (values
  ('Sustainable growth', 'Group net revenue vs approved budget', 'Regional COOs; Group CFO; DHOs; Corporate Revenue & Insurance Lead', 'Board-approved annual and monthly budget', 'Monthly', 'Finance ERP / management accounts', 5),
  ('Profitability', 'Group EBITDA vs approved budget', 'Group CFO; Regional COOs; Procurement Head; DHOs', 'Board-approved EBITDA plan', 'Monthly', 'Finance ERP / management accounts', 6),
  ('Cash conversion', 'Operating cash flow, collections and working capital vs plan', 'Group CFO; Billing & Revenue Leads; Regional COOs', 'Board-approved cash and collections plan', 'Monthly', 'Treasury / finance ERP / billing', 7),
  ('Clinical excellence', 'Group clinical quality and safety index', 'Chief / Group Clinical Medical Director; CoE Leads; Regional COOs', 'Board-approved clinical-quality plan', 'Monthly / quarterly clinical review', 'Quality system / HIS / audit', 8),
  ('Patient-centred care', 'Group patient experience index', 'Regional COOs; DHOs; Clinical Medical Director', 'Annual patient-experience plan', 'Monthly', 'Feedback platform / complaint register', 9),
  ('Strategic growth', 'COE, corporate and expansion milestones', 'Clinical Medical Director; CoE Leads; Corporate Revenue & Insurance Lead', 'Board-approved strategic plan', 'Monthly', 'Strategy tracker / CRM / finance', 10),
  ('People strength', 'Engagement, critical-role retention and capability', 'HR Head; People Executives; Regional COOs', 'Approved people and capability plan', 'Monthly / quarterly', 'HRIS / engagement survey / LMS', 11),
  ('Governance and resilience', 'Critical governance, legal, audit and data actions closed', 'Legal Head; Group CFO; Analytics Head; Procurement Head', 'Board governance calendar', 'Monthly / quarterly', 'Governance, audit and compliance trackers', 12)
) as v(outcome, cmo_accountability, primary_contribution_owners,
       target_basis, review, data_source, source_row)
on conflict (framework_version_id, outcome) do nothing;

-- Organizations ----------------------------------------------------------
insert into orbit.organizations
  (slug, name, kind, currency, fiscal_year_start_month, timezone)
values
  ('kestrion', 'Kestrion Health Group', 'demo', 'USD', 1, 'UTC'),
  ('halveston-test-fixture', 'Halveston Care Group (test fixture)', 'test-fixture', 'USD', 1, 'UTC')
on conflict (slug) do nothing;

-- Regions ---------------------------------------------------------------
insert into orbit.regions (organization_id, slug, name, short_name)
select o.id, v.* from orbit.organizations o, (values
  ('north', 'Kestrion Northern Region', 'North'),
  ('south', 'Kestrion Southern Region', 'South')
) as v(slug, name, short_name)
where o.slug = 'kestrion'
on conflict (organization_id, slug) do nothing;

-- Facilities ------------------------------------------------------------
-- staffed_beds is a capacity ANCHOR the generator derives bed days from,
-- not an observation. revenue_weight distributes group anchors; sums to 1.
insert into orbit.facilities
  (organization_id, region_id, slug, name, staffed_beds, revenue_weight)
select o.id, r.id, v.slug, v.name, v.staffed_beds, v.revenue_weight
from orbit.organizations o
join orbit.regions r on r.organization_id = o.id
, (values
  ('avenhurst', 'Kestrion Avenhurst Hospital', 'north', 420, 0.24),
  ('brackmoor', 'Kestrion Brackmoor Hospital', 'north', 260, 0.15),
  ('calderwyn', 'Kestrion Calderwyn Hospital', 'north', 180, 0.11),
  ('dunmarrow', 'Kestrion Dunmarrow Hospital', 'south', 380, 0.22),
  ('elverton', 'Kestrion Elverton Hospital', 'south', 300, 0.18),
  ('farrowgate', 'Kestrion Farrowgate Hospital', 'south', 160, 0.1)
) as v(slug, name, region_slug, staffed_beds, revenue_weight)
where o.slug = 'kestrion' and r.slug = v.region_slug
on conflict (organization_id, slug) do nothing;

-- Centres of excellence -------------------------------------------------
-- Configuration choice, not a workbook fact (PRD §4 item 8). COE output
-- OVERLAPS facility totals; it is a segment view and must never be added to
-- the group twice (PRD §8.2).
insert into orbit.coes
  (organization_id, host_facility_id, slug, name, reporting_grain, region_id)
select o.id, f.id, v.slug, v.name, v.reporting_grain,
       (select r.id from orbit.regions r
         where r.organization_id = o.id and r.slug = v.region_slug)
from orbit.organizations o
join orbit.facilities f on f.organization_id = o.id
, (values
  ('cardiac-sciences', 'Kestrion Cardiac Sciences COE', 'avenhurst', 'region', 'north'),
  ('oncology', 'Kestrion Oncology COE', 'dunmarrow', 'region', 'south'),
  ('orthopaedics-spine', 'Kestrion Orthopaedics & Spine COE', 'calderwyn', 'group', null)
) as v(slug, name, host_slug, reporting_grain, region_slug)
where o.slug = 'kestrion' and f.slug = v.host_slug
on conflict (organization_id, slug) do nothing;

-- Entitlement matrix (ADR 0011) ----------------------------------------
-- Global per framework version, keyed by role and assignment (ADR 0005).
-- No organization column: this says what a ROLE may see, not what a tenant
-- owns. Derived mechanically from `deployment` plus the reviewed breakdown
-- table; every row is re-derivable and checked by build-failing tests.
insert into orbit.entitlements
  (framework_version_id, role_id, assignment_id, grains, breakdowns)
select fv.id, v.* from _fv fv, (values
  ('chairman', 'chairman:group-net-revenue-vs-approved-budget', array['group']::text[], array['region']::text[]),
  ('chairman', 'chairman:group-ebitda-vs-approved-budget', array['group']::text[], array['region']::text[]),
  ('chairman', 'chairman:operating-cash-flow-and-working-capital-vs-plan', array['group']::text[], array['region']::text[]),
  ('chairman', 'chairman:group-clinical-quality-and-safety-index', array['group']::text[], array['region']::text[]),
  ('chairman', 'chairman:group-patient-experience-index', array['group']::text[], array['region']::text[]),
  ('chairman', 'chairman:coe-corporate-and-expansion-milestones', array['group']::text[], array['region']::text[]),
  ('chairman', 'chairman:critical-governance-legal-and-audit-actions-closed', array['group']::text[], array['region']::text[]),
  ('clinical-director', 'clinical-director:clinical-quality-scorecard', array['group', 'coe']::text[], array['coe', 'facility']::text[]),
  ('clinical-director', 'clinical-director:serious-adverse-event-rate-and-review-closure', array['group', 'coe']::text[], array['coe', 'facility']::text[]),
  ('clinical-director', 'clinical-director:protocol-compliance-and-critical-audit-closure', array['group', 'coe']::text[], array['coe', 'facility']::text[]),
  ('clinical-director', 'clinical-director:clinical-patient-experience-score', array['group', 'coe']::text[], array['coe', 'facility']::text[]),
  ('clinical-director', 'clinical-director:medical-credentialing-and-capability-completion', array['group', 'coe']::text[], array['coe', 'facility']::text[]),
  ('clinical-director', 'clinical-director:coe-revenue-and-contribution-vs-plan', array['group', 'coe']::text[], array['coe', 'facility']::text[]),
  ('clinical-director', 'clinical-director:clinical-propositions-converted-to-revenue', array['group', 'coe']::text[], array['coe', 'facility']::text[]),
  ('clinical-director', 'clinical-director:priority-care-referral-conversion', array['group', 'coe']::text[], array['coe', 'facility']::text[]),
  ('regional-coo', 'regional-coo:regional-net-revenue-vs-approved-budget', array['region']::text[], array['facility']::text[]),
  ('regional-coo', 'regional-coo:regional-ebitda-vs-approved-budget', array['region']::text[], array['facility']::text[]),
  ('regional-coo', 'regional-coo:hospital-and-clinic-capacity-utilisation', array['region']::text[], array['facility']::text[]),
  ('regional-coo', 'regional-coo:patient-volume-and-referral-conversion', array['region']::text[], array['facility']::text[]),
  ('regional-coo', 'regional-coo:collections-and-dso-vs-plan', array['region']::text[], array['facility']::text[]),
  ('regional-coo', 'regional-coo:claim-clean-rate-and-denial-value', array['region']::text[], array['facility']::text[]),
  ('regional-coo', 'regional-coo:patient-experience-and-capa-closure', array['region']::text[], array['facility']::text[]),
  ('regional-coo', 'regional-coo:engagement-and-critical-role-retention', array['region']::text[], array['facility']::text[]),
  ('regional-coo', 'regional-coo:new-service-coe-and-corporate-revenue-vs-plan', array['region']::text[], array['facility']::text[]),
  ('hospital-dho', 'hospital-dho:hospital-net-revenue-vs-approved-budget', array['facility']::text[], '{}'::text[]),
  ('hospital-dho', 'hospital-dho:hospital-ebitda-vs-approved-budget', array['facility']::text[], '{}'::text[]),
  ('hospital-dho', 'hospital-dho:capacity-utilisation-and-patient-throughput', array['facility']::text[], '{}'::text[]),
  ('hospital-dho', 'hospital-dho:referral-conversion-and-new-service-revenue', array['facility']::text[], '{}'::text[]),
  ('hospital-dho', 'hospital-dho:patient-experience-and-complaint-capa-closure', array['facility']::text[], '{}'::text[]),
  ('hospital-dho', 'hospital-dho:collections-dso-and-unbilled-revenue', array['facility']::text[], '{}'::text[]),
  ('hospital-dho', 'hospital-dho:claim-first-pass-acceptance-and-rejection-value', array['facility']::text[], '{}'::text[]),
  ('hospital-dho', 'hospital-dho:people-productivity-engagement-and-critical-attrition', array['facility']::text[], '{}'::text[]),
  ('hospital-dho', 'hospital-dho:facility-readiness-licensure-and-safety-actions', array['facility']::text[], '{}'::text[]),
  ('people-executive', 'people-executive:approved-position-fill-rate-and-time-to-fill', array['facility']::text[], '{}'::text[]),
  ('people-executive', 'people-executive:roster-adherence-and-labour-productivity', array['facility']::text[], '{}'::text[]),
  ('people-executive', 'people-executive:critical-role-attrition', array['facility']::text[], '{}'::text[]),
  ('people-executive', 'people-executive:engagement-score-and-action-closure', array['facility']::text[], '{}'::text[]),
  ('people-executive', 'people-executive:performance-review-and-talent-matrix-completion', array['facility']::text[], '{}'::text[]),
  ('people-executive', 'people-executive:mandatory-training-and-credentialing-completion', array['facility']::text[], '{}'::text[]),
  ('people-executive', 'people-executive:hr-and-statutory-actions-closed-on-time', array['facility']::text[], '{}'::text[]),
  ('people-executive', 'people-executive:manpower-cost-vs-plan', array['facility']::text[], '{}'::text[]),
  ('bd-lead', 'bd-lead:new-business-revenue-vs-plan', array['facility']::text[], '{}'::text[]),
  ('bd-lead', 'bd-lead:qualified-pipeline-coverage', array['facility']::text[], '{}'::text[]),
  ('bd-lead', 'bd-lead:lead-to-revenue-conversion', array['facility']::text[], '{}'::text[]),
  ('bd-lead', 'bd-lead:active-referrer-network-and-referral-revenue', array['facility']::text[], '{}'::text[]),
  ('bd-lead', 'bd-lead:new-service-and-coe-lead-conversion', array['facility']::text[], '{}'::text[]),
  ('bd-lead', 'bd-lead:corporate-opportunities-handed-over-and-accepted', array['facility']::text[], '{}'::text[]),
  ('bd-lead', 'bd-lead:crm-completeness-and-forecast-accuracy', array['facility']::text[], '{}'::text[]),
  ('bd-lead', 'bd-lead:acquisition-economics-vs-plan', array['facility']::text[], '{}'::text[]),
  ('billing-lead', 'billing-lead:claim-first-pass-acceptance-rate', array['facility']::text[], '{}'::text[]),
  ('billing-lead', 'billing-lead:claim-submission-turnaround-time', array['facility']::text[], '{}'::text[]),
  ('billing-lead', 'billing-lead:rejected-or-denied-claim-value', array['facility']::text[], '{}'::text[]),
  ('billing-lead', 'billing-lead:cash-collections-vs-monthly-plan', array['facility']::text[], '{}'::text[]),
  ('billing-lead', 'billing-lead:dso-and-aged-receivables', array['facility']::text[], '{}'::text[]),
  ('billing-lead', 'billing-lead:unbilled-revenue-and-cash-posting-reconciliation', array['facility']::text[], '{}'::text[]),
  ('billing-lead', 'billing-lead:payer-reconciliation-and-documentation-completeness', array['facility']::text[], '{}'::text[]),
  ('billing-lead', 'billing-lead:revenue-leakage-and-avoidable-credit-notes', array['facility']::text[], '{}'::text[]),
  ('coe-lead', 'coe-lead:coe-net-revenue-vs-plan', array['coe']::text[], array['facility']::text[]),
  ('coe-lead', 'coe-lead:coe-contribution-margin-or-ebitda-vs-plan', array['coe']::text[], array['facility']::text[]),
  ('coe-lead', 'coe-lead:coe-capacity-utilisation-and-case-volume', array['coe']::text[], array['facility']::text[]),
  ('coe-lead', 'coe-lead:coe-referral-conversion', array['coe']::text[], array['facility']::text[]),
  ('coe-lead', 'coe-lead:coe-outcomes-and-protocol-compliance', array['coe']::text[], array['facility']::text[]),
  ('coe-lead', 'coe-lead:coe-patient-experience-score', array['coe']::text[], array['facility']::text[]),
  ('coe-lead', 'coe-lead:approved-coe-programme-milestones', array['coe']::text[], array['facility']::text[]),
  ('coe-lead', 'coe-lead:coe-medical-team-capability-and-engagement', array['coe']::text[], array['facility']::text[]),
  ('corporate-revenue-lead', 'corporate-revenue-lead:corporate-and-insurer-net-revenue-and-margin-vs-plan', array['group']::text[], array['region']::text[]),
  ('corporate-revenue-lead', 'corporate-revenue-lead:active-contracted-accounts-vs-plan', array['group']::text[], array['region']::text[]),
  ('corporate-revenue-lead', 'corporate-revenue-lead:new-corporate-and-insurer-tie-up-conversion', array['group']::text[], array['region']::text[]),
  ('corporate-revenue-lead', 'corporate-revenue-lead:contract-renewal-and-account-retention-rate', array['group']::text[], array['region']::text[]),
  ('corporate-revenue-lead', 'corporate-revenue-lead:contract-utilisation-and-revenue-per-account', array['group']::text[], array['region']::text[]),
  ('corporate-revenue-lead', 'corporate-revenue-lead:commercial-term-yield', array['group']::text[], array['region']::text[]),
  ('corporate-revenue-lead', 'corporate-revenue-lead:payer-issue-closure', array['group']::text[], array['region']::text[]),
  ('corporate-revenue-lead', 'corporate-revenue-lead:pipeline-forecast-accuracy-and-crm-completeness', array['group']::text[], array['region']::text[]),
  ('group-cfo', 'group-cfo:group-ebitda-vs-approved-budget', array['group']::text[], array['region']::text[]),
  ('group-cfo', 'group-cfo:cash-flow-liquidity-and-working-capital-vs-plan', array['group']::text[], array['region']::text[]),
  ('group-cfo', 'group-cfo:group-collections-and-dso-vs-plan', array['group']::text[], array['region']::text[]),
  ('group-cfo', 'group-cfo:forecast-and-budget-quality', array['group']::text[], array['region']::text[]),
  ('group-cfo', 'group-cfo:controllable-cost-improvement-vs-plan', array['group']::text[], array['region']::text[]),
  ('group-cfo', 'group-cfo:financial-controls-and-leakage-actions-closed', array['group']::text[], array['region']::text[]),
  ('group-cfo', 'group-cfo:finance-compliance-and-audit-action-closure', array['group']::text[], array['region']::text[]),
  ('procurement-head', 'procurement-head:finance-validated-procurement-savings-vs-plan', array['group']::text[], array['region']::text[]),
  ('procurement-head', 'procurement-head:contract-and-purchase-order-compliance', array['group']::text[], array['region']::text[]),
  ('procurement-head', 'procurement-head:critical-consumable-stockouts-and-service-disruption', array['group']::text[], array['region']::text[]),
  ('procurement-head', 'procurement-head:inventory-days-and-obsolete-stock', array['group']::text[], array['region']::text[]),
  ('procurement-head', 'procurement-head:purchase-request-to-purchase-order-turnaround', array['group']::text[], array['region']::text[]),
  ('procurement-head', 'procurement-head:supplier-quality-and-service-level-performance', array['group']::text[], array['region']::text[]),
  ('procurement-head', 'procurement-head:rate-card-adherence-and-maverick-spend', array['group']::text[], array['region']::text[]),
  ('procurement-head', 'procurement-head:supplier-risk-and-continuity-actions-closed', array['group']::text[], array['region']::text[]),
  ('hr-head', 'hr-head:group-workforce-cost-and-productivity-vs-plan', array['group']::text[], array['region']::text[]),
  ('hr-head', 'hr-head:critical-role-staffing-and-time-to-hire', array['group']::text[], array['region']::text[]),
  ('hr-head', 'hr-head:group-and-critical-role-attrition', array['group']::text[], array['region']::text[]),
  ('hr-head', 'hr-head:group-engagement-score-and-action-closure', array['group']::text[], array['region']::text[]),
  ('hr-head', 'hr-head:mandatory-learning-capability-and-succession-coverage', array['group']::text[], array['region']::text[]),
  ('hr-head', 'hr-head:performance-management-and-talent-review-completion', array['group']::text[], array['region']::text[]),
  ('hr-head', 'hr-head:employment-compliance-and-grievance-closure', array['group']::text[], array['region']::text[]),
  ('legal-head', 'legal-head:contract-turnaround-time', array['group']::text[], array['region']::text[]),
  ('legal-head', 'legal-head:high-risk-contract-review-and-approval-compliance', array['group']::text[], array['region']::text[]),
  ('legal-head', 'legal-head:license-filing-and-regulatory-calendar-compliance', array['group']::text[], array['region']::text[]),
  ('legal-head', 'legal-head:material-litigation-and-dispute-action-milestones', array['group']::text[], array['region']::text[]),
  ('legal-head', 'legal-head:commercial-and-payer-dispute-support-turnaround', array['group']::text[], array['region']::text[]),
  ('legal-head', 'legal-head:policy-refresh-and-required-legal-training-completion', array['group']::text[], array['region']::text[]),
  ('legal-head', 'legal-head:governance-and-audit-legal-actions-closed', array['group']::text[], array['region']::text[]),
  ('analytics-head', 'analytics-head:kpi-dashboard-availability-and-refresh-on-time', array['group']::text[], array['region']::text[]),
  ('analytics-head', 'analytics-head:kpi-data-quality-and-reconciliation', array['group']::text[], array['region']::text[]),
  ('analytics-head', 'analytics-head:monthly-kpi-pack-delivered-to-calendar', array['group']::text[], array['region']::text[]),
  ('analytics-head', 'analytics-head:priority-dashboard-adoption-and-report-rationalisation', array['group']::text[], array['region']::text[]),
  ('analytics-head', 'analytics-head:revenue-collections-and-cash-forecast-accuracy', array['group']::text[], array['region']::text[]),
  ('analytics-head', 'analytics-head:approved-insight-actions-closed', array['group']::text[], array['region']::text[]),
  ('analytics-head', 'analytics-head:digital-roadmap-and-benefit-realisation', array['group']::text[], array['region']::text[])
) as v(role_id, assignment_id, grains, breakdowns)
on conflict (framework_version_id, role_id, assignment_id) do nothing;

commit;
