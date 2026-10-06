# Orbit — File Structure and Ownership Map

**Status:** Operational reference derived from [Architecture §4](ARCHITECTURE.md#4-monorepo-layout) and [Team Assignments §2, §5–§8](TEAM_ASSIGNMENTS.md#2-team-at-a-glance). This file adds no new decision. If it ever disagrees with those two documents, they win — fix this file, not the other way round.

## 1. How to use this map

Before creating a file or folder, find its closest listed parent below.

- If the path is inside a section owned by someone else, do not create it. Build against `docs/orbit/PRD.md` and the shared `packages/contracts` fixtures instead, and label the result unverified, per `AGENTS.md` and [Team Assignments §3.8](TEAM_ASSIGNMENTS.md#3-rules-of-engagement-all-four).
- If a path is not listed anywhere in this file, it does not exist yet in the plan. Read [Architecture §4](ARCHITECTURE.md#4-monorepo-layout) before inventing a new top-level folder, and get Aditya's review first, per `RULES.md`.
- This map does not authorize starting implementation by itself. It only tells you where a path belongs once the owning person begins that part of the plan.

## 2. Current actual repository (today)

```
orbit/
  README.md
  AGENTS.md
  RULES.md
  .gitignore
  .github/
    copilot-instructions.md
    pull_request_template.md
  docs/
    orbit/
      PRD.md
      ARCHITECTURE.md
      TEAM_ASSIGNMENTS.md
      FILE_STRUCTURE.md        # this file
    source-material/
      README.md
```

Nothing else exists yet: no package manifest, application code, migration, or generated data. Everything in §3 below is proposed and appears only once its owner creates it.

## 3. Proposed monorepo layout and who creates each path

This mirrors [Architecture §4](ARCHITECTURE.md#4-monorepo-layout) exactly, with the owner from [Team Assignments §2](TEAM_ASSIGNMENTS.md#2-team-at-a-glance) tagged on each top-level path.

```
orbit/
  package.json                  # [Aditya] Gate 0 repo foundation
  tsconfig.base.json            # [Aditya] Gate 0 repo foundation
  .env.example                  # [Aditya] every var documented here first
  apps/
    web/                        # [Ayas] owns everything under apps/web
      vercel.json
      src/
        main.tsx
        router.tsx
        lib/                    # api.ts is the ONLY place that calls fetch (ARCH §5)
        features/
          brief/  inbox/  explorer/  ask/  actions/  audit/
          operations/           # leaders' live hospital-operations page (ADR 0018)
          erp/                  # hospital operations app, operator accounts only (ADR 0016)
          chatbot/              # the Assistant's typed-question action: knowledge search, Ask fallback (ADRs 0019, 0021)
        roles/                  # one folder per role — view config only, not per-role apps
          chairman/  clinical-director/  regional-coo/  hospital-dho/
          people-executive/  bd-lead/  billing-lead/  coe-lead/
          corporate-revenue-lead/  group-cfo/  procurement-head/
          hr-head/  legal-head/  analytics-head/
  services/
    api/                        # [Ghansham] owns everything under services/api
      vercel.json
      src/
        app.ts                  # Vercel-detected Fastify entrypoint
        plugins/
          auth.ts  scope.ts  errors.ts
        modules/
          brief/  inbox/  kpi/  ask/  actions/  audit/
          erp/  operations/  chatbot/   # ADR 0016, 0018, 0019
        knowledge/              # knowledge sync job (ADR 0019)
        knowledge-sync.ts       # its entry point: npm run knowledge:sync
        db/
          client.ts  rls.ts
    simulator/                  # [Ghansham] live hospital simulator, runs on Render (ADR 0017)
  packages/
    contracts/                  # [Shared] see §4 below — nobody owns this alone
    ui-kit/                     # [Ayas] Recharts is imported ONLY here
    kpi-framework/              # [Maruti] generated from the workbook, never hand-edited
    data-gen/                   # [Maruti] deterministic generator + invariant checks
  render.yaml                   # [Ghansham] Render Blueprint: simulator worker + knowledge sync cron
  supabase/
    migrations/                 # [Maruti] grants + RLS in the same migration as each table
    tests/                      # [Maruti] pgTAP allow/deny tests
    seed/                       # [Maruti] environment-restricted loader
  data/
    snapshots/                  # [Maruti] generated JSON + manifest + checksum
  docs/
    orbit/                      # already exists — PRD, architecture, assignments, this file
    decisions/                  # [Aditya] one short ADR per resolved open decision
```

## 4. Shared boundary: `packages/contracts/`

No single person owns `packages/contracts/`. Per [Team Assignments §2](TEAM_ASSIGNMENTS.md#2-team-at-a-glance):

- Whoever needs a new or changed shape authors the change there.
- The owner on the other side of that boundary reviews it.
- Aditya arbitrates if the two sides disagree.
- Nobody merges a contract change unilaterally, and nobody keeps a local duplicate of a contract type instead of importing it.

## 5. Root and process files

- `package.json`, `tsconfig.base.json`, `.env.example` — created once by Aditya at Gate 0 ([Team Assignments §8](TEAM_ASSIGNMENTS.md#8-aditya--security-connectivity-integration)). Everyone else adds their own workspace's manifest inside their owned path, not the root one.
- `AGENTS.md`, `RULES.md`, `.github/*` — process files. Changing them needs the boundary owner plus Aditya, per `RULES.md` ("Ask first").
- `docs/orbit/PRD.md`, `ARCHITECTURE.md`, `TEAM_ASSIGNMENTS.md` — reviewed, dated specifications. Propose changes through a pull request and Aditya's review rather than editing them in place for convenience.
- `docs/decisions/` — Aditya's path for short ADRs once an open decision from PRD §10 / Architecture §17 is resolved.

## 6. Sequencing: build your own path first, not the whole tree

Follow the gates in [Team Assignments §4](TEAM_ASSIGNMENTS.md#4-dependency-gates-sequencing) instead of creating every folder above at once:

1. **Gate 0:** each owner creates only their own foundation (Maruti's framework import, Ayas's shell/tokens, Ghansham's API skeleton, Aditya's repo/cloud foundation) plus a first draft of `packages/contracts`.
2. **Gate 1:** contracts are frozen after all four review them.
3. **Vertical slice:** Regional COO only, across Maruti/Ghansham/Ayas paths, proves the pattern before the other 13 roles.
4. **Gate 2:** full dataset, all modules, all 14 role views, then Aditya's deploy/security/demo pass.

## 7. Conflict-avoidance quick rules

- One branch per person and scope: `<owner>/<scope>-<change>` (`AGENTS.md`).
- Never create files inside another owner's top-level path from §3. Build against `packages/contracts` and fixtures instead, and say so in the pull request.
- Sync `origin/main` into your branch before opening or updating a pull request; resolve conflicts by reading both sides, never by blindly keeping "ours" or "theirs" (`RULES.md`).
- A contract change is one pull request, reviewed by the boundary's other owner, not folded into an unrelated feature change.
- Do not add a new top-level folder that is not listed in §3 without an ADR and Aditya's review.

## Sources

Derived from [Architecture §4](ARCHITECTURE.md#4-monorepo-layout) and [Team Assignments §2](TEAM_ASSIGNMENTS.md#2-team-at-a-glance), [§3](TEAM_ASSIGNMENTS.md#3-rules-of-engagement-all-four), [§4](TEAM_ASSIGNMENTS.md#4-dependency-gates-sequencing), [§5](TEAM_ASSIGNMENTS.md#5-maruti--database-and-data), [§6](TEAM_ASSIGNMENTS.md#6-ghansham--backend), [§7](TEAM_ASSIGNMENTS.md#7-ayas--frontend), and [§8](TEAM_ASSIGNMENTS.md#8-aditya--security-connectivity-integration). No new claims about the workbook, pitch, or vendor behavior are made here.
