# ADR 0023: Outbreak watch — presenting conditions, a surge rule, and an XGBoost forecast

**Status:** Accepted (2026-10-07, product owner)
**Builds on:** ADR 0016 (ERP), ADR 0018 (Orbit uses ERP data), ADR 0020 (reference datasets), ADR 0022 (billing)

## Context

The product owner asked for a warning when many patients with the same disease arrive across the group, so hospitals can prepare. The example given was 50 or more patients across 5 hospital branches. The warning should go to the leaders with authority to act, with a forecast of what comes next.

The ERP recorded no reason for a visit, so nothing could be counted. On 2026-10-07 the product owner decided:

1. **Approach:** the fixed rule now, plus an XGBoost forecast now.
2. **What is counted:** a presenting condition, picked from a fixed list on each visit.
3. **Who sees it:** chairman, clinical director, regional COOs and hospital DHOs.
4. **Window:** the last 7 days.

## Decisions

### §1 Presenting conditions (migration `20261007000100`)

- **The list:** `orbit_erp.conditions` holds one fixed list per organization (code, name, category). It comes from the reference hospital dataset's disease table (`deriveConditions`, seed `0208_conditions.sql`): 20 conditions. An admin may add or retire one. Desk staff only read the list.
- **The visit:** `encounters.presenting_condition_id` is optional. A trigger refuses a condition from another organization or a retired one (`erp:condition_unknown`).
- **The history:** the dataset's admissions record their disease. The loader copies it onto 43,628 historical visits (2020-09-16 to 2026-09-17), so the forecast has history to learn from.
- **What it is not:** a presenting condition is what the patient came in with, as the desk records it. It is not a diagnosis. The ERP pages say so beside the field.

### §2 The rule

`orbit_erp.surveillance_settings` holds one row per organization, seeded at 7 days, 50 patients and 5 hospitals.

A condition is **on alert** when two things are true in the last `window_days` days, counted in the organization's time zone:

- at least `min_patients` distinct patients had a visit recording it;
- they came to at least `min_hospitals` distinct hospitals.

Beside each count, the feed shows the **usual** level: the mean of the four earlier windows. No threshold is invented beyond the three numbers the product owner set.

### §3 Who sees what (the scope exception)

- **Who:** `GET /api/surveillance` serves `SURVEILLANCE_ROLES` only. Every other role gets 403 `surveillance_role_not_permitted`, not an empty page.
- **Group totals, for every permitted role.** Per condition: patients, hospitals, usual level, alert and forecast. A DHO scoped to one hospital therefore learns that a group-wide surge exists. That is the purpose: a hospital must be told when it is part of one. It is a deliberate exception to "only data inside the scope". It discloses **counts only**: no patient, no other hospital's name and no other hospital's count.
- **Per-hospital counts, inside the scope only.** `surveillance_hospitals()` is bounded by `ops_visible_facilities`, exactly like the operations and revenue feeds. The API also refuses (500, fail closed) any hospital it cannot name from the caller's own entity directory.
- **The database functions:**
  - All three are `security definer` and return nothing without a leader's claims. They return nothing for an operator's claims or for no claims at all.
  - The forecast tables have no policies, so `orbit_app` reaches them only through these functions.
  - The writer, `store_forecast_run`, checks that every row's condition and hospital belong to the run's organization, and keeps the last 30 runs.

### §4 The forecast (`tools/forecast/`)

- **Model:** XGBoost, `count:poisson` objective, through the native `xgb.train` API. Its scikit-learn wrapper would add scikit-learn as a dependency for nothing.
  - Pinned: `xgboost==3.4.1`, `numpy==2.5.3`, `psycopg[binary]==3.3.6`.
  - Fixed seed, 2 threads, 300 rounds, depth 4.
- **Rows and target:** one row per hospital, condition and day. The target is the patients in the next `window_days` days.
- **Features:**
  - counts in the last 1, 7, 14 and 28 days, and the 7 days before that;
  - the group's count of the condition;
  - the hospital's count of all conditions;
  - weekday and month;
  - condition and hospital ids.
- **Honest accuracy:** the last 8 weeks of origins are held out. The model's mean absolute error is stored beside a naive baseline's ("the next window repeats the last one").
  - Leaders see both numbers, and whether the model beats the baseline.
  - On the reference history it barely does: 0.911 against 0.932. The dataset spreads its diseases evenly, with no real outbreaks.
- **Probabilities (stated as assumptions in the stored notes):**
  - **P(at least `min_patients`):** a Poisson tail around the predicted group total.
  - **P(at least `min_hospitals` hospitals see a case):** a Poisson-binomial over each hospital's P(at least 1 patient). It treats hospitals as independent.
  - The page never shows "100%" or "0%".
- **Too little history** (under 120 days) gives no forecast, not a guess.
- **Inputs:** the job reads counts only, through `condition_daily_counts`. It writes only the forecast tables.

### §5 Running it

- `.github/workflows/forecast.yml` runs daily and on demand. It runs the unit tests first, then `forecast.py` with `DATABASE_URL` (orbit_app through the pooler, the same secret the knowledge sync uses). It is skipped while the secret is missing.
- **Staged demonstration:** the simulator stages an outbreak only when `SIM_OUTBREAK_CONDITION` is set to a code on the list. `SIM_OUTBREAK_PER_HOSPITAL_PER_DAY` sets the rate (1 to 50, default 12). The live-hospital workflow reads both from repository **variables**, so a demonstration is switched on and off without a code change. An unknown code stages nothing.
- **Normal simulator visits:** each new visit records a random condition from the list.

### §6 Pages

- **Orbit, "Outbreak watch"** (`/outbreak-watch`, in the navigation only for the four roles):
  - the alerts, each with "Prepare for …", the counts and the forecast;
  - every condition, group-wide;
  - the hospitals in the caller's scope;
  - the model, its accuracy against the baseline, and the limitations.
- **ERP:** a "Presenting condition" field on **Start visit** and on the visit page, with "Not recorded" as the default. The visit heading shows the condition.

## Not decided here (labelled, not invented)

- Real notifications (email, SMS, pager). The alert is shown in Orbit only.
- Clinical guidance on what "prepare" means. The page says only to review staffing, beds and supplies.
- Any public-health reporting duty. This is synthetic demonstration data, not a notification system.
- Changing the rule from the UI. It is a database row today, changed by migration or by an admin with database access.

## Research record

XGBoost 3.x documentation (xgboost.readthedocs.io, "Python API" and "Learning task parameters"):

- `count:poisson` is the documented objective for count data. It predicts the mean in the original scale.
- The native `train`/`DMatrix` API needs only numpy.

Alternatives considered:

- **A rule alone:** kept as the alert, but the product owner asked for probabilities.
- **A seasonal-naive or Poisson GLM:** the naive model is used as the baseline instead.
- **Prophet:** heavier, and one series at a time.

The forecast runs in GitHub Actions, outside the API, so no Python enters the Vercel deployments.
