# Context for continuing Orbit

Hand this file to an AI coding agent, or reread it yourself, before picking the work up. It records how the work has been done, what went wrong along the way, and where it stands. It complements `AGENTS.md` and `RULES.md`, which still govern. Current as of **2026-10-07**, main at `56adf5c`.

## Who decides what

- **Ghansham** (GitHub `ghanshamrna27`) builds Orbit alone since 2026-10-06. He is the product owner, the reviewer for every path, and the owner of the hosting: Vercel, Supabase and GitHub Actions. The earlier team (Aditya, Ayas, Maruti) has left; old documents still name them as owners.
- **Product decisions** are recorded as ADRs, with the date and "product owner". When a requirement, threshold, price, target or authorization rule is missing, **ask; do not invent it**. Recent examples of decisions asked rather than assumed:
  - currency INR;
  - desk bills, admin prices;
  - outbreak rule 7 days, 50 patients, 5 hospitals;
  - outbreak audience: chairman, clinical director, regional COOs, DHO.
- **Standing instructions from the owner:**
  - Work autonomously: branch, PR, CI, merge, migrate, deploy and verify live. The owner has said "do all things yourself" and "project should be fully working".
  - Demo passwords are deliberate for the demo. Keep the existing AI keys; do not rotate them.
  - Never print a secret. Refer to variables by name. If a tool refuses to read or write a credential, stop and give the owner the command to run instead of working around it.

## How a change is done here

1. **Read first:** the relevant ADRs, `docs/orbit/*`, the nearest code, and `git status`. Search for an existing helper or contract before adding one.
2. **Branch:** `ghansham/<scope>-<change>` from up-to-date `main`.
3. **Order of work** (one feature):
   1. migration (tables, RLS, functions, grants);
   2. contracts in `packages/contracts`;
   3. API `db/*.ts`, `modules/<area>/routes.ts`, `ports.ts`, `pending.ts`, `wiring.ts` and `test/helpers`;
   4. web pages and `lib/api.ts`, plus a preview fixture handler;
   5. simulator, if the feature generates activity;
   6. tests at each layer;
   7. an ADR, and the `FILE_STRUCTURE.md` lines.
4. **Gates:** see `HANDBOOK.md` §5. Run all of them, with the database URLs set, so nothing is skipped.
5. **Browser check:** for UI, run a Playwright script (Edge, `@axe-core/playwright`) that signs in as each affected role. It checks content, refusals, phone width, axe and console errors. Run it locally, then again on live.
6. **Ship:** PR (template filled in), green CI, merge. Then:
   - hosted `supabase db push --linked`, plus any private seed;
   - deploy the affected Vercel projects from clean worktrees;
   - run a simulator tick and confirm `failures: 0`;
   - rerun the browser script on the live addresses;
   - `git push pragyan main`.
7. **Report:**
   - changed files and the outcome;
   - checks and their results;
   - boundaries marked verified or assumed;
   - limitations and the decisions still needed.

## Patterns to copy

- **Database feeds for leaders:**
  - `security definer` functions that return nothing without leader claims;
  - per-hospital rows bounded by `orbit_erp.ops_visible_facilities`;
  - the API also refuses (500) any hospital it cannot name from the caller's own entity directory.
  - Examples: `operations`, `revenue_feed`, `surveillance_feed`.
- **RLS policy form:** per statement, `(select fn())`, and `= any(coalesce((select orbit_erp.visible_facility_ids()), array[]::uuid[]))`. Every table enables and **forces** RLS.
- **Role gates:** a role allow-list plus a `seesX(role)` function in contracts (`seesOperations`, `seesRevenue`, `seesSurveillance`). The API returns 403 with a reason code. The navigation filters on the same function.
- **Honesty on screen:**
  - missing values show as missing, never 0;
  - a model shows its error next to a naive baseline;
  - probabilities are never shown as 0% or 100%;
  - limitations are listed on the page.
- **Simulator writes:** everything goes through the real API as real accounts, with idempotency keys and deterministic RNG (`rngFor(seed, …)`). New behaviour is off unless configured.

## Traps already hit, and the fix

| Trap | What to do |
|---|---|
| Files use **CRLF**. Bash heredocs mangle `$$`, apostrophes and backticks (the shell collapsed `$$` to `$` in a migration once). | Edit with the Edit tool, or with a small Node script that normalises CRLF, replaces exact strings and fails loudly when an anchor is missing. |
| An SQL row built by hand with `jsonb_build_object` missed new columns, and every list call failed the contract (500) on live. | When adding a field to a contract, `grep` every hand-built row for that entity. The database test "returns visit rows, listed or single, in the full contract shape" guards encounters. Add one like it for any new entity. |
| Database tests are **skipped** without `ORBIT_TEST_OWNER_DATABASE_URL`. | Always set both URLs; a skip is not a pass. |
| Circular imports between `db/erp.ts` and `db/erp-billing.ts`. | Shared SQL helpers live in `db/erp-sql.ts`. |
| The API's TypeScript lib has no `Array#toSorted`. The linter prefers it, and only warns. | Use `sort` on a copy, or keep the warning. |
| `vercel env pull` shows sensitive values as `[SENSITIVE]`. | You cannot recover a secret from Vercel. Ask the owner. |
| Vercel `*-mc-bc` aliases need a Vercel login. | Test on `orbit-web-steel`, `orbit-erp-web` and `orbit-api-theta`. |
| `vercel deploy` sometimes finishes without a new deployment. | Confirm with `vercel ls --prod` that the top deployment is new and `Ready`. |
| The hosted knowledge text hashes differ by line endings (CRLF). | Match `replace(\n, \r\n)` when comparing embeddings to the hosted text. |
| OpenRouter's free tier returns 429 after about 50 requests a day. | Search falls back to words. Two-word questions must match both words (which avoids false positives such as CFO questions). |
| An out-of-scope place in a question was being silently narrowed. | `modules/chatbot/places.ts` answers `out_of_scope` explicitly. |
| XGBoost's `XGBRegressor` needs scikit-learn. | Use the native `xgb.train` and `DMatrix` API. |
| GitHub scheduled runs come hours late. | Do not rely on the schedule for demos. Use "Run workflow", or build a staging path. |
| Playwright text checks raced page reloads, and `hasText: 'Paid'` matched "Part paid". | Wait for a specific element or exact regex (`/^Paid$/`) before checking. |

## Local environment that worked

- **Database:** PostgreSQL 18 with pgvector 0.8.1 on Windows, as a local cluster on port 54329 with trust authentication for local use only. There are three databases:
  - a seeded one for the local API and `ORBIT_TEST_DATABASE_URL`;
  - a throwaway one with all migrations, for `ORBIT_TEST_OWNER_DATABASE_URL`;
  - a fresh one to prove that every migration applies from zero.
- **Servers:** the API on 3000 (`services/api/.env`, `ALLOWED_ORIGINS=http://localhost:5173`) and the web app on 5173.
- **Python:** a virtual environment with `tools/forecast/requirements.txt`.
- **Paths are machine-specific:** rebuild this from `HANDBOOK.md` §4 on a new machine.

## Current state (2026-10-07)

- **Live and verified:**
  - all leadership pages for 14 roles;
  - the Assistant;
  - the ERP: attendance, patients, visits with presenting condition, services, billing, New bill and revenue;
  - Hospital revenue;
  - Outbreak watch, with the first hosted forecast run (model MAE 0.912 against baseline 0.932).
- **Last live checks:** outbreak and ERP 37/37, billing 22/22, simulator tick with 0 failures.
- **Migrations:** 24, the latest `20261007000100_condition_surveillance`. Seed `0208_conditions` is applied on hosted (20 conditions, 43,628 visits tagged).

## Next, in priority order

1. **Owner:** set the unpriced services (see `HANDBOOK.md` §8).
2. **Outbreak demo:** decide how to show a live alert. Options:
   - a one-off "stage outbreak" workflow that writes many outbreak visits in one run;
   - a higher rate while the variable is set.
3. **Update `docs/orbit/DEPLOYMENT.md`:** one API, jobs on GitHub Actions, no Render.
4. **Auto-deploy (optional):** connect Vercel's GitHub app, or add a deploy workflow. This changes the deployment policy, so it needs its own PR and the owner's agreement.
5. **Change demo passwords** before any external showing.
