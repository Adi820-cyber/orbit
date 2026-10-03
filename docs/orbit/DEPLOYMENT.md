# Orbit — Deploying on Vercel (leadership and hospital operations)

Status: how to deploy what is in the repository. The `vercel.json` files and the build commands were exercised locally (below). **No Vercel project was created or changed by this document**, and Vercel itself was not used.

Variable **names** only. Values come from the Supabase project and the Vercel dashboard and never go in Git ([RULES.md](../../RULES.md)).

## 1. What gets deployed

One repository, two applications, each deployable as one or two Vercel projects:

| Application | Root directory | Config in the repo |
|---|---|---|
| Web (React + Vite) | `apps/web` | [apps/web/vercel.json](../../apps/web/vercel.json): installs from the repo root, builds with `npm run build`, serves `dist`, SPA rewrite, security headers |
| API (Fastify) | `services/api` | [services/api/vercel.json](../../services/api/vercel.json): installs from the repo root, bundles the workspace packages, runs in `bom1` (Mumbai, next to Supabase) |

Both configs are read from the project's **Root Directory**, so a second project from the same repository reuses them. Nothing needs copying.

Set **Node.js 22.x** on every project (`engines` is `>=22.18 <23`).

## 2. Two ways to host it

**A. Combined (what runs today).** Two projects, `orbit-web` and `orbit-api`, with `ORBIT_SURFACE` and `VITE_APP_SURFACE` unset. Both kinds of account use the same URLs.

**A2. ERP web separate, one shared API (ADR 0018).** Three projects: `orbit-web` (`VITE_APP_SURFACE` `leader` or unset), `orbit-erp-web` (`VITE_APP_SURFACE=erp`) and one `orbit-api` (`ORBIT_SURFACE` unset or `all`). Leaders get a **Hospital operations** page built from the ERP's aggregates; hospital staff use the ERP web. On `orbit-api`, `ORBIT_LIVE_SOURCES` must include `erp` (it also switches on the leaders' operations feed, and without it `/api/operations` answers 503), and `ALLOWED_ORIGINS` must list **both** web origins. The `orbit-erp-web` project needs only `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_BASE_URL` (the shared API URL) and `VITE_APP_SURFACE=erp`; Root Directory `apps/web`. Migration `20261001000150_operations_feed.sql` must be applied first.

**B. Separated (recommended for hospital operations).** Four projects. Leadership and hospital operations get their own URLs, environment variables, CORS allow-list, deployment history and logs:

| Project | Root directory | `VITE_APP_SURFACE` / `ORBIT_SURFACE` | Serves |
|---|---|---|---|
| `orbit-web` | `apps/web` | `leader` | Leadership workspace only. There is no `/erp`. |
| `orbit-api` | `services/api` | `leader` | Leader routes only. `/api/erp/*` does not exist (404). An ERP account is refused (403). |
| `orbit-erp-web` | `apps/web` | `erp` | Hospital operations only. `/` goes to `/erp`. |
| `orbit-erp-api` | `services/api` | `erp` | `/api/erp/*` only. Leader routes do not exist (404). A leadership account is refused (403). |

How the switch works:

- **API (`ORBIT_SURFACE`):** `all` (default), `leader` or `erp`. It is read at startup. A deployment does not register the routes it does not serve, and the sign-in check refuses the other kind of account before any route runs ([src/surface.ts](../../services/api/src/surface.ts)).
- **Web (`VITE_APP_SURFACE`):** the same three values, fixed **at build time**, so change it and redeploy. It decides which screens exist. It is not an access control: the unused half's code is still inside the bundle (the three builds are the same size), so the API is what keeps data apart.

### What separation does and does not give you

- **Gives:** separate URLs, environments, CORS lists and logs. Each API deployment can only serve its own kind of account, and its routes for the other half are absent.
- **Does not give:** separate data stores. Both pairs read the **same Supabase project and the same `orbit_app` database role**. The hospital operations tables are in their own `orbit_erp` schema behind forced row-level security, but a credential leak from either API would expose what that role can reach.
- **A stronger step, not built:** a dedicated database role for hospital operations, or a separate Supabase project (all migrations plus the organization seed `0001` would be applied to it, and `provision:erp` run against it). Either needs a decision on cost and ownership; see ADR 0016 §9.

## 3. Environment variables

### API projects (server only)

| Variable | `orbit-api` (leader) | `orbit-erp-api` (erp) | Notes |
|---|---|---|---|
| `SUPABASE_URL` | project URL | project URL | |
| `SUPABASE_PUBLISHABLE_KEY` | publishable key | publishable key | |
| `DATABASE_URL` | pooler string as `orbit_app` | pooler string as `orbit_app` | Supavisor **transaction mode**, port 6543. Never `postgres` or a service key. |
| `ORBIT_SURFACE` | `leader` | `erp` | Unset or `all` serves both. |
| `ORBIT_LIVE_SOURCES` | `memberships,entitlements,scope,entities,transitions,actions,audit,assignees,dataset,observations,exceptions` | `memberships,erp` | The `erp` source must be named or every ERP call answers 503. The ERP API needs nothing else. |
| `ALLOWED_ORIGINS` | the leadership web URL | the hospital operations web URL | **Exact origins only**, comma-separated, no wildcards. Preview deployments are not matched (the ADR 0007 pattern is not implemented in code). |
| `GROQ_API_KEY`, `GROQ_MODEL`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | optional | not used | Ask narration; leader only. |

The chatbot uses an extra `knowledge` source (ADR 0019). Migrations `20261001000200` and `20261001000250` are applied to the dev project and its knowledge base is built (892 chunks). To switch it on, add `knowledge` to `ORBIT_LIVE_SOURCES` on the API. `EMBEDDING_MODEL` (optional, default `openai/text-embedding-3-small`, must be 1536 dimensions) uses the existing `OPENROUTER_API_KEY`; without that key the chatbot searches by words only. The knowledge base is kept current by the `orbit-knowledge-sync` cron job in [render.yaml](../../render.yaml) (`DATABASE_URL`, `OPENROUTER_API_KEY`), or by running `npm run knowledge:sync --workspace=@orbit/api` on any schedule.

### Web projects (public: inlined into the browser bundle)

| Variable | `orbit-web` | `orbit-erp-web` |
|---|---|---|
| `VITE_SUPABASE_URL` | project URL | project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | publishable key | publishable key |
| `VITE_API_BASE_URL` | the leader API URL | the ERP API URL |
| `VITE_APP_SURFACE` | `leader` | `erp` |

Never put a secret in a `VITE_*` variable.

## 4. Order of work

1. **Database.** Already done for the dev project (migration `20261001000100` and seeds `0008`–`0010`; see ADR 0016). For any other project: `npx supabase link --project-ref <ref>`, then `npx supabase db push --include-seed`. Check `npx supabase db push --dry-run --include-seed` first, because it also applies any other pending migration.
2. **Sign-ins.** The `hospital` and `admin` accounts must exist in Supabase Auth with their memberships (§5).
3. **API projects.** Import the repository, set Root Directory `services/api`, Node 22.x, the variables above, deploy. Check `https://<api>/api/health` returns `{"status":"ok"}`.
4. **Web projects.** Same, with Root Directory `apps/web`. Set `VITE_API_BASE_URL` to the API URL from step 3, then deploy.
5. **CORS.** Put each web project's final URL into the matching API's `ALLOWED_ORIGINS` and redeploy that API. Until you do, the browser blocks calls with a CORS error and no data loads.

## 5. Creating the two sign-ins

`hospital@kestrion.demo` (Avenhurst) and `admin@kestrion.demo` (whole group). The sign-in page also accepts just `hospital` or `admin`.

Passwords are never stored in the repository. The provisioning script reads them from a gitignored file:

1. Create `supabase/.env.provisioning` with `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `ORBIT_HOSPITAL_PASSWORD` and `ORBIT_ADMIN_PASSWORD`.
2. `npm run provision:erp --workspace=@orbit/data-gen`
3. Apply the SQL it writes, `supabase/seed/local/0101_erp_operator_memberships.sql`, as the database owner (for example `npx supabase db query --linked -f supabase/seed/local/0101_erp_operator_memberships.sql`).

The secret key is used only by that script. Never place it in a Vercel project.

Short, guessable passwords on a public site expose synthetic records but allow edits to them. Rotate them before any external demo.

## 6. Known gaps (not caused by hosting)

- **Chatbot migration** `20261001000200_knowledge_chunks.sql` is now applied to the dev project: it was missing `grant select` on `orbit.knowledge_chunks` for `orbit_app` (the table-level grant a `security invoker` function still needs on top of its RLS policy), and its `match_knowledge` function could not resolve the pgvector `<=>` operator because `extensions` was not on its search path. Both are fixed in the migration file and applied.
- **Automatic deploys** need Vercel's GitHub app on the repository; until then deploy with the Vercel CLI.

## 7. The live hospital simulator (separate project, Render or Railway)

An optional third service that acts as a hospital around the clock, so the ERP shows live activity instead of seeded history: it punches staff in and out, registers patients, runs visits and records services, all through the ERP API as real accounts. It is **not** on Vercel (a process that runs all day cannot be). It runs on **Render** (a background worker; [render.yaml](../../render.yaml) is a Blueprint) or **Railway**.

Build `npm ci --omit=dev --ignore-scripts --workspace=@orbit/simulator`, start `node services/simulator/src/main.ts`, Node 22. It needs only the ERP API URL, the Supabase URL and publishable key, and an admin account; everything else is optional. Full guide, settings, load estimate and limits: [services/simulator/README.md](../../services/simulator/README.md). Decisions: [ADR 0017](../decisions/0017-live-hospital-simulator.md).

It changes this guide in two ways:

- The database then needs only the migrations, the organization seed `0001` and the reference seed `0008`. The people and history seeds (`0009`, `0010`) are not needed.
- It adds load to the ERP API: roughly 0.9 million reads a month at six hospitals with a 60-second tick. Check this against the API plan's request allowance.

Use dedicated accounts with strong passwords for it, held only in the host's secret settings.

## 8. What was verified (2026-10-01, locally)

- `npm run build` for the web app with each of `VITE_APP_SURFACE` = `leader`, `erp` and unset.
- `node scripts/bundle-vercel.mjs`, which is the API's Vercel build step.
- A real browser against the ERP pair (`erp` web build, `ORBIT_SURFACE=erp` API, a local database): an operator lands on `/erp`; `/inbox` and the leadership preview routes lead back to `/erp`; a leadership account is refused with no redirect loop; the API answers 404 for leader routes, and 403 for a leadership account on `/api/me` and `/api/erp`.
- Unit tests for the configuration, both API surfaces and the web route table.

Not verified: a deploy on Vercel, Supabase Auth, the Supavisor pooler, and a deployed CORS round trip.
