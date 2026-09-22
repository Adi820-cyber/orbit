# Orbit

Orbit is a role-scoped leadership decision workspace for a fictional healthcare group. It is designed to help a leader move from **See → Understand → Act** through a morning brief, priority inbox, KPI explorer, governed Ask experience, evidence, and persisted internal actions.

This repository currently contains the research-backed product specification only. Application code, cloud projects, database migrations, generated data, and deployment configuration have not been implemented.

## Start here

1. Read `AGENTS.md` before using an AI coding agent.
2. Read `RULES.md` before proposing implementation changes.
3. Read `docs/orbit/PRD.md`, `docs/orbit/ARCHITECTURE.md`, and `docs/orbit/TEAM_ASSIGNMENTS.md`.
4. Read `docs/source-material/README.md` before making source-backed claims about the workbook or pitch.

## Confirmed direction

- All 14 role dashboards are in release-one scope.
- Supabase Postgres and Supabase Auth are the proposed persistence and identity boundary.
- The frontend and backend are separate Vercel projects in one future monorepo.
- The initial implementation milestone is a Regional COO vertical slice.
- Synthetic values must remain visibly illustrative.
- Role and scope come from verified membership and entitlement data, never from UI state or request fields.

## Repository status

The three documents under `docs/orbit/` are specifications, not evidence that the described system exists. Every future implementation boundary must be labelled as verified or assumed until integration tests and deployment checks prove it.

## Collaboration

Use a short-lived topic branch and a pull request for every change. Keep pull requests small, synchronize with `main` before requesting review, and do not resolve conflicts by blindly choosing one side. See `AGENTS.md`, `RULES.md`, and `.github/pull_request_template.md`.
