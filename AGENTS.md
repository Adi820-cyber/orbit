# Orbit — Agent Instructions

Orbit is a role-scoped leadership decision workspace for a fictional healthcare group. This repository currently contains the product, architecture, and team specifications; it does not contain an implemented application.

These instructions apply to the whole repository. `RULES.md` is the detailed safety and collaboration policy and must be read before changing files. User instructions take precedence over repository instructions. If a future directory adds a nearer `AGENTS.md`, the nearer file governs that directory.

## Source of truth

- Product behavior and acceptance: `docs/orbit/PRD.md`
- Architecture and proposed boundaries: `docs/orbit/ARCHITECTURE.md`
- Ownership, sequencing, and interfaces: `docs/orbit/TEAM_ASSIGNMENTS.md`
- Exact file/folder ownership map: `docs/orbit/FILE_STRUCTURE.md`
- Sensitive source-material policy: `docs/source-material/README.md`
- AI safety and collaboration rules: `RULES.md`

The three Orbit documents are proposed specifications. Do not describe a proposed feature, boundary, deployment, security control, or test as implemented until the repository contains it and the relevant check has passed.

## Before changing anything

1. Read the applicable source-of-truth documents and the nearest `AGENTS.md`.
2. Inspect the current tree, `git status --short`, existing scripts, tests, workflows, and package manifests.
3. Search for an existing library, component, contract, helper, or generated source before creating a duplicate.
4. Identify the owning person and every module boundary affected.
5. If a requirement, data shape, authorization rule, target, threshold, source artifact, or command is missing, stop and label the uncertainty. Do not silently invent it.

## Non-negotiable product invariants

- Preserve all 14 roles, all 109 workbook assignments, and all 29 definition families.
- Use shared boundary contracts in `packages/contracts` once implementation begins. Parse at boundaries; do not create local copies or silence mismatches with casts.
- Generate coherent synthetic facts before derived KPIs. Never hardcode realistic-looking values, facility names, targets, thresholds, or clinical claims.
- Render `provenance: "illustrative"`, data quality, limitations, and the returned disclosure on every number surface.
- Derive role and scope from verified authentication, membership, and entitlements. Never trust request fields, client state, model output, or a role switcher.
- Treat `out_of_scope` as an explicit result. Never silently narrow an unauthorized request and present it as complete.
- Keep model/Ask behavior authorization-first, typed, and evidence-backed. No arbitrary SQL, invented policy citations, fabricated confidence, or browser-side model secret.
- Preserve the proposed lightweight stack. Do not add a framework, library, component system, cache, ORM, or local container requirement because it is popular. Research the need and update the architecture first.

## Research-before-coding rule

For any new dependency, framework, component primitive, test tool, data provider, deployment feature, or security mechanism:

1. Search the official documentation for the currently supported behavior.
2. Search this repository and the specifications for an existing approved alternative.
3. Compare user value, operational weight, security, accessibility, and AWS portability.
4. Record the decision in the relevant specification or an ADR before implementation.
5. Use the smallest adopted surface; do not install a package merely to avoid reading existing code.

Use native HTML and existing project patterns first. Selective unstyled Radix primitives may be wrapped in `packages/ui-kit` when they materially improve accessibility. Styled component libraries, broad state-management libraries, arbitrary AI/search tools, and duplicate data-fetching layers require an explicit reviewed decision.

## Development and validation

The implementation has not started, so do not invent working commands. Once package manifests and scripts exist, document and run the exact commands in this file and in the owning package’s nearest instructions file.

Before declaring an implementation change complete:

- Run the narrowest relevant test, typecheck, lint, and build checks.
- Run the full repository gates when they exist.
- Run data invariants and authorization allow/deny tests for data or scope changes.
- Use the real browser smoke path for UI changes when it exists; automated accessibility checks do not replace manual keyboard review.
- Check that no secret, `.env` file, patient/employee record, client source artifact, generated credential, or large unrelated file entered the change.
- State which touched boundaries were verified against actual code/deployment and which remain assumptions.

## GitHub collaboration and conflict avoidance

- Work from `main` only to create a short-lived branch named `<owner>/<scope>-<change>`.
- Never push directly to `main`, force-push a shared branch, or rewrite another contributor’s branch.
- Keep one concern per pull request and avoid drive-by formatting or generated-file churn.
- Before opening or updating a pull request, fetch the latest `origin/main` and rebase or merge it into your own branch. Resolve conflicts locally and inspect the final diff; never accept “ours” or “theirs” blindly.
- Do not continue work on a branch after it has been merged. Create a fresh branch from updated `main`.
- A pull request must describe scope, tests, security/data impact, boundary verification, and remaining assumptions. Use `.github/pull_request_template.md`.
- Changes to contracts, authorization, secrets, deployment, migrations, source-data rules, or these instruction files require review from Ghansham (GitHub `ghanshamrna27`). Since 2026-10-06 he builds Orbit alone and owns every path and review, and the hosting: Vercel (`orbit-api`, `orbit-web`, `orbit-erp-web`), Supabase and GitHub Actions. See `docs/orbit/TEAM_ASSIGNMENTS.md` (handover note).
- Do not add a dependency or alter CI/deployment policy in the same pull request as unrelated feature work.

## Safe command policy

Read-only inspection is allowed. Commands that modify source, dependencies, migrations, cloud settings, repository settings, branches, or data require a clear task scope. Ask before destructive operations, production operations, credential rotation, history rewriting, dependency upgrades, database resets, or changing branch protections.

Never print or paste secrets. Refer to environment-variable names only. Never copy a credential from an old repository or use a service-role key in browser code.

## Completion report

Every task report must include:

- changed files and the user-visible or developer-visible outcome;
- commands/checks run and their results;
- touched boundaries marked **verified** or **assumed**;
- source-material and security limitations;
- follow-up decisions required before implementation can proceed.
