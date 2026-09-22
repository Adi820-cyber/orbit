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

## Blocking constraint found 2026-09-23: legacy keys cannot be rotated

An attempt to carry out the rotation established that **"rotate the
service-role key" is not an available operation.** Verified facts:

- Supabase's own troubleshooting guide for this exact scenario states it
  is no longer possible to rotate the legacy `anon`, `service_role`, and
  JWT secrets. Migration to asymmetric JWT signing keys is a prerequisite;
  only after that can keys be rotated and revoked.
  <https://supabase.com/docs/guides/troubleshooting/rotating-anon-service-and-jwt-secrets-1Jq6yd>
- The Supabase CLI cannot perform any of this. `supabase projects api-keys`
  is list-only — there is no rotate, revoke, or create subcommand
  (verified against CLI v2.115.0). All remediation is dashboard work.
- The exposed legacy `service_role` JWT for `xvqvqprztbvcywhrpnpf` carries
  an expiry in 2036. It remains valid until the signing key that produced
  it is revoked. Nothing expires this on a useful timescale.
- That project currently exposes both legacy keys (`anon`, `service_role`)
  and new-style keys (`sb_publishable_*`, `sb_secret_*`).

### Revised remediation sequence (dashboard, Project Settings → JWT Keys)

1. Migrate the project to asymmetric JWT signing keys.
2. Rotate the signing key, which moves the current key to "previously
   used keys."
3. **Explicitly revoke the previous key.** Rotation alone does not
   invalidate it — per the guide, un-revoked older keys stay valid. This
   step is what actually kills the exposed JWT.
4. Separately rotate the `sb_secret_*` key; the new-style keys are
   designed for direct rotation.
5. Once nothing depends on them, disable legacy API keys for the project.

### Decision still required from the project owner (Maruti)

This project is in Maruti's organization (`eglaidmsxfgxbrqkeudo`) and has
existing migrations applied 2026-09-10, so it is in use for something.
Steps 1–3 will invalidate any client currently using its legacy keys.
Because Orbit is building on a new project regardless, there are two
viable paths and the owner picks:

- **Migrate, rotate, revoke** — keep the project, accept that anything
  using its legacy keys must be updated.
- **Delete the project** — if it is not needed, deletion removes the
  exposure outright and is less work than the migration path.

Either closes the exposure. Doing neither does not.

## Amendment 2026-09-23: new-project work is no longer gated on this cleanup

**I am narrowing a gate I wrote too broadly.** The Consequences section below
originally said that until every box is checked, "no new Supabase project work,
schema/RLS migrations, or data-gen work against real infrastructure should
proceed." That is stricter than the risk justifies, and it serialised the whole
team behind one owner's dashboard decision.

The gate existed to stop us building on compromised infrastructure. A brand-new
Supabase project, created fresh, is not compromised: it shares no signing key,
no API key, and no database with either exposed project. Waiting does not make
the new project safer. It only delays Maruti's migrations and keeps Ghansham's
seven RLS leak tests skipped.

**Revised position: creating the new Orbit dev project and applying migrations
to it may proceed in parallel with closing out the old projects**, provided all
of the following hold. These are conditions, not suggestions.

1. **Asymmetric JWT signing keys from creation.** Not legacy shared-secret.
   This is what makes future rotation possible at all — the whole reason we are
   stuck on the old project is that it cannot be rotated. Do not inherit that
   problem.
2. **No credential, connection string, password, or key copied from either
   exposed project.** New project, new everything.
3. **Legacy API keys disabled** on the new project if it offers them, so
   `anon`/`service_role` never come into existence there. New projects created
   after the legacy-key sunset should not have them; verify rather than assume.
4. **The API connects as `orbit_app`**, never `postgres` and never a secret or
   service key (ARCHITECTURE.md §7.1). The seeder is a separate restricted role.
5. **Keys are never displayed outside the Supabase dashboard.** Not in a
   terminal, not in a chat, not in a screenshot, not in a ticket. See the
   incident log above for why this is written as a rule rather than assumed as
   common sense.

**What is still gated, and is not being waived:** the exposure on the old
project(s) remains open until the remediation sequence above is completed. This
ADR stays `Proposed` and cannot be marked Accepted on the strength of the new
project existing. Decoupling the work is not closing the finding.

## Acceptance criteria (from TEAM_ASSIGNMENTS.md §8.1, expanded after incident log above)

- [ ] Original leaked key (from old repo's `scripts/seed_supabase.mjs`) neutralized in its project — note the same legacy-key constraint above applies, so this is migrate+rotate+revoke or delete, not a simple rotation
- [ ] `xvqvqprztbvcywhrpnpf`: owner (Maruti) chooses migrate+rotate+revoke or delete, and the chosen path is completed
- [ ] Previous signing key explicitly **revoked**, not merely rotated (rotation alone leaves it valid)
- [ ] `sb_secret_*` key for that project rotated
- [ ] History-scrub decision made and recorded above (with date and who approved)
- [ ] New, separate Supabase project created for Orbit dev, not derived from either project above
- [ ] Repo/CI secret scan configured and passing
- [ ] This ADR updated to Status: Accepted, with resolution date

## Consequences

- ~~Until all boxes above are checked, no new Supabase project work,
  schema/RLS migrations, or data-gen work against real infrastructure
  should proceed (Maruti's Gate 0 work is gated on this).~~
  **Superseded by the 2026-09-23 amendment above.** New-project work may
  proceed in parallel under the five conditions listed there. Work against
  *the exposed projects* remains blocked until remediation completes.
- The 2026-09-22 incident means the team's working assumption is now:
  build fresh, do not attempt to reuse or "clean" any project whose keys
  have ever been displayed outside the Supabase dashboard.
- Once resolved, this ADR is the durable record that the exposure was
  found, closed, and not silently ignored, satisfying RULES.md's
  requirement to record security-relevant decisions rather than act on
  them informally.
