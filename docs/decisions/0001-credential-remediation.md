# ADR 0001: Remediate exposed Supabase service-role credential

- **Status:** Proposed — blocked on Aditya completing the rotation steps below and checking off the acceptance criteria. Do not mark Accepted until every checkbox is true and dated.
- **Owners:** Aditya (lead), Maruti (co-owner per TEAM_ASSIGNMENTS.md §8.1)
- **Date opened:** 2026-09-22
- **Date resolved:** _(fill in when Accepted)_

## Context

During research for the Orbit rebuild, a hard-coded Supabase service-role
credential was found in `scripts/seed_supabase.mjs` in an old, unrelated
remote repository. Per TEAM_ASSIGNMENTS.md §8 and ARCHITECTURE.md §7.5/§12,
nobody on the current team has used this credential, but it is a live
secret until proven otherwise, and its existence violates the project's
non-negotiable rule that the API and any tooling connect as the
least-privilege `orbit_app` role, never `service_role` or `postgres`
(service role bypasses RLS entirely).

This is called out as the team's first required task: "before any new
build" (TEAM_ASSIGNMENTS.md §8.1). Gate 0 cloud foundations (new Supabase
dev/prod projects) should not be treated as trustworthy until this is
closed.

## Decision

1. Rotate/revoke the exposed service-role key in the affected (old)
   Supabase project's API settings, so the leaked value can no longer
   authenticate.
2. **Do not attempt to clean up or continue building on the old/candidate
   project.** Treat it as burned. Create a fresh Supabase project for
   Orbit dev (and, later, prod) that never shared credentials with the
   old one. This matches the plan already in ARCHITECTURE.md §3/§7.5 and
   is now reinforced by the incident in the log below: once a
   service-role key for a project has been exposed anywhere (old repo,
   chat log, screenshot, ticket), the project's keys must be rotated and
   the project should not be treated as a clean base to build on until
   rotation is confirmed. New build work happens in a new project.
3. Decide and record whether the old repository's git history needs a
   scrub (e.g. BFG/filter-repo) or whether revocation alone is sufficient
   because the repo is being abandoned/archived rather than continued.
   _(Fill in the actual decision below once made — do not assume either
   outcome in advance.)_
4. Add/confirm a repo and CI secret scan (e.g. gitleaks or equivalent) so
   this class of leak is caught automatically going forward, per
   ARCHITECTURE.md §16 checklist.

## History-scrub decision

_(To be filled in by Aditya — state which option was chosen and why:
"revoke only" vs "revoke + history scrub", and what happens to the old
repository, e.g. archived/deleted/left as-is with revoked credentials.)_

## Incident log

**2026-09-22 — Second exposure, caused during investigation of this ADR.**
While trying to identify whether Supabase project `xvqvqprztbvcywhrpnpf`
(org `nimbalkarmaruti62`, Maruti's team, Sydney region, created
2026-09-10) was the project referenced by the original leak, the agent
ran `supabase projects api-keys --project-ref xvqvqprztbvcywhrpnpf`
without restricting output, which printed the live `anon` and
`service_role` JWTs (and `sb_publishable_*` / `sb_secret_*` keys) into
the chat session in plaintext. This was a process failure — secrets
should never have been requested in a form that echoes the value; only
key *names*/*status* should have been queried.

Consequences and required action:
- The `service_role` (and ideally `anon`, `sb_secret_*`) keys for
  project `xvqvqprztbvcywhrpnpf` must be treated as compromised and
  rotated in the Supabase dashboard (Settings → API), regardless of
  whether this project turns out to be the one referenced in the
  original old-repo leak.
- This project should not be used as the base for new Orbit build work.
  Per the revised decision above, a new project should be created for
  Orbit dev/prod instead.
- Confirmation that this project is/is not the same one referenced by
  the original `scripts/seed_supabase.mjs` leak is still open — it does
  not change the required action (rotate either way), but should be
  recorded here once known, for the historical record.
- No further commands that can echo full key values should be run
  against any live project from this environment. Key presence/rotation
  status should be verified via the dashboard directly, or via
  CLI/API calls that return only metadata, never the secret value.

**Status of this specific project:** has existing migrations
(`20260910154440`, `20260910164936`, applied 2026-09-10) — it is not an
empty/unused project, so it is not being deleted casually; the owner
(Maruti, on whose org it lives) should decide whether to rotate keys and
keep the project for other purposes, or retire it entirely, separately
from Orbit's decision to build in a new project.

## Alternatives considered

- **Leave the key active but restrict its permissions.** Rejected —
  service-role keys are full-bypass by design in Supabase; there is no
  partial-permission variant. Rotation is the only way to neutralize it.
- **Ignore it since "nobody on this team used it."** Rejected — a leaked
  service-role key is a standing risk regardless of who introduced it;
  RULES.md prohibits disabling or ignoring a known security exposure.

## Acceptance criteria (from TEAM_ASSIGNMENTS.md §8.1, expanded after incident log above)

- [ ] Original leaked key (from old repo's `scripts/seed_supabase.mjs`) revoked/rotated in its project
- [ ] `xvqvqprztbvcywhrpnpf` service_role/anon/sb_secret keys rotated (required due to 2026-09-22 incident, independent of whether this is the original leak's project)
- [ ] History-scrub decision made and recorded above (with date and who approved)
- [ ] New, separate Supabase project created for Orbit dev, not derived from either project above
- [ ] Repo/CI secret scan configured and passing
- [ ] This ADR updated to Status: Accepted, with resolution date

## Consequences

- Until all boxes above are checked, no new Supabase project work,
  schema/RLS migrations, or data-gen work against real infrastructure
  should proceed (Maruti's Gate 0 work is gated on this).
- The 2026-09-22 incident means the team's working assumption is now:
  build fresh, do not attempt to reuse or "clean" any project whose keys
  have ever been displayed outside the Supabase dashboard.
- Once resolved, this ADR is the durable record that the exposure was
  found, closed, and not silently ignored, satisfying RULES.md's
  requirement to record security-relevant decisions rather than act on
  them informally.
