# Orbit

Orbit is a role-scoped leadership decision workspace for a fictional healthcare group. It is designed to help a leader move from **See → Understand → Act** through a morning brief, priority inbox, KPI explorer, governed Ask experience, evidence, and persisted internal actions.

Orbit is implemented and live (as of 2026-10-07): the leadership workspace, the hospital operations ERP, the Assistant, billing and the outbreak watch. **New here? Start with [`docs/handover/`](docs/handover/README.md)**: a shareable project brief, the operating handbook, and the context for continuing the work.

## Start here

1. Read `AGENTS.md` before using an AI coding agent.
2. Read `RULES.md` before proposing implementation changes.
3. Read `docs/orbit/PRD.md`, `docs/orbit/ARCHITECTURE.md`, and `docs/orbit/TEAM_ASSIGNMENTS.md`.
4. Read `docs/orbit/FILE_STRUCTURE.md` to see exactly which path you create and own, before creating any file.
5. Read `docs/source-material/README.md` before making source-backed claims about the workbook or pitch.

## Confirmed direction

- All 14 role dashboards are in release-one scope.
- Supabase Postgres and Supabase Auth are the proposed persistence and identity boundary.
- The frontend and backend are separate Vercel projects in one future monorepo.
- The initial implementation milestone is a Regional COO vertical slice.
- Synthetic values must remain visibly illustrative.
- Role and scope come from verified membership and entitlement data, never from UI state or request fields.

## Repository status

The documents under `docs/orbit/` began as specifications; the code, migrations and tests are now the source of truth for what exists. Every boundary is still labelled verified or assumed until tests and deployment checks prove it.

## Collaboration

Use a short-lived topic branch and a pull request for every change. Keep pull requests small, synchronize with `main` before requesting review, and do not resolve conflicts by blindly choosing one side. See `AGENTS.md`, `RULES.md`, and `.github/pull_request_template.md`.
