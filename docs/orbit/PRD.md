# Orbit — Product Requirements Document

**Status:** Research-backed specification for review; not an implementation or production-readiness claim.<br>
**Research date:** 22 September 2026.<br>
**Product and integration decision owner:** Aditya.<br>
**Related documents:** [Architecture](ARCHITECTURE.md) · [Four-person assignments](TEAM_ASSIGNMENTS.md).

## 1. What Orbit is

Orbit is a role-scoped leadership decision workspace: an “operating system for the founder” in the business sense, not a computer operating system. It helps a leader answer:

1. What changed in my area of responsibility?
2. Which exceptions need my attention?
3. What evidence explains the change?
4. Who owns the response, and what decision did we record?

The product joins performance measurement, explanation, and accountable follow-through. A collection of charts alone is not Orbit. The intended loop is **See → Understand → Act**, with a human making the decision. The pitch’s supporting architecture is Data → Policy → Reasoning → Action. [P1, slides 3, 6, 10]

The first release demonstrates that loop for a fictional healthcare group, using the Africare workbook as a reference KPI framework. It must not imply that the fictional company, observations, targets, or outcomes are real Africare information.

## 1.1 Client-promise reconciliation

The pitch presents two ideas that must not be conflated:

- **Prototype philosophy:** start narrow, prove one operating workflow, then scale. [P1, slide 11]
- **Confirmed Orbit release scope:** all 14 role dashboards in the first release.

Orbit keeps the confirmed all-14 product coverage, but follows the pitch’s delivery philosophy: the first implementation milestone is one complete, clickable Regional COO workflow, then the Chairman and remaining roles extend the same proven interaction model through reviewed role configurations. “All 14” means every role is available and tested in release one; it does not mean four people build 14 unrelated applications.

The pitch’s strongest security language—identity staying inside the client environment, ingress tokenization, sealed raw records, jurisdiction-specific deployment, and audited egress—is **not a capability of this Vercel/Supabase prototype**. Orbit v1 uses a fictional aggregate dataset with no patient or employee identity and must say so before a client demo. Aditya owns that scope conversation. No document, screen, or presenter may imply that managed Vercel/Supabase hosting is client-on-premises, certified, immutable, or jurisdiction-controlled.

## 2. Confirmed decisions and specification boundaries

Aditya confirmed these decisions during this research:

- Product name: **Orbit**.
- First release: **all 14 role dashboards**, not the legacy two-role phase and not the pitch’s “12”.
- Repository: **a new monorepo**, with selective, reviewed reuse from both existing codebases.
- Persistence and identity: **Supabase database and Supabase Auth**.
- Hosting: **two separate Vercel projects**, one frontend and one backend.
- Future direction: preserve a practical path to AWS; do not migrate now.
- No real operating dataset exists. **Maruti owns a fictional company and coherent synthetic demonstration data.**
- Owners: **Maruti — database/data; Ghansham — backend; Ayas — frontend; Aditya — security/connectivity and integration.**
- Current deliverable: three Markdown documents. No application implementation, provisioning, deployment, or repository restructuring is authorized by this document.

These decisions supersede the old two-role, seven-person, no-database, custom-auth assumptions **for the new Orbit specification only**. The existing repository and its historical rules have not been rewritten. The shared-contract discipline, visible illustrative disclosure, independent role scopes, design-token discipline, and bans on unapproved stack substitutions remain applicable.

Throughout these documents:

- **Source-backed** means found in the workbook, supplied pitch export, or inspected source.
- **Confirmed** means explicitly selected by Aditya.
- **Proposed** means a design recommendation, not an already implemented capability.
- **Open** means a decision or validation is still required. No missing business rule is silently filled in.

The end-user success test is not “all routes render.” A leader must be able to move from **See → Understand → Act** without hunting through a BI-style report, and must know whether a result is authorized, illustrative, stale, or unavailable.

## 3. Evidence and important corrections

### 3.1 What the workbook actually contains

Inspection covered all four sheets of `Africare_Group_KPI_Framework.xlsx`:

- **14 role types and 109 role-KPI assignments** in `Role KPI Matrix`, rows 6–114.
- The weights for each role total **100%**.
- **29 definition families**, not 30, in `KPI Definitions`, rows 6–34.
- **Eight enterprise outcomes** in `Group Scorecard`, rows 5–12: growth, profitability, cash conversion, clinical excellence, patient experience, strategic growth, people strength, and governance/resilience.
- An accountability structure for **six hospitals across two regions**, including two Regional COOs with three hospitals each.
- Target-setting and scorecard-construction rules in `Governance & Targeting`.
- Numeric weights and role KPI counts, but **no actual performance observations and no approved numeric performance targets**.

109 assignments are not necessarily 109 distinct underlying metrics. Different roles share measures, and several assignments bundle multiple measures. Likewise, 29 definition families are not a complete one-to-one definition for every component of every assignment.

Source distinctions must survive import. Do not import headings, section titles, accountability rows, and operating rules as if they were enterprise outcomes.

### 3.2 What the pitch supports—and does not prove

The supplied file inspected was the **13-page PDF export**, `Command_Center_Client_Pitch_updated.pptx.pdf`. An editable `.pptx` was not found, so speaker notes, animations, and hidden slides were not verified.

The pitch supports the four main surfaces, governed reasoning, human decisions, and an evidence-to-action demo. It also makes future-facing statements about client-bound identity, sealed records, tokenization, audited egress, and jurisdiction controls. These are **not established properties of either existing implementation or a hosted Vercel/Supabase demo**.

“Vault” has two meanings in the pitch: sealed raw records on slide 7, and structured intelligence/evidence cards on slides 8 and 13. Orbit v1 calls its user-visible capability **Evidence**. It does not promise a sealed raw-data vault.

### 3.3 Existing implementation—not the intended product

Two unrelated Git histories were inspected:

- Local `main`, `63f0fcb`: useful monorepo, contracts, UI tokens, and deterministic synthetic-data foundations. Apps are scaffolds; three services provide health checks rather than working product APIs. Existing data covers only the Chairman and Regional COO.
- Remote `origin/main`, `81cc292`: a more developed single React interface, eight UI role types, local mock data, local-state actions/audit, Supabase helpers/migrations, and browser-side AI. The inspected login does not authenticate against Supabase; the profile helper is not wired into the app; inspected data policies are broadly readable rather than role/facility-scoped.

No common ancestor was found. Do not merge the histories wholesale. Detailed reuse and rejection decisions are in [Architecture §12](ARCHITECTURE.md#12-reviewed-reuse-and-rejection).

The supplied public Render URL responded with the old application HTML title. This was not an interactive end-to-end verification. Existing Vercel settings, current Supabase rows, active policies, and credential-remediation status were not inspected live.

## 4. Users and the 14 dashboards

The workbook role names are canonical for this specification. Do not silently rename Chairman to CEO or Regional COO to an unqualified COO. Fourteen role types do not mean fourteen people: facility and regional roles have multiple account instances.

Each dashboard includes its complete assigned KPI set, with drill-down only where explicitly granted. The visual emphasis below is **proposed UX**, not additional permission.

1. **Chairman — 7 assignments, rows 6–12.** Enterprise growth, earnings, cash, clinical and patient outcomes, strategic milestones, and governance exceptions. Group aggregates do not confer unrestricted access to hospital, clinical, or personnel records.
2. **Chief / Group Clinical Medical Director — 8, rows 13–20.** Quality and safety exceptions first, supported by protocol, credentialing, COE, and referral evidence. No patient-level access is required for this demo.
3. **Regional COO — 9, rows 21–29.** Assigned-region financial and operational performance. A comparison between assigned facilities requires an explicit facility-breakdown grant; the other region is not automatically visible.
4. **Hospital DHO — 9, rows 30–38.** One assigned hospital’s operations, finance, access, experience, workforce, and readiness.
5. **People Executive — 8, rows 39–46.** Assigned-facility staffing readiness, rosters, capability, engagement, and workforce cost; aggregated personnel measures rather than individual employee records.
6. **Business Development Lead — 8, rows 47–54.** Assigned-facility demand, pipeline, conversion, referral network, handovers, and acquisition economics.
7. **Billing & Revenue Lead — 8, rows 55–62.** Assigned-facility billing quality, submissions, collections, aging, reconciliations, and leakage.
8. **COE Lead — 8, rows 63–70.** Assigned centre-of-excellence scope, covering financial contribution, capacity, referrals, outcomes, milestones, and capability. The demo COE structure is a configuration choice, not a client fact.
9. **Corporate Revenue & Insurance Lead — 8, rows 71–78.** Approved corporate/payer commercial scope, contract performance, conversion, renewal, yield, and issue closure.
10. **Group CFO — 7, rows 79–85.** Authorized group financial performance, liquidity, working capital, forecast quality, cost, controls, and finance audit actions.
11. **Procurement Head — 8, rows 86–93.** Authorized procurement spend, savings, compliance, stock risk, inventory, suppliers, and continuity.
12. **HR Head — 7, rows 94–100.** Authorized group workforce economics, critical staffing, attrition, engagement, capability, talent, and employment compliance.
13. **Legal Head — 7, rows 101–107.** Authorized contracts, regulatory readiness, material disputes, policy/training, and legal-action milestones.
14. **Head of Analytics & Digital Transformation — 7, rows 108–114.** Data reliability, refresh/reconciliation, pack delivery, adoption, forecast quality, insight-action closure, and digital benefits. This is a business role, **not a system administrator**.

Role-to-metric mappings are source-backed. Exact record/field permissions, compound-measure definitions, and permitted breakdowns require the reviewed entitlement matrix described in the architecture.

## 5. Release-one scope

### 5.1 Included

- Real Supabase authentication for provisioned demonstration accounts.
- One shared Orbit application with 14 distinct role views.
- All 109 role-KPI assignments, correctly mapped to their definitions and components.
- Morning brief, priority inbox, KPI explorer, and governed Ask for every role.
- Persisted, human-confirmed internal actions and an access-controlled audit trail.
- Scope, period, unit, provenance, freshness, and data-quality disclosures.
- A reproducible fictional-company dataset and a repeatable demonstration.
- Separate frontend/backend Vercel deployments with tested connectivity.
- Automated contract, calculation, authorization, data-invariant, and integration tests.

### 5.2 Not included

- Real patient, employee, payer, or client operational data.
- Clinical decision support, diagnosis, treatment recommendations, or claims of clinically validated thresholds.
- Live HIS/EMR, finance, CRM, insurer, HR, or procurement-system integrations.
- A system-of-record replacement for those systems.
- Signup, user-facing role switching, impersonation, or an administration dashboard.
- Autonomous emails, payments, staffing changes, external tickets, or clinical actions.
- Arbitrary user SQL, unrestricted enterprise search, or an autonomous general-purpose agent.
- On-premises/client-bound identity, certified compliance, immutable storage, or an established data-residency guarantee.
- AWS migration, a new cloud-auth provider, or a second backend platform.

“All 14 dashboards” expands role coverage; it does not mean all possible enterprise integrations belong in the first release.

### 5.3 Delivery strategy for a satisfying first release

The first vertical slice is deliberately narrow in interaction, not in final role coverage:

1. Regional COO North opens the morning brief.
2. The brief surfaces a labelled capacity exception at an authorized facility.
3. The user opens the exception and sees component evidence, numerator/denominator, period, scope, data quality, and permitted facility context.
4. Guided Ask explains the evidence using a structured response.
5. The user records an internal action for the permitted Hospital DHO.
6. The audit view shows the action and evidence link after refresh.
7. The same request is attempted from Regional COO South and is denied.

Once this works against real authorization and persisted data, the same interaction contract is reused for Chairman, Clinical Director, Hospital DHO, and the remaining roles. Each role still receives its complete workbook KPI set and a role-specific scenario before release. This sequencing reduces integration risk without reducing the confirmed release scope.

### 5.4 Lean MVP implementation policy

The product should spend complexity on decision quality, explanation, accessibility, and trustworthy authorization—not on framework breadth. The first release therefore adopts React Router v7 data-router APIs in SPA mode for route loaders, actions, fetchers, pending states, error boundaries, and mutation revalidation. React state remains for local presentation state; no Redux, Zustand, or client cache is required for the vertical slice.

Use native HTML controls first. Selective unstyled Radix Primitives may be wrapped in `packages/ui-kit` for dialogs, popovers, tabs, or focus management when they materially improve keyboard and screen-reader behavior. A styled component library, a second accessibility abstraction, or a full design system is not an MVP dependency. TanStack Query, TanStack Table, React Hook Form, React Aria, and similar tools remain optional until a measured requirement (cache complexity, large-table interaction, complex nested forms, or an accessibility gap) justifies them.

Docker is not replaced by a framework. A container runtime is required only for a fully local Supabase CLI stack; hosted non-production Supabase projects, deterministic contract fixtures, linked migrations, and CI/remote RLS tests are the supported default development path. This lowers setup weight without treating fixtures as a substitute for real authorization or integration tests.

Quality gates use Vitest for unit and contract coverage, Vitest Browser Mode for critical browser behavior where practical, and one small Playwright + `@axe-core/playwright` smoke suite for the Regional COO journey and 390px/768px/desktop checks. Axe findings do not replace manual keyboard review, and a green fixture test does not prove a deployed boundary.

## 6. Functional requirements

### FR-01 — Identity and scope

- Accounts are provisioned out of band; no end-user role or scope changes.
- Authentication establishes a verified subject. Trusted membership and entitlement records establish that subject’s Orbit role, organization, metric access, actions, and allowed data grain.
- Display the current role and scope. A UI filter may narrow authorized data, never grant additional access.
- Deny missing, inactive, ambiguous, or unauthorized memberships.
- Return an explicit `out_of_scope` response for a request for broader data; do not quietly present a partial answer as the complete result.
- Clear protected UI state when the user signs out, changes session, or loses access.

### FR-02 — Morning brief

Show the selected reporting period and “as of” time, then prioritize the first screen in this order:

1. **Act now:** the small number of material exceptions requiring a decision.
2. **Monitor:** important movement that does not yet require an action.
3. **On track:** useful reassurance, not a wall of green cards.
4. **Data limitations:** late, unreconciled, unavailable, or illustrative inputs.

Each exception must answer “what changed, why it matters, who owns it, and what can I do next?” before the user opens the explorer. Every assertion must resolve to an authorized observation, scenario, or recorded action.

A missing or late source must be disclosed, not filled with a plausible number. The brief must distinguish a prior-period comparison from a budget comparison. The display must always include the illustrative-data disclosure.

A daily visit does not imply daily source updates. Monthly source data remains monthly, with its real synthetic period and simulated refresh timestamp.

### FR-03 — Priority inbox

Show exceptions ordered by transparent severity and relevance, including source, scope, period, accountable owner, and action state. Serious safety, legal, and compliance exceptions remain visible even when weighted performance is favorable.

Users can inspect evidence and, where permitted, record an internal action. Automatic exception detection must use a reviewed rule; otherwise show a deliberately seeded scenario labelled as such. No arbitrary “red below 85” rule.

### FR-04 — KPI explorer

For every authorized assignment show:

- Definition and component measures, unit, direction, review cadence, source reference, and weight.
- Actual and target basis, with explicit “target not configured” when appropriate.
- Trend and authorized comparisons with compatible periods, definitions, and denominators.
- Numerator/denominator or other lineage needed to understand calculated measures.
- Data quality, reconciliation status, limitations, and visible illustrative provenance.

Support date/period selection and permitted breakdowns. A group KPI may have an authorized aggregate without exposing its raw contributors.

Do not collapse “collections and DSO,” “revenue and margin,” or similar bundles into an unexplained percentage. Mixed-unit capacity measures must remain separate unless a reviewed, dimensionally valid composite is defined.

For a capacity exception, a satisfying explorer result is not only a six-month line. It must show the relevant components—for example staffed beds available, staffed beds used, admissions/throughput where defined, and the numerator/denominator used for utilisation—plus the authorized facility split and data-quality caveats. Component selection must follow the KPI definition; the example is not permission to invent clinical submetrics.

### FR-05 — Governed Ask

Ask operates on **already authorized evidence**, not on an entire workbook or database sent to a model and filtered afterward.

Proposed v1 question classes:

- Explain a KPI definition or target basis.
- Report performance for an authorized period and scope.
- Compare compatible periods or permitted entities.
- Explain observed contributors to a change, without asserting unproven causation.
- Summarize authorized exceptions, owners, and recorded actions.

The Ask surface provides curated guided prompts below the input, generated from the role’s authorized KPI and scenario set. Examples include “Show the top authorized cost variances,” “Explain the current capacity exception,” and “List pending governance actions.” Prompt labels must be derived from the framework/configuration, not hard-coded as if they were universal facts.

Every answer renders an **Evidence Card** with these sections: **Answer**, **Relevant records**, **Definition/policy basis**, **Reasoning from observed evidence**, **Possible next action**, and **Scope/period/limitations**. “Policy basis” means the approved KPI definition, governance rule, target basis, or entitlement rule available to Orbit—not a fabricated external policy citation. Possible outcomes are answered, clarification needed, no data, out of scope, or unavailable. Unsupported questions must not receive invented numbers, policy citations, or confidence percentages.

**Provider decision remains open.** The recommended baseline is a deterministic, typed query catalogue with evidence templates; a server-side model adapter can interpret approved question classes and summarize permitted evidence after Aditya approves provider, costs, and egress rules. If the model is disabled, the UI must disclose the limited deterministic mode. Do not market that mode as unrestricted natural-language AI.

No model may issue arbitrary SQL, choose a role, expand scope, or execute an action. Prompt-injection defenses complement authorization; they do not replace it. [E3]

### FR-06 — Human decisions and internal actions

Proposed v1 workflow:

- Create an action from authorized evidence with an explicit permitted assignee and due date.
- Record acknowledgment, progress, completion, or cancellation through allowed state transitions.
- Persist the creator, actor, timestamps, reason, linked evidence, and version.
- Check both the creator’s and assignee’s permissions. Assignment must not accidentally grant access to hidden evidence.
- Reject stale concurrent updates and deduplicate retried creation requests.
- A successful write and its audit event must commit atomically.

No outbound side effect is implied. “Assigned” means stored in Orbit, not emailed or delivered to an external task tool. The exact transition/assignment matrix requires Aditya’s approval before implementation.

### FR-07 — Evidence and audit

Evidence links are role-protected and remain attributable to the dataset and definition version used. Existing actions retain their original evidence snapshot or version reference when observations change.

Audit records survive refresh, logout, and backend redeployment. App users cannot rewrite or delete them. Capture accepted actions, relevant data/evidence access, Ask outcomes, and authorization denials without logging secrets or unnecessary raw text.

This is an **application-protected persistent audit trail**, not a claim of cryptographic immutability or administrator-proof storage. Audit access itself requires explicit permissions. [E2]

### FR-08 — Usability and failure states

- Use shared design tokens, deliberate typography, accessible focus states, keyboard navigation, and non-color-only severity indicators.
- Prefer native controls; any adopted Radix primitive must be wrapped in `packages/ui-kit`, styled with Orbit tokens, and tested for focus return, keyboard operation, labeling, and escape behavior.
- Build distinct role emphasis and measure-appropriate layouts, not 14 copies of four identical KPI cards.
- The brief and inbox must be usable without horizontal scrolling at agreed 390px, 768px, and desktop widths. Explorer may progressively simplify dense tables on small screens, but it must preserve the definition, current value, limitation, and action path. Responsive behavior is a product requirement, not a later polish task.
- Show loading, empty, missing target, missing denominator, unreconciled, stale, forbidden, and dependency-unavailable states.
- Fail closed on authorization failure. A failed data request must not fall back to believable fabricated “live” content.
- A release is not complete if only the favorable demo path works.

## 7. KPI and scorecard governance

These requirements come from the workbook’s targeting and construction rules. [W3, W4]

1. Preserve one accountable owner per assignment; collaborators do not automatically receive access.
2. Version definitions, targets, directions, weights, and effective periods.
3. Keep weights at 100% for each role/version. Workbook weights do **not** authorize a scoring formula.
4. Specify higher-is-better, lower-is-better, or target-range semantics before scoring.
5. Do not invent clinical thresholds or interpret an unapproved target as a care standard.
6. Use comparable periods, definitions, cohorts, and denominators.
7. Aggregate ratios from compatible numerator/denominator totals—not averages of percentages.
8. Respect non-additive and semi-additive measures: DSO, closing balances, headcounts, inventory days, and rates need their own roll-up rules.
9. Keep missing data distinct from zero. A zero or invalid denominator must produce an explicit unavailable/not-applicable result according to the definition.
10. Do not silently drop missing KPIs and renormalize a weighted score.
11. Keep serious exceptions visible independently of an overall score.
12. Disclose limitations and reconciliation status wherever a number is used.

Until a reviewed scoring model exists, show component performance and available variances without a made-up overall health score.

## 8. Maruti’s fictional-company data brief

Maruti owns the company model, scenario design, generation, seeding, and verification—not just table creation.

### 8.1 Dataset shape

Confirmed: fictional company and synthetic demonstration data.

Proposed baseline for review:

- One clearly fictional healthcare organization.
- Six fictional hospitals, two regions, three hospitals per region, matching the framework’s operating shape.
- A documented fictional COE structure sufficient to exercise COE permissions.
- Twenty-four complete monthly periods for trends and seasonality, plus dated synthetic events for inbox/action demonstrations. Annual or quarterly measures must retain their actual cadence rather than acquire fabricated monthly observations.
- At least one account per role type, additional accounts for regional/facility isolation tests, and a second test-only organization for tenant-isolation tests. These are not a claim about the client’s final account count.

Maruti chooses fictional names, reporting currency, fiscal calendar, units, time zone, scale, scenario dates, and demo-only target parameters in a reviewed manifest. These are not Africare facts.

### 8.2 Coherent generation

Generate underlying synthetic facts first; derive KPI components and roll-ups from those facts:

- Revenue, costs, budgets, and EBITDA must reconcile according to a documented demo accounting model.
- Receivables, collections, billings, adjustments, and aging buckets must reconcile; DSO must cite its chosen denominator and period convention.
- Claims, denials, submissions, referrals, conversions, capacity, workforce counts, and completion measures must use compatible populations and units.
- COE/corporate segments may overlap hospital totals; label them as segments and never add them twice to the group.
- Explain intercompany eliminations or explicitly document their absence in the fictional model.
- A governance action appearing on multiple role views is one linked event with role-specific projections, not unrelated copies.

Do not seed a random target from 85–100 for every metric. A money measure, elapsed days, a count, a percentage, and a target-range measure cannot share an arbitrary target convention.

Maruti must run a **clinical and operational plausibility review** over the scenarios before they are used in a demo. Review each scenario for directionally coherent relationships between capacity, throughput, staffing, length of stay, quality/safety, patient experience, claims, collections, and cost. A synthetic value may be unusual by design, but it must have an explicit scenario explanation and must not imply a causal relationship that the generator did not model. The review is a demo-quality safeguard, not clinical validation.

### 8.3 Scenario coverage

Provide linked, labelled scenarios for revenue growth with margin pressure; delayed collections/aging; a claim-quality problem; a capacity issue; a staffing gap; a procurement/stock risk; a legal deadline; a clinical-governance exception; and a late/unreconciled data source.

These are fictional narratives to test the product, not asserted operational correlations. Each of the 14 roles needs at least one meaningful exception/evidence/action path.

Include adversarial fixtures: another region, another hospital, another organization, missing denominator, stale observation, unapproved target, access revocation, and conflicting concurrent action updates.

### 8.4 Provenance and reproducibility

- Retain `provenance: "illustrative"` and `data_quality.state: "illustrative"` in public records. Additional reconciliation/freshness dimensions must not make the data appear real.
- Display the UI-kit illustrative styling and a disclosure such as: “Fictional demonstration company. All figures and targets are illustrative; not validated clinical or financial guidance.”
- Use a fixed seed, stable IDs, definition versions, and a dataset checksum.
- Re-generation with the same configuration yields the same observations; operational timestamps must not break the reproducibility check.
- Seeds are environment-restricted and idempotent. Reset is explicit and separate from routine seeding.
- Demo account credentials come from secure provisioning, not committed JSON or a shared hard-coded password.

## 9. Release acceptance criteria

All criteria apply to the final integrated system, not isolated mocks.

1. **Coverage:** all 14 dashboards and all 109 source assignments are mapped; role weights match the workbook; all 29 definition families are preserved with unresolved component mappings visibly flagged.
2. **Access:** positive and negative tests for every role; cross-region, cross-facility, cross-organization, wrong-role, anonymous, expired-token, and inactive-membership requests cannot reveal protected data.
3. **Four-surface journey:** each role can read its brief, inspect an exception, explore supporting KPIs, and ask a supported evidence-backed question.
4. **Governed refusal:** an out-of-scope request is clearly refused, including attempted scope escalation through Ask and direct data API calls.
5. **Actions:** an authorized action persists across refresh/redeployment with one corresponding committed audit transition; retries do not duplicate it and stale updates fail clearly.
6. **Data integrity:** reconciliation, roll-up, denominator, dimension, version, missing-data, and provenance checks pass deterministically.
7. **Truthfulness:** no invented actuals, policy citations, confidence percentages, real-data labels, or unsupported clinical scoring.
8. **UI:** all roles have meaningful distinct emphasis, accessible status indicators, illustrative labels, and tested unavailable/forbidden states.
9. **Deployment:** frontend and API reach the intended environment; allowed CORS preflights pass; unapproved origins do not gain browser access; reload and authentication redirect paths work.
10. **Security:** exposed credential remediation is verified, privileged keys are absent from client bundles/repository content, and RLS/grants/RPCs have negative tests.
11. **Quality gates:** build, strict typecheck, lint, tests, data verification, and deployed integration checks pass against pinned versions.
12. **User value:** a representative founder/Chairman can identify the top decision from the brief within 60 seconds; a representative Regional COO can complete the vertical slice in §5.3 without coaching.
13. **Explainability:** a user can answer which definition, period, scope, evidence, and data-quality state support a displayed result; component/denominator evidence is present for every compound KPI used in the vertical slice.
14. **Guided Ask:** each role has at least three useful guided prompts, one structured evidence answer, one clarification/no-data case, and one out-of-scope refusal.
15. **Responsive use:** brief and inbox usability is verified at 390px, 768px, and the agreed desktop profile; no core action requires horizontal scrolling.
16. **Browser quality:** the post-deploy Playwright smoke path covers the Regional COO journey, denied out-of-scope access, action persistence after refresh, and axe checks on the core screens; manual keyboard review is recorded separately.
17. **Expectation setting:** the demo explicitly states that v1 uses fictional aggregate data, does not implement the pitch’s client-bound tokenization/vault/jurisdiction claims, and records internal actions without sending external notifications.

Proposed engineering targets, not contractual SLAs: ordinary authenticated API reads p95 under two seconds and the initial dashboard usable within three seconds on an agreed desktop/network profile. Measure cold and warm behavior separately, record dataset/concurrency/region, and have Aditya approve the test envelope. Ask latency and spend budgets depend on the unresolved model decision.

## 10. Decisions still open

These do not prevent documenting the architecture. They gate the affected implementation or any real-data rollout:

- **Business definitions — Aditya, with appropriate future domain reviewers:** resolve the `Group Scorecard!B4` “CMO accountability” header; confirm whether the missing Chairman people KPI is intentional. Preserve the seven source assignments meanwhile.
- **Naming — Aditya:** approve any Chairman/CEO display alias; use workbook names until then.
- **Metric governance — Maruti drafts, Aditya reviews:** component mappings, directions, scoring, target ranges, fiscal/currency conventions, and materiality. Fictional target parameters are not client-approved thresholds.
- **Entitlements — Aditya owns, Maruti/Ghansham review:** exact permitted metric grains, drill-downs, evidence fields, action assignment, and audit access per account type.
- **Ask — Aditya with Ghansham:** provider, retention/egress terms, cost limits, supported language behavior, and whether the first demo uses a live model or explicitly limited deterministic mode.
- **Workflow — Aditya:** action transitions and whether any future outbound notification is required; default proposal is internal persistence only.
- **Operations — Aditya:** actual domains, Supabase/Vercel regions and plans, preview isolation, credential remediation, retention, backup/restore objectives, and an agreed performance envelope.
- **Delivery — all four:** capacity, dates, and estimates. No deadline was supplied; the assignments use dependency gates rather than fictional dates.
- **Real-data pilot — business/legal/security owners not yet named:** jurisdiction, residency, lawful processing, vendor agreements, clinical validation, source-system access, and client security requirements.
- **Client promise alignment — Aditya:** before any external demo, confirm whether the buyer expects the pitch’s on-premises/tokenization/security architecture or accepts the hosted fictional-data prototype as the current outcome.

## 11. Comparable platforms: lessons, not dependencies

- **Palantir Foundry/AIP:** connects governed data, business logic, applications, and workflows. Orbit borrows the evidence-to-decision concept, not its enterprise feature claims or architecture scale. [E4]
- **Power BI:** demonstrates mature semantic-model and row-level-security concepts. Its guidance also warns that aggregate totals can allow inference of restricted regions. Orbit must treat aggregates and drill-downs as permissions, not just chart options. [E5]
- **Frappe Insights:** separates application, resource, and row-level permissions. Orbit similarly needs more than “hide this dashboard” authorization. [E6]

No platform above is selected as an Orbit dependency.

## Appendix A. Complete source KPI coverage

Titles and weights below are transcribed from `Role KPI Matrix`, column E and column G. Numbers in parentheses are source weights, not computed performance scores. Definition/formula, target basis, review cadence, primary data source, and collaborators remain in workbook columns F and H–K and must also be imported.

### Chairman — rows 6–12

- Group net revenue vs approved budget (20%).
- Group EBITDA vs approved budget (20%).
- Operating cash flow and working capital vs plan (15%).
- Group clinical quality and safety index (15%).
- Group patient experience index (10%).
- COE, corporate and expansion milestones (10%).
- Critical governance, legal and audit actions closed (10%).

### Chief / Group Clinical Medical Director — rows 13–20

- Clinical quality scorecard (20%).
- Serious adverse-event rate and review closure (15%).
- Protocol compliance and critical audit closure (15%).
- Clinical patient experience score (10%).
- Medical credentialing and capability completion (10%).
- COE revenue and contribution vs plan (12%).
- Clinical propositions converted to revenue (10%).
- Priority-care referral conversion (8%).

### Regional COO — rows 21–29

- Regional net revenue vs approved budget (15%).
- Regional EBITDA vs approved budget (15%).
- Hospital and clinic capacity utilisation (10%).
- Patient volume and referral conversion (10%).
- Collections and DSO vs plan (12%).
- Claim clean rate and denial value (10%).
- Patient experience and CAPA closure (10%).
- Engagement and critical-role retention (8%).
- New service, COE and corporate revenue vs plan (10%).

### Hospital DHO — rows 30–38

- Hospital net revenue vs approved budget (15%).
- Hospital EBITDA vs approved budget (12%).
- Capacity utilisation and patient throughput (12%).
- Referral conversion and new service revenue (10%).
- Patient experience and complaint CAPA closure (10%).
- Collections, DSO and unbilled revenue (12%).
- Claim first-pass acceptance and rejection value (10%).
- People productivity, engagement and critical attrition (10%).
- Facility readiness, licensure and safety actions (9%).

### People Executive — rows 39–46

- Approved position fill rate and time to fill (15%).
- Roster adherence and labour productivity (15%).
- Critical-role attrition (15%).
- Engagement score and action closure (15%).
- Performance review and talent-matrix completion (10%).
- Mandatory training and credentialing completion (15%).
- HR and statutory actions closed on time (10%).
- Manpower cost vs plan (5%).

### Business Development Lead — rows 47–54

- New business revenue vs plan (20%).
- Qualified pipeline coverage (10%).
- Lead-to-revenue conversion (15%).
- Active referrer network and referral revenue (15%).
- New-service and COE lead conversion (15%).
- Corporate opportunities handed over and accepted (10%).
- CRM completeness and forecast accuracy (5%).
- Acquisition economics vs plan (10%).

### Billing & Revenue Lead — rows 55–62

- Claim first-pass acceptance rate (15%).
- Claim submission turnaround time (10%).
- Rejected or denied claim value (15%).
- Cash collections vs monthly plan (15%).
- DSO and aged receivables (15%).
- Unbilled revenue and cash-posting reconciliation (15%).
- Payer reconciliation and documentation completeness (10%).
- Revenue leakage and avoidable credit notes (5%).

### COE Lead — rows 63–70

- COE net revenue vs plan (20%).
- COE contribution margin or EBITDA vs plan (15%).
- COE capacity utilisation and case volume (10%).
- COE referral conversion (15%).
- COE outcomes and protocol compliance (15%).
- COE patient experience score (10%).
- Approved COE programme milestones (10%).
- COE medical-team capability and engagement (5%).

### Corporate Revenue & Insurance Lead — rows 71–78

- Corporate and insurer net revenue and margin vs plan (20%).
- Active contracted accounts vs plan (15%).
- New corporate and insurer tie-up conversion (15%).
- Contract renewal and account retention rate (10%).
- Contract utilisation and revenue per account (10%).
- Commercial term yield (10%).
- Payer issue closure (10%).
- Pipeline forecast accuracy and CRM completeness (10%).

### Group CFO — rows 79–85

- Group EBITDA vs approved budget (20%).
- Cash flow, liquidity and working capital vs plan (15%).
- Group collections and DSO vs plan (15%).
- Forecast and budget quality (10%).
- Controllable cost improvement vs plan (15%).
- Financial controls and leakage actions closed (10%).
- Finance compliance and audit-action closure (15%).

### Procurement Head — rows 86–93

- Finance-validated procurement savings vs plan (20%).
- Contract and purchase-order compliance (10%).
- Critical consumable stockouts and service disruption (15%).
- Inventory days and obsolete stock (15%).
- Purchase request to purchase-order turnaround (10%).
- Supplier quality and service-level performance (10%).
- Rate-card adherence and maverick spend (10%).
- Supplier risk and continuity actions closed (10%).

### HR Head — rows 94–100

- Group workforce cost and productivity vs plan (15%).
- Critical-role staffing and time to hire (15%).
- Group and critical-role attrition (15%).
- Group engagement score and action closure (15%).
- Mandatory learning, capability and succession coverage (15%).
- Performance-management and talent-review completion (10%).
- Employment compliance and grievance closure (15%).

### Legal Head — rows 101–107

- Contract turnaround time (15%).
- High-risk contract review and approval compliance (15%).
- License, filing and regulatory-calendar compliance (20%).
- Material litigation and dispute action milestones (15%).
- Commercial and payer dispute support turnaround (10%).
- Policy refresh and required legal training completion (10%).
- Governance and audit legal actions closed (15%).

### Head of Analytics & Digital Transformation — rows 108–114

- KPI dashboard availability and refresh on time (15%).
- KPI data quality and reconciliation (20%).
- Monthly KPI pack delivered to calendar (15%).
- Priority dashboard adoption and report rationalisation (10%).
- Revenue, collections and cash forecast accuracy (15%).
- Approved insight actions closed (10%).
- Digital roadmap and benefit realisation (15%).

## Sources and verification limits

### Primary project sources

- **W1:** `../../Africare_Group_KPI_Framework.xlsx`, `Group Scorecard`: outcomes rows 5–12, accountability rows 16–29, operating rules rows 33–36.
- **W2:** Same workbook, `Role KPI Matrix`: headers row 4; assignments rows 6–114.
- **W3:** Same workbook, `KPI Definitions`: 29 families, rows 6–34.
- **W4:** Same workbook, `Governance & Targeting`: targeting families rows 5–14; construction rules rows 18–23.
- **P1:** `../../Command_Center_Client_Pitch_updated.pptx.pdf`, all 13 pages; especially role framing on slide 4, architecture on 6, security claims on 7, evidence/vault on 8 and 13, demo on 10, staged rollout on 11.
- **R1:** Existing `../../AGENTS.md`, `../../TECH_STACK.md`, `../../RBAC_MODEL.md`, `../../CONTRACTS.md`, `../design-guidelines.md`, and `../OPEN_QUESTIONS.md`; historical constraints interpreted using the confirmed new-scope decisions above.
- **R2:** Local `main` at `63f0fcb` and fetched `origin/main` at `81cc292`; exact reuse findings in the architecture.

### External references, consulted 22 September 2026

- **E1:** [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html): deny by default and validate authorization on every request.
- **E2:** [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html): protected logs and exclusion of secrets.
- **E3:** [OWASP LLM Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/): untrusted model input is not an authorization boundary.
- **E4:** [Palantir platform architecture](https://palantir.com/docs/foundry/architecture-center/platforms/).
- **E5:** [Microsoft Power BI RLS guidance](https://learn.microsoft.com/en-us/power-bi/guidance/rls-guidance).
- **E6:** [Frappe Insights permission layers](https://docs.frappe.io/insights/permissions-access-control/overview).
- **T1:** [React Router `createBrowserRouter`](https://reactrouter.com/api/data-routers/createBrowserRouter), [Data Mode route objects](https://reactrouter.com/start/data/route-object), and [mode guidance](https://reactrouter.com/main/start/modes), consulted for the Vite SPA loading/mutation approach.
- **T2:** [Radix Primitives](https://www.radix-ui.com/primitives/docs/overview/introduction), [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing), and [Vitest Browser Mode](https://vitest.dev/guide/browser/), consulted for selective accessibility primitives and browser-quality gates.
- **S1:** [Supabase local development](https://supabase.com/docs/guides/local-development) and [CLI getting started](https://supabase.com/docs/guides/cli/getting-started), consulted for the Docker-compatible local runtime requirement and linked hosted workflow.

**Verified:** workbook contents, supplied pitch export, and the cited code snapshots were inspected. External platform capabilities were checked against documentation.<br>
**Unverified/proposed:** all new Orbit frontend/API/database/auth/AI/deployment boundaries; no new system exists to test yet. No live database, cloud settings, real source-system connection, or full browser journey was validated.
