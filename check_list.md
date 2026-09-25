# Orbit — Project Completion Checklist

**Last verified:** 25 September 2026, against the deployed pair (https://orbit-web-steel.vercel.app, https://orbit-api-theta.vercel.app) and the dev Supabase project.
**Tests:** 624 unit/contract tests passing (web 93, API 342 + 17 skipped DB-only, contracts 33, data-gen 127, kpi-framework 29) and 48 Playwright e2e tests at 390 / 768 / 1440 px. Typecheck, lint and production build clean in all workspaces.
**Governing documents:** [PRD](docs/orbit/PRD.md) · [Architecture](docs/orbit/ARCHITECTURE.md) · [Team Assignments](docs/orbit/TEAM_ASSIGNMENTS.md) · [Rules](RULES.md) · [Demo runbook](docs/orbit/DEMO_RUNBOOK.md)

Every ticked item below was checked against the running system, not taken from the previous version of this list. Items that were wrong in that version are corrected in place and marked *Corrected*. Unticked items are decisions or reviews that belong to a named owner.

**Remaining:** 7 items, all owner decisions or human reviews (sections 2, 3 and 4). No engineering item is open.

---

## 1. Cloud infrastructure and live deployment

- [x] **Deploy Vercel projects (web and API)**
  - [x] API function in `bom1` (Mumbai), next to Supabase `ap-south-1`. Verified: responses carry `x-vercel-id: bom1::bom1`.
  - [x] Web SPA on Vercel with SPA rewrites (`apps/web/vercel.json`).
  - [x] *Corrected:* routing is **two Vercel projects on separate domains** (ARCHITECTURE §11, confirmed by Aditya), not same-origin `/api/*`. The web app calls the API at its own domain; CORS allows exactly the web origins.
  - [x] No top-level await in the API entrypoint; first request after a deploy (cold start) answered in 0.44 s.
- [x] **Live Supabase connection and pooler mode**
  - [x] API connects through the Supavisor transaction pooler on port 6543 as `orbit_app`.
  - [x] `orbit_app` is least-privilege: not superuser, no BYPASSRLS, no CREATEROLE/CREATEDB, member of no role (cannot assume `service_role`); no DELETE or TRUNCATE grant on any table; every `orbit` table has RLS enabled and forced.
  - [x] Claims set with `set_config(..., true)` do not leak across pooled connections: 160 concurrent North/South requests through the 4-connection pool, every own-region answer contained only own-region rows and every cross-region probe was refused (0 failures).
  - [x] All 13 migrations applied (`20260923000100` … `20260925000300`) and seeds `0005`–`0007` loaded; the current dataset is the all-role dataset (13,800 observations).
- [x] **CORS and origin verification**
  - [x] Preflight from the production web origin returns `Access-Control-Allow-Origin` for exactly that origin.
  - [x] Unapproved origins (including a look-alike `…vercel.app.evil.com`) receive no `Access-Control-Allow-Origin`, so the browser blocks them. *Note:* the preflight status is 204 without the allow header rather than 403; that is `@fastify/cors` behaviour and still blocks the browser.

## 2. Security and credentials

- [ ] **ADR 0001 closeout (credential remediation)** `[Owner: Aditya / Maruti]` — a decision, not engineering. The product owner has stated that key rotation is not needed while the environment stays internal.
  - [ ] Confirm revocation/rotation of the exposed legacy service-role key in the legacy project.
  - [ ] Confirm the Orbit Supabase project has never shared credentials with legacy projects.
  - [ ] Update [docs/decisions/0001-credential-remediation.md](docs/decisions/0001-credential-remediation.md) from *Proposed* to *Accepted / Resolved*.
- [x] **Client secret audit**
  - [x] Production web bundle scanned: no secret key, model key, database URL or `service_role` string. The only credential is the Supabase publishable key, which is public by design. *Corrected:* the variable is `VITE_SUPABASE_PUBLISHABLE_KEY`, not `VITE_SUPABASE_ANON_KEY`. (The bundle contains the text `sb_secret_` once: Supabase's own client checking a key prefix, not a key.)
  - [x] Groq and OpenRouter keys and `DATABASE_URL` exist only in the API project's Vercel environment; the web project holds only the three `VITE_` values.
- [x] **Live token and scope verification**
  - [x] Tokens are verified against the live project's JWKS; all 17 demo accounts sign in with real Supabase Auth.
  - [x] Positive authorization: each role sees exactly its workbook KPIs within its scope (all 14 roles checked on production).
  - [x] Negative authorization: an out-of-scope probe returns `403 {"error":{"code":"out_of_scope","message":"The requested data is outside your authorized scope.",…}}`, never an empty 200. Ask returns an explicit `out_of_scope` answer with no records.

## 3. End-to-end testing and accessibility

- [x] **Playwright suite** (`npm run test:e2e` in `apps/web`; `PW_CHANNEL=msedge` runs it on an installed Edge): 48 passed at 390, 768 and 1440 px, against the contract fixtures.
- [x] **Regional COO workflow on the live deployment** (scripted in a real browser and through the API):
  - [x] Sign in with email and password through Supabase Auth.
  - [x] Morning brief loads with Act now, Monitor, On track and Data limitations, and the illustrative disclosure.
  - [x] Inbox shows priority cards.
  - [x] Explorer shows trends, components and data-quality lineage.
  - [x] Create an action with an idempotency key; a retry returns the same action; it persists after reload.
  - [x] Audit trail shows every state change.
  - [x] New in this pass: COO → DHO → Billing Lead delegation, submit for approval, send back, approve (section 6).
- [x] **Responsive layouts**: no horizontal overflow at 390, 768 and 1440 px on every primary route (e2e).
- [x] **Automated accessibility**: 0 axe violations (WCAG 2.1 A/AA) on every primary route at all three widths, including the Ask Orbit chat panel open and with an answer.
- [ ] **Manual keyboard review** `[Owner: Ayas / Aditya]` — needs a person. Automated keyboard checks pass: evidence and navigation are keyboard reachable, Enter sends in the chat, Escape closes it and returns focus to its button (also on phones), and focus is visible.

## 4. Open architecture and scope decisions

- [ ] **ADR 0015 (dashboard data entry / notes)** `[Owner: Aditya]` — decide Option A (read-only) or B (context notes), and record it in [docs/decisions/0015-dashboard-data-entry.md](docs/decisions/0015-dashboard-data-entry.md).
- [ ] **Action transition matrix v2** `[Owner: Aditya]` — the approval step and delegation added in this pass are documented in [services/api/TRANSITIONS.md](services/api/TRANSITIONS.md) as proposed and are live on the demo; they need sign-off.
- [x] **Performance envelope** (production, warm, North COO; PRD §9):

  | Endpoint | Target | p50 | p95 |
  |---|---|---|---|
  | `GET /api/brief` | < 1,500 ms | 342 ms | 576 ms |
  | `GET /api/inbox` | < 1,500 ms | 122 ms | 136 ms |
  | `GET /api/kpi` | < 1,000 ms | 51 ms | 274 ms |
  | `GET /api/kpi/:id` with breakdown | — | 118 ms | 124 ms |
  | `POST /api/ask` (guided) | < 3,000 ms | 668 ms | 2,074 ms |
  | `POST /api/ask/question` (AI) | < 6,000 ms | 1,820 ms | 8,189 ms |

  The AI p95 (5 samples) comes from free-tier rate limiting at the model provider during question interpretation. Each question now has a 6-second budget: the rewording step is skipped when time is short, and a stalled model response is cut off (it previously held a request for 121 s).

## 5. Stakeholder demo readiness

- [x] **14-role walkthrough**: every role's pages checked in a browser on production. Titles correct, KPI weights sum to 100% for all 14 roles (109 assignments), no raw ids on screen, no console errors, and the illustrative chip and disclosure are on every number surface.
- [x] **Demo accounts and runbook**: [docs/orbit/DEMO_RUNBOOK.md](docs/orbit/DEMO_RUNBOOK.md) has the account for each role, a 15-minute walkthrough (brief, evidence, Ask, delegate and approve, audit), scenarios per role, and limitations to state. *Corrected:* accounts are `…@kestrion.demo`, not `@orbit.local`. Passwords are shared separately and never written in the repository.

## 6. Bugs found and fixed in this pass

| Bug | Fix |
|---|---|
| An action sent to a DHO could not be passed on or approved; the page offered every state to everyone and most were refused | Approval step (submit → approve / send back), delegation to people in the assignee's scope, the page shows only the moves the server allows, and a history of every note |
| Assignee saw "Assignment unavailable" and a raw region id on actions | KPI names from the public framework; entity name stored with the action (and filled by the database if an insert omits it) |
| Brief showed a delegated sub-task's state instead of the action's | Only top-level actions set an exception's action state |
| Audit trail showed action UUIDs and machine outcomes | Actions named by title, outcomes in plain words |
| Ask breakdown answers listed raw entity ids and no conclusion | Names from the caller's directory; lowest and highest called out |
| Ask dates as `2026-08-01 to 2026-08-31`, changes as "percent" | "August 2026", "88.8%", "+3.8 percentage points" |
| Everyday questions ("bed occupancy") not matched to KPIs | KPIs described by what they measure; keyword fallback labelled "closest match" |
| A stalled model response held a request for 121 s; rate limits failed questions outright | One timer over the whole response, per-step deadlines, one bounded retry |
| Chat: link contrast 4.17:1 (below WCAG AA), focus lost on phones when closing | Accessible colour; focus restored after close |
| "Coe" displayed as a word | "COE" |

## 7. Not in this checklist but worth knowing

- **Automatic deploys**: CI runs typecheck, tests, lint, build and a secret scan on every push to `main`. Deploys are currently made from the CLI; deploy-on-push needs Vercel's GitHub app installed on `Adi820-cyber/orbit`.
- **KPI definitions**: several KPIs share a workbook definition family, so a KPI can show its family's measure under a different title (e.g. "Claim submission turnaround time" shows first-pass acceptance). Needs a per-KPI definition from Maruti.
- **Synthetic data review**: the all-role dataset and the collection-rate change in the financial model need Maruti's plausibility review before an external demo.
