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

Open the **Assistant** (bottom right). Its header names the signed-in role; every answer uses only what that role may read.

- Choose a **suggested question**, e.g. "Summarize my open exceptions": a typed evidence card with its table, and **Record an action from this**.
- Type "Show me the south region revenue" (as the North COO): **Out of scope**. Nothing is searched and no North figure is offered in its place.
- Type a question about the hospital data, e.g. "How many patients were admitted as emergencies?" (chairman) or "Which medicines are running low?" (procurement head): a cited answer. Open **sources** to see where each figure came from.

For comparisons in plain words, use **Open Ask** in the Assistant's header (the full Ask page):

- "Which hospital is worst on EBITDA?" — a table of the three hospitals, lowest and highest named.
- "Did revenue go up or down since July?" — two months side by side, change in percentage points.

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

## Hospital operations (ERP)

The hospital operations area ([ADR 0016](../decisions/0016-erp-module-and-operator-roles.md)) is for two accounts that are not leadership roles:

| Account | Sign in as | Scope |
|---|---|---|
| Hospital operations desk | `hospital` (or `hospital@kestrion.demo`) | Kestrion Avenhurst Hospital |
| Hospital operations admin | `admin` (or `admin@kestrion.demo`) | Whole group; chooses a facility in the sidebar |

As with every demo account, passwords are shared separately by the demo owner and never written in the repository. Both accounts open on `/erp`. A leadership account sent to `/erp` goes back to its own workspace, and an ERP account never sees the leadership workspace.

**Before a demo:**
1. Apply migration `20261001000100_orbit_erp_operations.sql` and seeds `0008`–`0010` to the project.
2. Put the two passwords in `supabase/.env.provisioning`, along with the variables listed in `packages/data-gen/scripts/provision-erp-accounts.ts`.
3. Run `npm run provision:erp --workspace=@orbit/data-gen`.
4. Apply the membership SQL it writes to `supabase/seed/local/`.
5. Add `erp` to the API's `ORBIT_LIVE_SOURCES`.

**Walkthrough (about 10 minutes):**
1. **Today** (hospital account): who is rostered, on duty, late, missing a punch or absent, plus open visits and what needs a decision.
2. **Attendance**: pick **28 September 2026** to see a full day of derived statuses, with in and out times and worked hours. A missing punch reads "Not complete", never zero.
   - On today's board, press **In** for someone on the current shift.
   - Press **In** for someone whose shift starts later: Orbit records it but says it does not count toward the shift.
3. **Fix times** on a missing-punch row to request a correction.
4. Sign in as **admin** and approve it under **Corrections**. The day re-derives as corrected. An admin cannot approve their own request.
5. **Patients** (hospital account): search, then register a fictional patient. Registering the same name and birth year again is flagged as a possible duplicate, not merged.
6. Start a visit, record a service, and close the visit. Services can only be recorded where offered, by staff at that facility, by doctors with a valid credential, and inside the visit's time.
7. **Doctors** (admin, Dunmarrow): two credentials are expiring and one expired in September (labelled scenario).
8. **Brackmoor attendance**: the last week of September shows a missing-punch cluster (labelled scenario).
9. **Audit trail** (admin): every patient and visit opened, and every change, by role and time, never the contents.

The ERP dataset's punches, visits and services end on **30 September 2026**. Rosters run to 31 October, so today's board shows scheduled and absent staff until the desk records punches. That is correct, not missing data.

## Known limitations to state up front

- All data is synthetic and illustrative; targets are demo parameters, not approved targets.
- Some KPIs share a workbook definition family, so a KPI titled e.g. "Claim submission turnaround time" shows its family's measure (first-pass acceptance). A per-KPI definition is Maruti's open item.
- Hospital operations records (patients, staff, attendance, visits, services) are fictional. The module is a demonstration, not a hospital information or HR system, and holds no clinical content. Its ERP sign-ins use demo passwords: rotate them before any external audience.
- The AI runs on free-tier model providers; under bursts of questions an answer can take several seconds or ask the user to try again. Guided questions never depend on the AI.
