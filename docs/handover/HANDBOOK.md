# Orbit handbook

How Orbit is set up, run, changed and released, as of **2026-10-07** (main at `56adf5c`). For what the product is, read [PROJECT_BRIEF.md](PROJECT_BRIEF.md) first.

---

## 1. Live system

| What | Address | Vercel project |
|---|---|---|
| Leadership workspace | https://orbit-web-steel.vercel.app | `orbit-web` |
| Hospital operations (ERP) | https://orbit-erp-web.vercel.app | `orbit-erp-web` |
| API (serves both) | https://orbit-api-theta.vercel.app (`/health`) | `orbit-api`, region `bom1` (Mumbai) |

- **Public addresses:** use the addresses above. The `*-mc-bc.vercel.app` aliases sit behind Vercel's login (deployment protection) and do not work for visitors.
- **Database and sign-in:** one Supabase project (Postgres with pgvector, and Auth), in the Mumbai region.
- **Background jobs:** GitHub Actions on `Adi820-cyber/orbit` (§6).

### Accounts

Every account ends in `@kestrion.demo`.

| Role | Sign in as | Scope |
|---|---|---|
| Chairman / CEO | `chairman` | Group |
| Clinical director | `clinical-director` | Group and COEs |
| Regional COO North / South | `regional-coo-north`, `regional-coo-south` | North: Avenhurst, Brackmoor, Calderwyn. South: Dunmarrow, Elverton, Farrowgate. |
| Hospital DHO | `hospital-dho` | Avenhurst Hospital |
| People executive, BD lead, Billing lead | `people-executive`, `bd-lead`, `billing-lead` | Avenhurst Hospital |
| COE lead | `coe-lead` | Cardiac Sciences COE |
| Corporate revenue, Group CFO, Procurement, HR, Legal, Analytics | `corporate-revenue-lead`, `group-cfo`, `procurement-head`, `hr-head`, `legal-head`, `analytics-head` | Group |
| ERP desk | `hospital` | Avenhurst Hospital |
| ERP admin | `admin` | Whole group; picks a hospital in the sidebar |

- **Isolation test org:** `isolation-chairman@halveston.demo` and `isolation-hr-head@halveston.demo` belong to a second, empty organization. They prove organizations cannot see each other.
- **Passwords:** the product owner set them on purpose for the demo; they are **not written here**. Change them before showing Orbit to anyone outside the team. See `docs/orbit/DEPLOYMENT.md` §5 for how accounts are created.

### Who sees which page

| Page (leadership app) | Roles |
|---|---|
| Brief, Inbox, KPI explorer, Actions, Audit, Assistant | All 14 roles, limited to their scope |
| Hospital operations | `seesOperations` in `packages/contracts` |
| Hospital revenue | Chairman, regional COO, hospital DHO, group CFO, billing lead, corporate revenue lead |
| Outbreak watch | Chairman, clinical director, regional COOs, hospital DHO |

The browser only hides links. The API enforces every rule; a role outside the list gets 403.

---

## 2. Architecture in one page

```
Browser (orbit-web / orbit-erp-web)            same React codebase, VITE_APP_SURFACE picks the app
   │  Supabase Auth sign-in → access token
   ▼
API  (Fastify 5 on Vercel, services/api)
   │  verifies the token → finds the membership (role + scope) → checks it
   │  connects as Postgres role `orbit_app`, sets the claim `orbit.membership` per transaction
   ▼
Postgres (Supabase)  forced row-level security on every table; bounded security-definer functions for feeds
   ▲
   ├── Simulator (GitHub Actions, services/simulator) — acts as desk/admin through the API
   ├── Knowledge sync (GitHub Actions) — rebuilds the Assistant's search index
   └── Forecast (GitHub Actions, tools/forecast, Python) — writes the outbreak forecast
```

**Rules everything follows:**

- **Shared contracts:** every request and response shape lives in `packages/contracts` (zod). The API checks input on arrival and output before sending, so a bad row becomes a 500 (`*_failed_contract`), never a wrong answer.
- **Scope comes from verified membership.** Never from the browser, request fields or model output. An unauthorised request is answered `out_of_scope` explicitly.
- **Every number carries its labels:** `provenance: "illustrative"`, data quality, limitations and a disclosure.
- **The Assistant is authorization-first:** typed evidence, real citations, no SQL from the model, and no model key in the browser.

### Repository map

| Path | What |
|---|---|
| `apps/web/src/features/` | One folder per page: `brief`, `inbox`, `explorer`, `actions`, `audit`, `ask` (the Assistant), `operations`, `revenue`, `surveillance`, `erp` |
| `apps/web/src/preview/` | An offline preview with fixture data (no API needed) |
| `services/api/src/modules/` | One folder per route group, plus `ports.ts` (interfaces) and `wiring.ts` (live sources) |
| `services/api/src/db/` | SQL per area, plus database integration tests (`*.test.ts`) |
| `services/simulator/` | The live hospital simulator (ADR 0017) |
| `packages/contracts/` | Shared zod schemas |
| `packages/data-gen/` | Synthetic KPI data, the ERP seed, and the reference-dataset loader (ADR 0020) |
| `packages/kpi-framework/` | KPI definitions generated from the client workbook. Never hand-edit. |
| `packages/ui-kit/` | Tokens, CSS and primitives |
| `supabase/migrations/` | 24 migrations. Grants and RLS sit in the same file as each table. |
| `supabase/seed/` | Committed seeds (`0001`–`0010`). `seed/local/` holds generated, private seeds and is ignored by Git. |
| `supabase/tests/` | pgTAP allow/deny tests (run by `supabase/validate-local.ps1`) |
| `tools/forecast/` | Python XGBoost forecast and its tests (ADR 0023) |
| `.github/workflows/` | `ci.yml`, `live-hospital.yml`, `forecast.yml` |
| `docs/decisions/` | ADRs 0001–0023 |
| `DataSets/` | The client's reference datasets. **Ignored by Git; never commit them.** |

---

## 3. Feature history (what was built, in order)

| ADR | What |
|---|---|
| 0001–0013 | Foundation: credentials, membership bootstrap, KPI framework import, authorization contract, CORS, Supabase project, `orbit` schema, entitlements, deployment |
| 0014 | Ask: Groq first, OpenRouter fallback |
| 0015 | Adding data from the dashboards |
| 0016 | ERP module; `admin` and `hospital` operator roles |
| 0017 | Live hospital simulator |
| 0018 | Leadership pages read ERP data (Hospital operations) |
| 0019 | Knowledge chatbot (hybrid search, attribute-based access) |
| 0020 | Two reference hospital datasets loaded (30,000 patients, 45,000 admissions) |
| 0021 | One Assistant: "Ask Orbit" merged into the chatbot, role-based |
| 0022 | ERP billing and one currency, INR; Hospital revenue page; New bill |
| 0023 | Outbreak watch: presenting conditions, surge rule (7 days, 50 patients, 5 hospitals), XGBoost forecast |

---

## 4. Develop locally

### Needs

- Node **22.18+ but below 23** (see `engines`) and npm.
- PostgreSQL **18** with **pgvector**, for the database tests and a local API. A plain local server works; no Docker is needed.
- Python 3.12 for `tools/forecast` (optional).
- Supabase CLI (installed by `npm ci`; run it with `npx --no-install supabase …`) and the Vercel CLI, both for releasing.

### First run

```bash
npm ci
cp .env.example services/api/.env    # the root .env.example documents every variable; fill in the API ones
```

The API reads `services/api/.env`. The variable names are listed in `docs/orbit/DEPLOYMENT.md` §3:

- `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`;
- `ORBIT_LIVE_SOURCES`, `ALLOWED_ORIGINS` (for example `http://localhost:5173`);
- optionally `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `EMBEDDING_MODEL`.

```bash
cd services/api && npm run dev                          # API on http://localhost:3000
cd apps/web && npx vite --port 5173 --strictPort        # web on http://localhost:5173
```

- **Offline preview:** the web app also has a preview mode with fixture data (`apps/web/src/preview`), useful for UI work without a database.
- **Local database:** `supabase/validate-local.ps1` applies every migration to a throwaway local database and runs the pgTAP suite. For a database you keep, apply `supabase/migrations/*.sql` in order, then the seeds in `supabase/seed/` (and `seed/local/` if you generated them).

### Generated data

| Command | Writes |
|---|---|
| `npm run generate --workspace=@orbit/data-gen` | Committed KPI seeds |
| `npm run generate:erp --workspace=@orbit/data-gen` | ERP seeds |
| `npm run load:reference --workspace=@orbit/data-gen` | Reads `DataSets/`, writes `supabase/seed/local/reference/*.sql` (private; ignored by Git) and `data/snapshots/reference-manifest.json` (committed) |
| `npm run provision:erp --workspace=@orbit/data-gen` | Creates the ERP sign-ins (needs `supabase/.env.provisioning`) |

---

## 5. Test: the gates every change must pass

```bash
npm run typecheck
npm run lint                          # also runs the API's own lint
npm run build --workspace apps/web
ORBIT_TEST_DATABASE_URL='postgres://orbit_app@localhost:<port>/<seeded db>' \
ORBIT_TEST_OWNER_DATABASE_URL='postgres://postgres@localhost:<port>/<throwaway db with all migrations>' \
ORBIT_TEST_DATABASE_SSL=false npm test
cd tools/forecast && python -m unittest -v test_forecast.py
```

- **Without the two database URLs**, the database tests are **skipped**. A skip means "not verified", never "passed".
- **The owner database** gets test fixtures inserted. Never point it at the hosted project.
- **Size:** as of 2026-10-07 the full run is about 970 tests:
  - API 500 (including database tests run as `orbit_app`);
  - data-gen 155;
  - web 122;
  - simulator 105;
  - plus contracts and the UI kit.
- **UI changes:** check them in a real browser too (keyboard, phone width, and an accessibility scan). An automated scan does not replace a manual keyboard check.

---

## 6. Release

### Branch and pull request

1. Branch from up-to-date `main`: `ghansham/<scope>-<change>`. One concern per pull request.
2. Run the gates (§5) and fill in `.github/pull_request_template.md`: scope, tests, security and data impact, which boundaries are verified and which are assumed.
3. CI (`ci.yml`) runs typecheck, tests and lint, plus a secret scan. Merge only when it is green.
4. Never push to `main` directly. Never force-push a shared branch. After a merge, start a fresh branch.

### Database migration (hosted)

```bash
npx --no-install supabase db push --linked --dry-run    # see what would apply
npx --no-install supabase db push --linked              # apply
npx --no-install supabase db query --linked -f supabase/seed/local/reference/<file>.sql   # a private seed, when needed
```

Migrations are forward-only. Write each so it can run on a fresh database (the tests prove that) and on the live one.

### Deploy (Vercel CLI)

Pushing to `main` does **not** deploy; Vercel's GitHub app is not connected. Deploy each project from a **clean checkout of `main`**, never from a working copy with uncommitted files:

```bash
git worktree add ../deploy-api origin/main     # once; later: git -C ../deploy-api checkout --detach origin/main
cd ../deploy-api && vercel link --project orbit-api      # once
vercel deploy --prod --yes
# same for orbit-web and orbit-erp-web
vercel ls --prod                                # confirm "Ready"
```

**After deploying:**

- Run a simulator tick: Actions → "Live hospital" → Run workflow. It must report `failures: 0`.
- Open the pages you changed on the live addresses.

### Backup

The `pragyan` remote is `ghanshamrna27-source/Pragyan` and is **public**. After a merge: `git push pragyan main`.

---

## 7. Operate

### GitHub Actions

| Workflow | When | Does | Needs (secrets) |
|---|---|---|---|
| `ci.yml` | Every pull request | Typecheck, test, lint, secret scan | none |
| `live-hospital.yml` | Every 10 min (GitHub often runs it hours late) and on demand | One simulator tick, then the knowledge sync | `ERP_API_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SIM_ADMIN_EMAIL`, `SIM_ADMIN_PASSWORD`; `DATABASE_URL`, `OPENROUTER_API_KEY` |
| `forecast.yml` | Daily 01:30 UTC (07:00 IST) and on demand | Python tests, then the XGBoost forecast | `DATABASE_URL` |

Each step is skipped, and the run stays green, while its secrets are missing.

**Repository variables:**

- `SIM_OUTBREAK_CONDITION` (for example `VIRAL-FEVER`) stages a demo outbreak.
- `SIM_OUTBREAK_PER_HOSPITAL_PER_DAY` sets its rate (1–50, default 12).
- Delete the variable to stop the outbreak.

### Vercel environment variables

The names are below. Values live only in Vercel.

| Project | Variables |
|---|---|
| `orbit-api` | `DATABASE_URL` (pooler, transaction mode, as `orbit_app`), `SUPABASE_URL`, `ALLOWED_ORIGINS` (exact web origins), `ORBIT_LIVE_SOURCES`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `EMBEDDING_MODEL` |
| `orbit-web` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_BASE_URL` |
| `orbit-erp-web` | The same three, plus `VITE_APP_SURFACE=erp` |

Anything starting `VITE_` is published in the browser bundle, so never put a secret in one.

### Checking health

- **API:** `curl https://orbit-api-theta.vercel.app/health`
- **Logs:** `vercel logs --since 30m --status-code 500 -x`, run inside a linked checkout of `orbit-api`. The `reason` field names the failing check, for example `erp_encounter_failed_contract`.
- **Simulator:** the log of the last "Live hospital" run. The `tick` line shows `writes`, `failures`, `patients`, `visits`, `bills` and more.
- **Forecast:** the last "Outbreak forecast" run prints the model's error against the baseline.

### Free-tier limits

- **OpenRouter:** about 50 requests a day. Embeddings stop when the limit is reached, and search falls back to words.
- **Groq:** answers the chat first.
- **GitHub scheduled runs:** they can be delayed by hours, so the simulator moves more slowly than "every 10 minutes".

---

## 8. Open items

| Item | Detail |
|---|---|
| **Set the missing prices** | ERP admin → Services. These have no price in the data: consultation, specialist consultation, emergency assessment, ECG, cardiac catheter, oncology day-care, rehabilitation. Visits using them cannot be billed until they are priced (ADR 0022 §2). |
| **Demo passwords** | Change them before any external audience. |
| **Outbreak demo is slow** | Turning on `SIM_OUTBREAK_CONDITION` adds patients only on each simulator run, and GitHub's schedule is sparse. A faster way to stage an alert has not been built. |
| **Outbreak history gap** | Visits from 17 Sep 2026 (where the reference history ends) to 7 Oct 2026 have no presenting condition, so counts and the forecast start low. The page says so. |
| **Auto-deploy** | Vercel's GitHub app is not connected; deploys are manual (§6). |
| **Stale docs** | `docs/orbit/DEPLOYMENT.md` describes an `orbit-erp-api` project and Render. In fact one API (`orbit-api`) serves both apps, and the background jobs run on GitHub Actions. `render.yaml` is not in use. |
| **KPI definitions** | Some KPIs share a definition family and show the family's measure (see `DEMO_RUNBOOK.md`, limitations). |
