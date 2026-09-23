# ADR 0013: One Vercel project, same-origin; and how demo credentials reach users

- **Status:** Proposed. §1 contradicts ARCHITECTURE.md §11.1, which is a reviewed specification, so it needs Ghansham (owns the API), Ayas (owns the client) and Maruti before it lands. §2 is mine and is Accepted. **Updated 2026-09-23** with a research pass that names the mechanism (Vercel Services), records two caveats including that it is in Beta, and identifies a defect in our own `/health` route that the topology would expose — see "Research update". Still Proposed: documentation is not a deployment.
- **Owner:** Aditya
- **Date:** 2026-09-23
- **Supersedes if accepted:** the two-project topology in ARCHITECTURE.md §11.1

## 1. Collapse to one Vercel project serving `/` and `/api/*`

### The contradiction that prompted this

ARCHITECTURE.md §13 says: *"Avoid Vercel-only features in business logic (Cron,
**Related Projects**, Fluid-only APIs); if used operationally, record the AWS
equivalent … in an ADR when adopted."*

ARCHITECTURE.md §11.2 then wires `VITE_API_BASE_URL` "from Related Projects in
previews", and §14 lists "Related Projects ≤ 3" as fitting "our 2-project
topology."

So the architecture forbids the feature its own deployment model depends on, and
the ADR §13 demands for adopting it was never written. That is the thing to
resolve, not a preference about project counts.

### Decision

**One Vercel project. The SPA serves `/`, and `/api/*` rewrites to the Fastify
function. Same origin.**

### Why this is the simpler *and* more portable option

**It deletes a class of security configuration rather than simplifying it.**
Same-origin requests are not CORS requests. ADR 0007 exists entirely because of
cross-origin: the anchored preview regex, pinning the project segment against
`evil-orbit-web-ourscope.vercel.app`, the scope-slug env var, the negative
preflight tests. Under same-origin none of that is load-bearing. It stays in the
repo as defence in depth for any future cross-origin caller, but it stops being
the thing standing between a preview deploy and a working app.

**It removes the Related Projects dependency, which §13 already asked for.**
With same-origin, `VITE_API_BASE_URL` becomes a relative `/api` — so the env var
that Related Projects existed to populate per-preview is not needed at all.
Every preview URL works with no per-deployment wiring.

**AWS portability improves, which is the opposite of what I first assumed.**
Related Projects has no AWS equivalent — that is precisely why §13 wanted one
recorded. Same-origin does: one CloudFront distribution or ALB, static assets on
one behaviour, `/api/*` to a Lambda or container on another. That is a standard
shape rather than a platform feature to be emulated.

### Costs, stated plainly

- **Coupled deploys.** Frontend and backend ship together. For an MVP with four
  people this is arguably a feature — it removes the version-skew window where a
  deployed client talks to an older API.
- **A rewrite rule to maintain** in `vercel.json` instead of two project
  configurations. Net less config, but it is a new thing to get right.
- **Ghansham's Fastify app is unchanged.** It does not know it is behind a
  rewrite. No code change, which is the main reason this is cheap now and
  expensive later.

### The thing that must be verified before this is Accepted

**Whether Vercel routes `/api/*` to a Fastify function inside the same project
as a Vite SPA is unverified.** Vercel documents running multiple applications in
one project, but I have not confirmed it for this specific combination, and I am
not going to assert it from documentation after being wrong about
`ALTER ROLE` earlier today.

This also finally exercises the risk ADR 0006 flagged and nobody has closed:
whether Vercel can bundle `@orbit/contracts` consumed as raw `.ts` source. If it
cannot, that forces a build step regardless of topology.

**So the order is: prove it on a throwaway project, then decide.** If the rewrite
does not work cleanly, two projects with the ADR 0007 machinery is the fallback
and this ADR is rejected rather than forced.

### Research update 2026-09-23 — the mechanism has a name, and a defect in our code

Reading the documentation does not replace deploying it, so this stays Proposed.
But the mechanism is no longer unknown, and looking it up surfaced a bug in our
own app that would have been found the hard way.

**The feature is [Vercel Services](https://vercel.com/kb/guide/vercel-services).**
It is exactly the topology §1 proposes: several independently built applications
in one project, one domain, each built with its own framework and build step,
with public traffic routed by top-level `rewrites` in `vercel.json`. A service is
internal unless a rewrite targets it. The documented example is a JavaScript
frontend at `/` and a backend at `/api`.

**Fastify is a first-class target.**
[Vercel's Fastify guide](https://examples.vercel.com/docs/frameworks/backend/fastify)
says a Fastify app deploys with zero configuration as a single Vercel Function on
Fluid compute, provided the entrypoint is one of `src/app`, `src/index`,
`src/server`, `app`, `index`, or `server`. Ours is `services/api/src/app.ts`, so
with the service `root` set to `services/api` the entrypoint is `src/app.ts` and
already matches. That is luck rather than design — `build.ts` carries a comment
saying `src/app.ts` is the Vercel entrypoint, so someone checked at least once.

#### The defect this turned up: `/health` would silently report a dead API as healthy

Vercel Services forwards the **original path** to the service. `GET /api/users`
arrives as `/api/users`, not `/users` — the matched prefix is not stripped. For us
that is good news for most routes: `build.ts` registers everything behind
`{ prefix: '/api' }`, so a `/api/(.*)` rewrite lines up exactly.

But `/health` is registered at the **root**, outside that prefix:

```ts
// The only unauthenticated route.
app.get('/health', async () => HealthResponseSchema.parse({ status: 'ok' }));

await app.register(async (api) => { /* /me and the six modules */ },
  { prefix: '/api' });
```

With `/api/(.*)` → backend and a catch-all `/(.*)` → frontend, `/health` matches
the catch-all and is served by the **SPA**, which answers `200` with
`index.html` for unknown paths. So a health check against `/health` would get a
`200` and conclude the API is up while the API is completely down. A monitoring
endpoint that cannot report failure is worse than no monitoring endpoint, and
this would not have shown up in any test we have — it only appears once the
rewrite is in front of it.

**Fix, and it should land before any Vercel project is created:** expose the
health route at `/api/health` so one rewrite pattern covers the whole API and
there is no special case to forget. It must stay **unauthenticated**, so it
cannot simply move inside the existing `register` block — that block applies
`requireAuth`. It needs registering at the top level with the full path:

```ts
app.get('/api/health', async () => HealthResponseSchema.parse({ status: 'ok' }));
```

Whether `/health` is kept as an alias for local use is a detail; the deployed
check must target the path that actually reaches the API. This is a small change
in Ghansham's lane and I have not made it here — this ADR is not the place for a
code change.

#### Two caveats that go on the record

1. **Vercel Services is in Beta** (all plans). Building the deployment topology
   on a Beta feature days before a deadline is a real risk, and it partly
   re-opens the ARCHITECTURE.md §13 objection that prompted this ADR: Services
   is as Vercel-proprietary as Related Projects.

   The portability argument in §1 survives, but needs stating more precisely
   than I first did. What is portable is the **topology** — one origin, the API
   under an `/api` path prefix — which maps onto a single CloudFront
   distribution with two behaviours, or one ALB with two target groups. What is
   *not* portable is the mechanism, and I should not have implied otherwise.
   The distinction still favours same-origin: Related Projects injects an env
   var across project boundaries and has no AWS analogue at all, whereas a path
   prefix is the most ordinary routing arrangement there is. But "more
   portable" refers to the shape, not the configuration.

2. **Configuration moves into the service.** When `vercel.json` has a `services`
   key, top-level `buildCommand`, `installCommand`, `outputDirectory`,
   `framework` and `functions` are no longer valid and must move into the
   relevant service. The Vercel project configs added in PR #23 predate this
   and will need rewriting rather than extending. Also: the project's framework
   setting must be `Services` *and* `vercel.json` must contain `services`, or
   Vercel silently falls back to normal detection and ignores the whole block.

#### What is still genuinely unproven

- That a **Vite SPA** works as a Services frontend. The docs say "JavaScript
  frontends" and Vite is a supported Vercel framework, but the combination is
  not something I have seen confirmed.
- Whether Vercel bundles `@orbit/contracts` consumed as raw `.ts`. The ADR 0006
  risk is untouched by any of this. If it fails, a `dist/` build step is forced
  regardless of topology.
- That our Fastify entrypoint works unmodified. `app.ts` calls
  `await app.listen({ port: config.port })` at the top level. Vercel's Fastify
  support is documented as zero-config, which implies it handles a listening
  server, but "implies" is not "verified".

**The order is unchanged: prove it on a throwaway project, then accept or reject
this ADR.** What has changed is that the throwaway project now has a specific
configuration to try rather than an open question, and we know one of our own
routes is mis-placed for it.

## 2. How demo credentials reach a non-technical user — Accepted

Orbit has no signup UI by design. Accounts are provisioned, the user set is small
and fixed, and the data is a fictional company. That makes this simpler than it
looks, but it needs writing down, because "unspecified" is how someone ends up
emailing a password to be helpful.

**Decision: credentials are handed over out of band — verbally or through a
channel the recipient already trusts — and never written into the repository, a
pull request, an issue, a chat log, or a ticket.**

Specifics:

- **One account per role**, provisioned by whoever seeds the database, plus the
  isolation-test accounts. No shared logins between roles; role separation is
  the product's central claim and a shared login would void the demo.
- **Passwords are generated, not chosen.** Cryptographic RNG, alphanumeric so
  they survive a connection string or a URL without escaping.
- **A Postgres role password cannot be read back after it is set.** So whoever
  sets it is the only one who has it, and that is a deliberate constraint rather
  than an inconvenience: it forces a single explicit handover instead of a value
  sitting in several places.
- **Rotation is not scheduled.** Private repository, four people, credentials
  stay inside the team. Rotating working credentials on a cadence costs more in
  broken local environments than it buys. Rotation happens on a *trigger* —
  someone leaves, a value is exposed, or a demo audience changes — not on a
  calendar.
- **The one open exposure is separate from all of this.** The leaked
  `service_role` key from the old repository was exposed outside the team before
  this project began. Closing it is a one-time remediation, not credential
  hygiene, and it stays open in ADR 0001.

### What this deliberately does not build

No credential vault, no secrets manager, no automated provisioning. For a fixed
set of demo accounts on a fictional dataset, that machinery would cost more than
the risk it removes. If Orbit ever holds real records, this decision is void and
the question is reopened from scratch — that is the trigger, and it is recorded
here so the reasoning does not get inherited into a context it was never valid
for.
