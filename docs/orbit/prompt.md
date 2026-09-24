# Orbit — Complete Remaining Implementation Prompt

> **For:** Claude Code / Kiro  
> **Repository:** `orbit` (Node 22 monorepo, npm workspaces)  
> **Branch:** Create `kiro/remaining-implementation` from `main` (HEAD = `af9aede`)

---

## 0. Before You Touch Anything — Mandatory Reading

Read these files **completely** before writing a single line:

| File | Why |
|---|---|
| `AGENTS.md` (repo root) | Non-negotiable invariants, safe-command policy, completion report format |
| `RULES.md` | Security & collaboration policy |
| `docs/orbit/ARCHITECTURE.md` | Data pipeline, RLS, scope model, deployment |
| `docs/orbit/PRD.md` | Product requirements, FR-01 through FR-07 |
| `docs/decisions/0014-ask-model-providers.md` | The narration design — what the model may and may not do |
| `docs/decisions/0015-dashboard-data-entry.md` | Context Notes (Option B) — the approved data-entry path |
| `services/api/src/modules/ports.ts` | Every port interface the data layer must implement |
| `services/api/src/modules/pending.ts` | The fail-closed stubs you are replacing |
| `services/api/src/wiring.ts` | How sources are wired by `ORBIT_LIVE_SOURCES` |
| `services/api/src/config.ts` | Environment variable schema, provider config |

Then run:
```bash
npm run typecheck   # must pass before and after every change
npm test            # 520+ tests, all green on main
```

---

## 1. Current State — What EXISTS and What Does NOT

### ✅ DONE (do not rebuild)

| Layer | What exists | Key files |
|---|---|---|
| **Contracts** | Full Zod schemas for Ask, Actions, Audit, Brief, Inbox, KPI, Entities, Me, Errors | `packages/contracts/src/*.ts` |
| **KPI Framework** | 14 roles, 109 assignments, 29 definition families, all imported from workbook | `packages/kpi-framework/` |
| **API modules** | Routes + business logic for Brief, Inbox, KPI, Ask, Actions, Audit, Entities | `services/api/src/modules/*/routes.ts` |
| **Ask narration client** | `narrator.ts` — Groq primary, OpenRouter fallback, numeric-token guard, fail-closed | `services/api/src/modules/ask/narrator.ts` |
| **Ask catalogue** | 5 deterministic intents: `explain_definition`, `report_performance`, `compare_periods`, `explain_contributors`, `summarize_exceptions` | `services/api/src/modules/ask/catalogue.ts` |
| **Ask config** | `GROQ_API_KEY`, `GROQ_MODEL`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` in `config.ts` | `services/api/src/config.ts` L23-26 |
| **Auth plugin** | JWT verification via JWKS, membership resolution, `membershipOf(request)` | `services/api/src/plugins/auth.ts` |
| **Scope plugin** | Entitlement loading, scope resolution, `decideScope()` | `services/api/src/plugins/scope.ts` |
| **DB layer** | `client.ts` (pg pool), `rls.ts` (`withMembershipTx`), `memberships.ts`, `sources.ts` (entitlements, scope resolver, entity directory SQL) | `services/api/src/db/` |
| **Wiring** | `wireSources()` — switches each source on/off via `ORBIT_LIVE_SOURCES` env | `services/api/src/wiring.ts` |
| **Frontend** | All 14 role previews with fixture data, workspace layout, route tree, auth/login, all 7 surfaces (Brief, Inbox, Explorer, KPI Detail, Ask, Actions, Audit) | `apps/web/src/` |
| **Preview fixtures** | In-memory fixture API for all 14 roles with synthetic datasets | `apps/web/src/preview/` |
| **Migrations** | 6 migrations: roles/schema, claims helpers, framework tables, org tables, memberships/entitlements, drop segment grain | `supabase/migrations/` |
| **Seed** | Framework versions, roles, assignments, definitions, org hierarchy (Kestrion), regions, facilities, COEs, entitlements | `supabase/seed/0001_framework_and_org.sql` |
| **Action transitions** | Transition matrix + policy in code | `services/api/src/modules/actions/transitions.ts` |

### ❌ NOT DONE — This is your task list

| # | Task | Owner lane | Blocked by |
|---|---|---|---|
| **T1** | Wire narration into the Ask response path | Ghansham | Nothing — narrator.ts exists, catalogue.ts doesn't call it yet |
| **T2** | Add `assisted` mode to `AskModeSchema` contract | Ghansham | ADR 0014 §5 |
| **T3** | Show `assisted` vs `deterministic` badge on Evidence Card UI | Frontend | T2 |
| **T4** | Implement Postgres stores: `ActionStore`, `AuditStore` | Ghansham | Needs migration for `actions`, `action_events`, `audit_events` tables |
| **T5** | Implement Postgres stores: `ObservationSource`, `ExceptionSource`, `DatasetSource` | Ghansham | Needs migration for `kpi_observations`, `exceptions`, `datasets` tables |
| **T6** | Implement Postgres store: `AssigneeDirectory` | Ghansham | Org hierarchy tables exist |
| **T7** | Wire new DB sources into `wiring.ts` with `ORBIT_LIVE_SOURCES` flags | Ghansham | T4, T5, T6 |
| **T8** | Provision Supabase Auth demo users (17 accounts) | Aditya | Supabase dashboard access |
| **T9** | Seed demo memberships + scopes for all 17 users | Aditya | T8, reference: `seed-demo-memberships.sql` in repo root |
| **T10** | Context Notes: migration, contract, API routes, store (ADR 0015 Option B) | All | ADR 0015 accepted |
| **T11** | Flip frontend from fixture previews to live API for production | Frontend | T7, T8, T9 |
| **T12** | Deploy Vercel production, smoke test | Aditya | T11 |

---

## 2. Task T1 — Wire Narration into Ask Response (CRITICAL)

This is the "real AI API" integration. The narrator client **already exists** at `services/api/src/modules/ask/narrator.ts`. What's missing is calling it from the catalogue.

### What to change

**File: `services/api/src/modules/ask/catalogue.ts`**

The `answered()` helper builds every successful response. After it builds the deterministic answer, it should attempt narration and replace the prose if the model succeeds.

```typescript
// In catalogue.ts, add import at top:
import { narrate, type NarrateOptions } from './narrator.ts';

// The ModuleDeps interface needs a new optional field for narration config.
// BUT — do NOT add it to ports.ts yet. Instead, pass it through a module-level option.
```

**Approach — keep it surgical:**

1. Add a `narrateOptions` field to `ModuleDeps` (or pass through a separate config). The narrator options come from `config.askProviders`.

2. In the `answered()` function (or in `answer()` after the deterministic response is built), call:
```typescript
const narration = await narrate(deterministicAnswer, {
  providers: deps.askProviders ?? [],
  timeoutMs: 8000,
});

if (narration.status === 'narrated') {
  // Replace the answer prose, keep everything else deterministic
  response.card.answer = narration.answer;
  response.mode = 'assisted';  // requires T2 contract change
}
// If declined, serve the deterministic answer unchanged — mode stays 'deterministic'
```

3. The `source` parameter to `narrate()` should include all numbers from the card — the answer text plus all observation values, so the numeric-token guard has the complete set.

### Critical rules (from ADR 0014 §1)
- The model **narrates only**. It never retrieves, computes, selects, or cites.
- A narration containing a numeric token absent from the source → **discarded**.
- If narration fails for any reason → serve deterministic answer. **Never error.**
- `askProviders` comes from `config.ts` (already wired from env vars). Pass it through `ModuleDeps` or a parallel config channel.

### Where the providers come from (already built)
```
.env:
  GROQ_API_KEY=<key>          → services/api/src/config.ts L23
  GROQ_MODEL=openai/gpt-oss-20b  → config.ts L24 (default)
  OPENROUTER_API_KEY=<key>    → config.ts L25
  OPENROUTER_MODEL=<model>    → config.ts L26

config.ts:loadConfig() → buildAskProviders() → ApiConfig.askProviders[]
```

The `askProviders` array is already built in `config.ts` L80 and returned from `loadConfig()`. It just needs to reach the Ask module. The wiring path is:

```
app.ts → loadConfig() → config.askProviders
app.ts → wireSources(config) → Sources.modules (ModuleDeps)
```

**Add to `ModuleDeps` in `ports.ts`:**
```typescript
// After line 170 in ports.ts, add:
import type { ModelProvider } from './ask/narrator.ts';

// In ModuleDeps interface:
/** Ask narration providers, in fallback order. Empty = fully deterministic. */
askProviders: readonly ModelProvider[];
```

**Wire in `pending.ts`:**
```typescript
// In pendingModuleDeps(), add:
askProviders: [],  // No providers = narration disabled = deterministic
```

**Wire in `wiring.ts`:**
```typescript
// After building modules from pendingModuleDeps(), set:
modules.askProviders = config.askProviders ?? [];
```

Wait — `wireSources` currently takes `Pick<ApiConfig, 'liveSources' | 'databaseUrl'>`. You need to widen that Pick to include `askProviders`:

```typescript
// wiring.ts line 30:
export function wireSources(
  config: Pick<ApiConfig, 'liveSources' | 'databaseUrl' | 'askProviders'>,
  ...
```

### Tests to add
- In `services/api/src/modules/ask/ask.test.ts`: add a test that verifies narration is attempted when providers are configured, and that the response mode flips to `assisted`.
- Add a test that verifies when narration declines, the deterministic answer is served with `mode: 'deterministic'`.
- **Existing narrator tests** (`narrator.test.ts`) already cover the narrator itself — do not duplicate them.

---

## 3. Task T2 — AskMode Contract Change

**File: `packages/contracts/src/ask.ts`**

Find `AskModeSchema` (currently `z.literal('deterministic')`) and change to:
```typescript
export const AskModeSchema = z.enum(['deterministic', 'assisted']);
```

This is the contract change ADR 0014 §5 describes. `assisted` means: every number, record, citation and disclosure is deterministic; only the prose wording was model-generated.

**Check:** After this change, run `npm run typecheck` across the whole repo. The `mode` field in fixture APIs and tests may need updating if they assert `'deterministic'` literally.

---

## 4. Task T3 — Evidence Card UI Badge

**File: `apps/web/src/features/ask/route.tsx`**

When the Ask response has `mode: 'assisted'`, show a small badge or label on the Evidence Card indicating "AI-assisted wording". This lets users distinguish model-worded prose from deterministic text (ADR 0014 §5 requirement).

Keep it minimal:
- A subtle pill/badge near the answer text: `✦ AI-assisted wording` or `Mode: assisted`
- Style it distinctly but not alarmingly — informational, not warning
- When `mode: 'deterministic'`, show nothing (or "Deterministic" if you want symmetry)

---

## 5. Tasks T4–T6 — Postgres Data Stores

These are the stores that replace the `pending()` stubs in `services/api/src/modules/pending.ts`.

### T4: Actions + Audit tables

**New migration: `supabase/migrations/20260924000700_actions_and_audit.sql`**

Tables needed (referencing `ports.ts` interfaces):

```sql
-- Actions (ports.ts L113-125: ActionStore)
create table orbit.actions (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  creator_id uuid not null references auth.users(id),
  creator_membership_id uuid not null references orbit.org_memberships(id),
  organization_id uuid not null references orbit.organizations(id),
  assignment_id text not null,
  entity_grain text not null,
  entity_id uuid not null,
  title text not null,
  assignee_id uuid not null references auth.users(id),
  due_date date not null,
  state text not null default 'open',  -- ActionState from contracts
  version integer not null default 1,
  evidence jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (creator_id, idempotency_key)
);

-- Action state transitions (for audit + history)
create table orbit.action_events (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references orbit.actions(id),
  from_state text,
  to_state text not null,
  reason text not null default '',
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- Audit trail (ports.ts L144-152: AuditStore)
create table orbit.audit_events (
  id uuid primary key default gen_random_uuid(),
  subject uuid not null,             -- from verified token
  membership_id uuid not null references orbit.org_memberships(id),
  organization_id uuid not null references orbit.organizations(id),
  role_id text not null,
  kind text not null,                 -- AuditEventKind
  target_type text,
  target_id text,
  outcome text not null,
  request_id text not null,
  created_at timestamptz not null default now()
);
```

**RLS policies** — follow the exact pattern from migrations 000400–000500:
- `actions`: SELECT where `creator_id = orbit.current_subject()` OR `assignee_id = orbit.current_subject()`, AND `organization_id = orbit.current_org()`
- `audit_events`: INSERT with `subject = orbit.current_subject()`, SELECT same filter
- Grant to `orbit_app` role only

**New file: `services/api/src/db/actions.ts`** — implements `ActionStore` interface from `ports.ts` L113-125:
- `create()` → INSERT with idempotency key check, INSERT action_event, INSERT audit_event — **all in one transaction**
- `get()` → SELECT with creator/assignee visibility
- `transition()` → compare-and-swap on `version`, reject with `stale` on mismatch
- `list()` → cursor-paginated SELECT

**New file: `services/api/src/db/audit.ts`** — implements `AuditStore` interface from `ports.ts` L144-152:
- `record()` → INSERT
- `list()` → cursor-paginated SELECT, filtered by actions the caller created or is assigned to

### T5: Observations + Exceptions + Dataset tables

**New migration: `supabase/migrations/20260924000800_observations_and_exceptions.sql`**

These are the KPI data tables. The seed (`data-gen`) already generates synthetic data — it just needs tables to land in.

Refer to:
- `ObservationSource` interface (ports.ts L56-63)
- `ExceptionSource` interface (ports.ts L80-83)
- `DatasetSource` interface (ports.ts L37-39)
- `ObservationSchema` in `packages/contracts/src/kpi.ts`
- `ExceptionSchema` in `packages/contracts/src/inbox.ts`

```sql
create table orbit.datasets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references orbit.organizations(id),
  checksum text not null,
  definition_version text not null,
  as_of timestamptz not null,
  current_period_cadence text not null,
  current_period_start date not null,
  current_period_end date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);

create table orbit.kpi_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references orbit.organizations(id),
  dataset_id uuid not null references orbit.datasets(id),
  assignment_id text not null,
  entity_grain text not null,
  entity_id uuid not null,
  period_cadence text not null,
  period_start date not null,
  period_end date not null,
  value_status text not null,       -- 'available' | 'missing' | 'not_applicable'
  value_numeric numeric,
  value_reason text,
  unit text not null,
  target jsonb not null default '{}',
  components jsonb not null default '[]',
  data_quality jsonb not null default '{}',
  definition_version text not null,
  provenance text not null default 'illustrative',
  created_at timestamptz not null default now()
);

create table orbit.exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references orbit.organizations(id),
  dataset_id uuid not null references orbit.datasets(id),
  assignment_id text not null,
  entity_grain text not null,
  entity_id uuid not null,
  kind text not null,
  priority text not null,
  headline text not null,
  detail text not null,
  action_state text not null default 'none',
  rule_id text,
  observation_id uuid references orbit.kpi_observations(id),
  created_at timestamptz not null default now()
);
```

**RLS:** SELECT where `organization_id = orbit.current_org()`. These are read-only for the API — data comes from the seed/generator.

**New file: `services/api/src/db/observations.ts`** — implements `ObservationSource`:
- `series()` → SELECT by assignment_id + entity, ordered by period_start
- `breakdown()` → SELECT children of parent entity at grain
- `byIds()` → SELECT by observation IDs

**New file: `services/api/src/db/exceptions.ts`** — implements `ExceptionSource`:
- `brief()` → SELECT exceptions for period, split into `exceptions` / `onTrack` / `dataLimitations`
- `inbox()` → cursor-paginated SELECT

**New file: `services/api/src/db/dataset.ts`** — implements `DatasetSource`:
- `current()` → SELECT the `is_current = true` dataset row for the org

### T6: AssigneeDirectory

**New file: `services/api/src/db/assignees.ts`** — implements `AssigneeDirectory` from `ports.ts` L132-134:
- `permitted()` → SELECT users with memberships whose scope is inside the caller's scope, for the given assignment

### T7: Wire into `wiring.ts`

Add new source names to `LIVE_SOURCES` in `config.ts`:
```typescript
export const LIVE_SOURCES = [
  'memberships', 'entitlements', 'scope', 'entities', 'transitions',
  'observations', 'exceptions', 'dataset', 'actions', 'audit', 'assignees',
] as const;
```

Add `DATABASE_SOURCES` entries for the new DB-backed sources.

In `wireSources()`, add conditional wiring blocks:
```typescript
if (live.has('observations')) {
  modules.observations = createDbObservationSource(database());
}
if (live.has('exceptions')) {
  modules.exceptions = createDbExceptionSource(database());
}
// ... etc for dataset, actions, audit, assignees
```

---

## 6. Task T10 — Context Notes (ADR 0015 Option B)

**Only if ADR 0015 is accepted.** This is the "data entry" feature.

### New contract in `packages/contracts/src/notes.ts`:
```typescript
export const ContextNoteSchema = z.strictObject({
  noteId: z.string(),
  authorRole: RoleIdSchema,
  assignmentId: z.string(),
  entity: ScopeEntitySchema,
  observationId: z.string().nullable(),
  text: z.string().min(1).max(2000),
  supersedes: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
});
```

### New migration, new API routes (`POST /api/notes`, `GET /api/notes`), new store implementing a `NoteStore` port.

### Key rules from ADR 0015 §2:
- Write allowed only where role can already READ the same assignment+entity
- Author identity from verified token, never from form
- Append-only: corrections supersede, never edit in place
- Idempotency key on creates
- Length-limited, no PII warning in UI
- Visible only within author's scope

---

## 7. Validation Checklist — Run Before Declaring Done

```bash
# 1. Types
npm run typecheck          # All workspaces

# 2. Tests
npm test                   # All workspaces — must stay ≥520 passing

# 3. Lint
npm run lint               # All workspaces

# 4. Build
npm run build              # Production build of apps/web + services/api

# 5. Verify no secrets leaked
# Check that no .env file, API key, or credential is in the diff
git diff --cached --name-only | Select-String -Pattern "\.env$"  # should be empty

# 6. Check bundle for leaked keys
# After build, grep the web bundle for key variable names
Select-String -Pattern "GROQ_API_KEY|OPENROUTER_API_KEY" -Path "apps/web/dist/**/*.js"
# Must return NOTHING
```

---

## 8. Architecture Constraints — DO NOT VIOLATE

1. **No `VITE_*` for secrets.** Model API keys are server-only in `services/api/src/config.ts`. Never prefix with `VITE_`.

2. **No new frameworks/libraries** without updating ARCHITECTURE.md first. Use native HTML, existing project patterns, and the packages already in `package.json`.

3. **Parse at boundaries.** Every row from the DB gets parsed through the contract schema (`parseRow`/`parseRows` from `shared.ts`). Never cast with `as`.

4. **Fail closed.** If a source isn't ready, it throws `ApiError('unavailable', ...)`. Never return partial data or silently skip.

5. **No invented numbers.** The narrator's `introducedNumbers()` guard is the control. Never bypass it.

6. **Authorization from verified token only.** `membershipOf(request)` → membership claims. Never trust client fields, request body role claims, or URL parameters for authorization.

7. **`out_of_scope` is an explicit result.** Return HTTP 200 with outcome `out_of_scope`, not a 403. The Evidence Card must show the scope and limitations disclosure.

8. **All 14 roles, all 109 assignments, all 29 definition families** must be preserved. Do not filter or subset them.

9. **Synthetic data is `provenance: "illustrative"`.** Never label synthetic data as real. Never label entered data as synthetic.

10. **Every number surface shows the disclosure** (`ILLUSTRATIVE_DISCLOSURE` from `modules/index.ts`).

---

## 9. File Map — Where Everything Lives

```
orbit/
├── apps/web/                          # Vite + React frontend
│   ├── src/features/
│   │   ├── ask/route.tsx              # Ask UI — needs T3 badge
│   │   ├── actions/                   # Actions UI
│   │   ├── audit/                     # Audit trail UI
│   │   ├── brief/                     # Morning Brief UI
│   │   ├── explorer/                  # KPI Explorer UI
│   │   ├── inbox/                     # Priority Inbox UI
│   │   └── workspace/                 # Layout, routing, environment
│   ├── src/lib/api.ts                 # API client (contract-parsed)
│   ├── src/lib/auth.ts                # Supabase auth
│   └── src/preview/                   # Dev-only fixture API
├── packages/
│   ├── contracts/src/                 # Shared Zod schemas
│   │   ├── ask.ts                     # AskModeSchema — needs T2 change
│   │   ├── actions.ts                 # ActionState, transitions
│   │   ├── kpi.ts                     # ObservationSchema
│   │   └── inbox.ts                   # ExceptionSchema
│   ├── kpi-framework/                 # 109 assignments, 14 roles
│   └── data-gen/                      # Seed generator
├── services/api/
│   ├── src/
│   │   ├── app.ts                     # Vercel entrypoint
│   │   ├── config.ts                  # Env vars, provider config
│   │   ├── wiring.ts                  # Source switching — needs T7
│   │   ├── db/
│   │   │   ├── client.ts              # pg pool
│   │   │   ├── rls.ts                 # withMembershipTx
│   │   │   ├── memberships.ts         # MembershipSource
│   │   │   ├── sources.ts             # Entitlements, scope, entities SQL
│   │   │   ├── actions.ts             # ❌ NEEDS CREATING (T4)
│   │   │   ├── audit.ts              # ❌ NEEDS CREATING (T4)
│   │   │   ├── observations.ts        # ❌ NEEDS CREATING (T5)
│   │   │   ├── exceptions.ts          # ❌ NEEDS CREATING (T5)
│   │   │   ├── dataset.ts             # ❌ NEEDS CREATING (T5)
│   │   │   └── assignees.ts           # ❌ NEEDS CREATING (T6)
│   │   ├── modules/
│   │   │   ├── ask/
│   │   │   │   ├── catalogue.ts       # Deterministic pipeline — needs T1
│   │   │   │   ├── narrator.ts        # ✅ Model client (built)
│   │   │   │   ├── narrator.test.ts   # ✅ Tests (built)
│   │   │   │   ├── prompts.ts         # Guided prompts
│   │   │   │   └── routes.ts          # POST /ask, GET /ask/prompts
│   │   │   ├── pending.ts             # Fail-closed stubs — needs T7
│   │   │   ├── ports.ts               # Port interfaces — needs askProviders
│   │   │   └── ...                    # Other modules (built)
│   │   └── plugins/
│   │       ├── auth.ts                # JWT + membership
│   │       ├── scope.ts               # Entitlements + scope resolution
│   │       └── errors.ts              # ApiError
├── supabase/
│   ├── migrations/                    # 6 existing + needs T4, T5 migrations
│   └── seed/                          # Framework + org seed
└── docs/decisions/                    # 15 ADRs
```

---

## 10. Priority Order

If you can only do some of these, do them in this order:

1. **T2** — `AskModeSchema` contract change (smallest, unblocks T1 and T3)
2. **T1** — Wire narration into catalogue.ts (the "real AI" integration)
3. **T3** — Evidence Card badge (the UI side of T1+T2)
4. **T4** — Actions + Audit Postgres stores (largest scope, most value)
5. **T5** — Observations + Exceptions stores
6. **T7** — Wire everything into `wiring.ts`
7. **T6** — AssigneeDirectory
8. **T10** — Context Notes (if ADR 0015 accepted)

T8, T9, T11, T12 require Supabase dashboard and Vercel access — they cannot be done in code alone.

---

## 11. Completion Report Format

When done, produce a report with:
- Changed files and the user-visible outcome
- Commands/checks run and their results  
- Touched boundaries marked **verified** or **assumed**
- Source-material and security limitations
- Follow-up decisions required before deployment