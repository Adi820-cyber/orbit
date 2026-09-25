# Orbit — Demo Runbook

For whoever presents Orbit to stakeholders. Everything shown is the fictional **Kestrion Health Group**; every figure and target is illustrative synthetic data, and the product says so on every number.

## Where

| What | Address |
|---|---|
| Web app | https://orbit-web-steel.vercel.app |
| API health | https://orbit-api-theta.vercel.app/health |

Both run on Vercel (API in Mumbai, next to the Supabase project). Deploys are currently made from the CLI; automatic deploy on push to `main` needs Vercel's GitHub app on the repository.

## Demo accounts

One account per role. Passwords are shared separately by the demo owner; they are never written into the repository.

| Role | Sign in as | Scope |
|---|---|---|
| Chairman / CEO | `chairman@kestrion.demo` | Group |
| Chief / Group Clinical Medical Director | `clinical-director@kestrion.demo` | Group and COEs |
| Regional COO (North) | `regional-coo-north@kestrion.demo` | Northern Region |
| Regional COO (South) | `regional-coo-south@kestrion.demo` | Southern Region |
| Hospital DHO | `hospital-dho@kestrion.demo` | Avenhurst Hospital |
| People Executive | `people-executive@kestrion.demo` | Avenhurst Hospital |
| BD Lead | `bd-lead@kestrion.demo` | Avenhurst Hospital |
| Billing & Revenue Lead | `billing-lead@kestrion.demo` | Avenhurst Hospital |
| COE Lead | `coe-lead@kestrion.demo` | Cardiac Sciences COE |
| Corporate Revenue & Insurance Lead | `corporate-revenue-lead@kestrion.demo` | Group |
| Group CFO | `group-cfo@kestrion.demo` | Group |
| Procurement Head | `procurement-head@kestrion.demo` | Group |
| HR Head | `hr-head@kestrion.demo` | Group |
| Legal Head | `legal-head@kestrion.demo` | Group |
| Analytics Head | `analytics-head@kestrion.demo` | Group |

`isolation-chairman@halveston.demo` and `isolation-hr-head@halveston.demo` belong to a second, empty test organization. They exist to prove organizations cannot see each other; their brief says no dataset has been loaded, which is correct.

## Walkthrough (about 15 minutes)

### 1. Morning brief: find what needs a decision (Regional COO North)

Sign in as the North COO. The brief opens on the reporting period (August 2026) and its as-of time, then **Act now**, **Monitor**, **On track** and **Data limitations**.

- Point out *Regional EBITDA vs approved budget* under Act now: what changed, why it matters (its scorecard weight), and the label saying it is a seeded demo scenario, not a reviewed rule.
- Point out the data limitation: Avenhurst's cash-posting feed for August is late. Orbit shows it as **not reported**, never as zero, and the regional total says it excludes Avenhurst.

### 2. Evidence and lineage

Choose **Review evidence**. The KPI page shows the 24-month trend, the demo target, and each month's numerator and denominator, with its data-quality state. Choose the facility breakdown to see the three hospitals; the regional figure is their summed numerator over summed denominator, never an average of percentages.

### 3. Ask in plain words

Open **Ask Orbit** (bottom right). Try:

- "Which hospital is worst on EBITDA?" — a table of the three hospitals, lowest and highest named.
- "Did revenue go up or down since July?" — two months side by side, change in percentage points.
- "Show me the south region revenue" — refused: outside this COO's scope. Nothing from the South is used.

Open **How Orbit answered** under an answer: the reasoning, the KPI definition it used, and the scope. The AI only chooses from the user's own KPIs and rewords the sentence; every figure comes from Orbit.

### 4. Decide and delegate (COO → DHO → Billing Lead)

1. As the North COO, on the EBITDA exception choose **Record action**, pick the Hospital DHO and a due date.
2. Sign in as `hospital-dho@kestrion.demo`. The action appears in **Actions** with only the moves the DHO may make: **Acknowledge**, then **Start work**.
3. Under **Delegate part of this work**, hand a task to the Billing Lead. The DHO cannot submit the action for approval while that task is open.
4. As the Billing Lead: acknowledge, start, **Submit for approval**. As the DHO: **Approve** the task, then **Submit for approval** on the main action.
5. As the COO: the action waits under **Waiting for your approval**. **Send back** with a note, or **Approve**.

Every step asks for a note; the action's **History** shows who did what and why. Nothing is emailed or sent outside Orbit.

### 5. Audit

Open **Audit**: each creation and state change, by role, with the action named. App users cannot rewrite or delete entries.

## Other scenarios worth showing

| Role | What to point at |
|---|---|
| Clinical Director | Protocol compliance at the Oncology COE fell after the clinical-governance scenario began (June 2026). No clinical threshold is applied; it is compared with the month before. |
| Group CFO | Group EBITDA at 82.6% of budget (growth with margin compression, from March 2026). |
| Billing Lead | Cash collections and DSO show **not reported** for August (late feed); first-pass acceptance and denials still report. |
| Procurement Head | Inventory days rising across the group (consumable supply risk, from June 2026). |
| HR Head | Performance-review completion at 88.6%, below the 93% demo target, labelled with Brackmoor's staffing-gap scenario (from April 2026). The People Executive is scoped to Avenhurst and does not see Brackmoor. |

## Known limitations to state up front

- All data is synthetic and illustrative; targets are demo parameters, not approved targets.
- Some KPIs share a workbook definition family, so a KPI titled e.g. "Claim submission turnaround time" shows its family's measure (first-pass acceptance). A per-KPI definition is Maruti's open item.
- The AI runs on free-tier model providers; under bursts of questions an answer can take several seconds or ask the user to try again. Guided questions never depend on the AI.
