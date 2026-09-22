# Orbit — AI Safety and Development Rules

These rules are intentionally specific. They exist to prevent common AI coding failures: coding before understanding the repository, recreating an existing library, inventing data, widening authorization, exposing secrets, making unsupported claims, and creating merge conflicts.

## Precedence

1. Explicit user instructions.
2. The nearest applicable `AGENTS.md`.
3. This file.
4. Other repository documentation.

If instructions conflict, stop and report the conflict. Do not choose silently.

## Always

- Inspect before editing. Read the relevant specification, source, configuration, tests, and Git status.
- Research official documentation before adopting or recommending a framework, package, component, API, cloud feature, or security control.
- Prefer an existing approved library or repository pattern over a new dependency.
- Keep cross-module shapes in `packages/contracts` once implementation begins and parse them at both boundaries.
- Preserve the 14-role scope, 109 assignments, 29 definition families, independent authorization scopes, and illustrative-data disclosures.
- Generate synthetic facts first and derive metrics from them. Keep missing, stale, unreconciled, unavailable, and zero states distinct.
- Use the server authorization path for every protected read and write. Test both allow and deny cases.
- Keep secrets in approved environment/secret stores. Use variable names in documentation, never secret values.
- Add or update tests for behavior changes and run the smallest relevant check before broad checks.
- Keep changes small and single-purpose. Update the branch from `origin/main` before requesting review.
- Report exact verification results and label every unverified boundary as an assumption.

## Ask first

Ask the human before:

- adding, removing, or replacing a production dependency;
- changing the pinned stack, package boundaries, shared contracts, database schema, RLS/grants, auth flow, or deployment topology;
- changing a KPI definition, target basis, threshold, role entitlement, permitted breakdown, or source-data interpretation;
- adding real data, client source artifacts, clinical content, compliance claims, residency claims, or external integrations;
- changing CI, branch protections, repository visibility, secrets, permissions, or CODEOWNERS;
- running a destructive command, database reset, migration against a shared/production environment, release, publish, force push, or history rewrite;
- resolving a merge conflict when the intended behavior is ambiguous;
- creating a second implementation of an existing helper, table, component, contract, or workflow;
- changing these rules or `AGENTS.md`.

## Never

- Never code from a vague request when the repository, specification, or owner boundary is unclear.
- Never guess a file path, API response, database field, KPI name, facility, target, threshold, credential, or user identity.
- Never create a local duplicate of a shared contract or use a type cast to hide a contract mismatch.
- Never add a library because it is popular, because a tutorial used it, or because reading the existing code is inconvenient.
- Never replace the pinned stack with Next.js, another backend framework, an ORM, a global state library, a styled component library, or an arbitrary AI/search layer without a reviewed decision.
- Never let a model choose a role, expand scope, emit arbitrary SQL, invent evidence, cite an unverified policy, or execute an action.
- Never trust a role or scope from a request parameter, URL, browser state, hidden field, or model response.
- Never silently filter an unauthorized request and label the partial result complete.
- Never publish unsupported clinical, financial, legal, compliance, immutability, residency, or security claims.
- Never remove illustrative labels or disclosures to improve screenshots.
- Never commit `.env`, credentials, tokens, private keys, dumps, real patient/employee records, or unapproved source spreadsheets/presentations.
- Never place a database URL, service-role/secret key, model-provider key, or privileged credential in browser code or a `VITE_*` variable.
- Never use broad `USING(true)` authorization, disable a security control to meet a demo date, or log secrets/tokens/raw sensitive prompts.
- Never push directly to `main`, force-push a shared branch, or merge without the required review/checks.
- Never resolve conflicts by choosing “ours” or “theirs” without understanding both sides.
- Never claim a test, deployment, review, or integration was performed when it was not.
- Never commit generated output or bulk formatting unrelated to the task.

## Dependency decision record

Before a new dependency is approved, record:

- the user problem and why existing code is insufficient;
- official documentation and version compatibility;
- accessibility, security, bundle, operational, and AWS-portability impact;
- alternatives considered, including not adding it;
- owner/reviewer and the acceptance test;
- whether the dependency is adopted now, optional later, or rejected.

## GitHub branch and pull-request protocol

1. Start from a current local `main`.
2. Create `<owner>/<scope>-<short-change>`.
3. Make one focused change and commit it with a meaningful message.
4. Fetch `origin/main` before review; merge or rebase it into the topic branch.
5. Resolve conflicts locally, inspect `git diff --check`, run tests, and confirm no conflict markers remain.
6. Open a pull request against `main` using the template.
7. Wait for required review and checks. Do not self-merge a sensitive boundary change.
8. Delete the branch after merge and start future work from updated `main`.

## Definition of done

A change is not done until the relevant implementation, tests, documentation, security/data review, and boundary verification are complete. If a check cannot run because the project is not implemented or an approved environment is unavailable, say so explicitly rather than substituting a claim.
