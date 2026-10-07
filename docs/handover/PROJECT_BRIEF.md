# Orbit: project brief

**Orbit** is a leadership workspace and a small hospital-operations system (ERP) for a fictional hospital group, **Kestrion Health Group**. It has 6 hospitals in two regions and a Cardiac Sciences centre of excellence.

All data is synthetic. Every number on screen is labelled *illustrative*. It is a demonstration product, not a medical system.

- Leadership workspace: https://orbit-web-steel.vercel.app
- Hospital operations (ERP): https://orbit-erp-web.vercel.app
- API health: https://orbit-api-theta.vercel.app/health

Ask Ghansham for a demo sign-in.

## The idea

Hospital leaders drown in reports. Orbit gives each leader one screen built for their role. It answers three questions: what needs my attention (**See**), why (**Understand**), and what I will do about it (**Act**).

- **14 leadership roles** (chairman, group CFO, regional COOs, hospital DHO, clinical director and nine others). Each sees only the hospitals, regions or units their membership allows. The server checks that on every request; the screen never decides it.
- **109 KPIs** from the client's workbook, in 29 definition families, with targets, history, exceptions and lineage.
- **Act:** leaders create, delegate and track actions. Every view and change is audited.

## What it does today

| Area | What a user sees |
|---|---|
| Morning brief and priority inbox | The exceptions that need a decision, ranked |
| KPI explorer | Every KPI the role owns: trend, target, breakdown, data quality and evidence |
| Actions | Create, delegate down the chain (COO → DHO → Billing lead), and track to done |
| Assistant (chatbot) | Ask in plain words, for example "how much insurance was claimed?". It answers only from data the role may see, cites its sources, and says "out of scope" instead of guessing. |
| Hospital operations | Live staffing, attendance and visits per hospital, fed by the ERP |
| Hospital revenue | Billed, collected and still owed, per hospital, in ₹ (INR) |
| **Outbreak watch** (new) | Alerts when 50 or more patients with the same condition arrive across 5 or more hospitals within 7 days, with an XGBoost forecast of next week and the model's honest accuracy beside it |
| Audit | Who looked at or changed what, and when |

**The ERP** is a separate sign-in for hospital desk staff and admins. It covers:

- staff, doctors and credentials;
- rosters and attendance with four-eyes corrections;
- patients and visits (with a presenting condition);
- services, prices, bills, insurance cover and payments.

A **live hospital simulator** acts as staff and patients through the real API on a schedule, so the numbers keep moving.

## How it is built

- **Frontend:** React 19 with React Router 7 (Vite 8), plain HTML and CSS, and a small in-house UI kit that draws its own charts. There is no component library.
- **API:** Node 22 with Fastify 5. Every request and response is checked against shared **zod** contracts (`packages/contracts`).
- **Database and sign-in:** Supabase (Postgres with pgvector, and Auth).
  - Security sits in the database: row-level security is forced on every table.
  - The API connects as a restricted role and passes the caller's verified membership with every request.
- **AI:**
  - Groq (`gpt-oss-20b`) for answers, OpenRouter's free tier as the fallback and for embeddings.
  - Knowledge search is hybrid: full-text plus vector.
  - The model never writes SQL and never sees data outside the caller's scope.
- **Forecast:** Python 3.12 with XGBoost (`count:poisson`). It runs daily in GitHub Actions and is measured against a naive baseline.
- **Hosting:** Vercel (API in Mumbai, next to the database), Supabase, and GitHub Actions for the simulator, the knowledge refresh and the forecast. The free tiers cover all of it.
- **Quality:**
  - about 970 automated tests, including database tests that run as the real restricted role;
  - type-checking, linting and a secret scan on every pull request;
  - browser checks with an accessibility scanner (axe).

## Principles it holds to

- **Role and scope come from verified sign-in data**, never from the browser. An unauthorised request gets an explicit "out of scope", not a quietly smaller answer.
- **Honest numbers:** synthetic data is labelled on every screen. A missing value shows as missing, never as zero. A model's accuracy is shown next to its forecast.
- **No invented facts:** no made-up prices, targets, clinical claims or citations. Where the data has no answer, the product says so.
- **Every decision is written down:** 23 short decision records (ADRs) explain why each part is the way it is.

## Repository

- GitHub: `Adi820-cyber/orbit` (main)
- Backup: `ghanshamrna27-source/Pragyan` (public)

**Layout:**

| Path | What it holds |
|---|---|
| `apps/web` | Both web apps (leadership and ERP), one codebase |
| `services/api` | The API |
| `services/simulator` | The live hospital simulator |
| `packages/contracts` | Shared types |
| `packages/data-gen` | Synthetic data and dataset loaders |
| `packages/kpi-framework` | KPI definitions generated from the workbook |
| `packages/ui-kit` | The in-house UI kit |
| `supabase/migrations` | The database schema and security |
| `tools/forecast` | The forecast |
| `docs/` | Everything written down |
