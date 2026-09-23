# ADR 0007: CORS policy and preview-origin allowlisting

- **Status:** Accepted as policy. The concrete slug values cannot be filled in until the Vercel projects exist, and the behaviour must be tested rather than assumed — see §7.
- **Owner:** Aditya (ARCHITECTURE.md §11.3, and §17 item 4, "Domains, regions, Vercel/Supabase plan tiers, preview wildcard policy — Aditya")
- **Reviewer:** Ghansham (implements it in `services/api`)
- **Date:** 2026-09-23
- **Answers:** Ghansham's question on PR #7 — exact origins only, or a wildcard pattern for Vercel previews?

## Decision

**Exact origins for production. For previews, an anchored pattern bound to our
own Vercel scope — never a bare `*.vercel.app` wildcard.**

## 1. Why not `https://*.vercel.app`

Because anyone can deploy to `vercel.app`. That wildcard does not mean "our
previews"; it means every Vercel deployment on the internet, including an
attacker's, is granted cross-origin access to the Orbit API. Given the API
carries `Authorization: Bearer` tokens and is the only path to business data,
that is a straightforward way to hand a third-party page a working
cross-origin channel to our endpoints.

This is the kind of wildcard that looks like a scoping rule and is actually
the absence of one.

## 2. The pattern to use instead

Vercel's generated hostnames all end with our scope slug:

- `<project>-<hash>-<scope>.vercel.app` — per-deployment URL
- `<project>-git-<branch>-<scope>.vercel.app` — per-branch URL
- `<project>-<scope>.vercel.app` — production alias

So the allowlist test is an **anchored** match on our own project and scope,
not on `vercel.app`.

Three properties are mandatory, and each prevents a specific bypass:

- **Anchor the start (`^`)**, or `https://evil-orbit-web-ourscope.vercel.app`
  matches by prefix.
- **Anchor the end (`$`)**, or
  `https://orbit-web-ourscope.vercel.app.attacker.com` matches by suffix. This
  is the most commonly shipped CORS bug of the three.
- **Escape the dots.** An unescaped `.` matches any character, so
  `vercel.app` written naively also matches `vercelxapp`.

### The project segment must be matched exactly, not wildcarded

An earlier draft of this ADR described the pattern as "bound to our project and
scope" while making only the **scope slug** configurable. That was a real
defect, and it would have produced exactly the bypass §2 claims to prevent:

A pattern anchored on the scope alone — `^https://.*-ourscope\.vercel\.app$` —
matches `https://evil-orbit-web-ourscope.vercel.app`. Anchoring `^` does not
help, because the wildcard sits *inside* the anchors and swallows the project
segment. It would also match any other project in the same scope, which is a
smaller problem but still not what was intended.

So the project segment is not a wildcard:

- **The approved project slugs are reviewed source constants**, not env input.
  There are exactly two (`web` and `api` projects), and they are known at review
  time.
- The only wildcarded segment is the deployment-unique part Vercel generates —
  the hash or branch slug — and it must be constrained to the characters Vercel
  actually produces there, not `.*`.
- Concretely the shape is
  `^https://<approved-project>-<constrained-unique>-<scope>\.vercel\.app$`,
  with `<approved-project>` an exact alternation over the reviewed constants and
  `<constrained-unique>` a bounded character class, never `.*`.

Deriving the whole host from a single slug is what created the hole. The lesson
is narrower than "anchor your regex": **every segment an attacker can influence
must be either exact or character-constrained.**

## 3. The regex lives in code, not in an environment variable

**`ALLOWED_ORIGINS` holds exact origin strings only. The preview pattern is
constructed in reviewed source, parameterised only by the scope slug, with the
project segment pinned to reviewed constants per the section above.**

The reason is blast radius. If the whole pattern were an env var, a typo or a
careless edit in a Vercel dashboard field could silently widen CORS to
everything, with no diff, no review, and no test failure. Keeping the pattern
structure in source means the only configurable part is the slug, and a wrong
slug fails closed — previews stop working, which is loud and harmless. A wrong
regex fails open, which is silent and not.

Shape of the implementation:

- exact-match the incoming `Origin` against the `ALLOWED_ORIGINS` list first;
- if no match, test it against the anchored preview pattern built from the
  scope slug;
- otherwise deny. Never reflect an arbitrary `Origin` back.

## 4. No credentials mode

`credentials: false`, which is what Ghansham already has.

Orbit authenticates with `Authorization: Bearer` headers, not cookies, so
credentialed CORS is not needed. This is worth stating rather than leaving
implicit: it removes the `Access-Control-Allow-Credentials` + wildcard trap
entirely, and it means a future change to cookie-based auth would be a
security-relevant decision requiring its own review, not a config tweak.

## 5. Local development

Allow `http://localhost:5173` (Vite's default) as an explicit exact origin in
development and preview configuration only. It must not appear in the
production API's `ALLOWED_ORIGINS`.

## 6. The same scoping applies to Supabase redirect URLs — and matters more there

ARCHITECTURE.md §11.3 and §17 item 4 reference Supabase's documented Vercel
preview wildcard for the auth redirect allowlist. Use it, but **scope it with
the same exactness as above** — project segment pinned, not wildcarded —
because the consequence of a loose redirect
allowlist is worse than a loose CORS policy: a redirect allowlist that matches
someone else's `vercel.app` deployment can deliver an authentication token to
that deployment. CORS misconfiguration grants access to an API that still
checks authorization on every request; redirect misconfiguration can leak the
credential itself.

So: narrow the redirect allowlist to the project-and-scope pattern, plus
localhost for development. Do not paste a bare `https://*.vercel.app/**`.

## 7. Unfilled and unverified

- **The actual project and scope slugs are unknown**, because neither Vercel
  project exists yet. The pattern cannot be finalised until Gate 0 creates
  them. Placeholders must not be guessed into config.
- **The generated URL formats above come from Vercel's documentation, not from
  observing our own deployments.** Vercel has changed these formats before. On
  the Gate 0 hello-world deploy I will record the hostnames Vercel actually
  produces and fix the pattern against those, rather than trusting the
  documented shape.
- **Denial must be tested, not assumed.** TEAM_ASSIGNMENTS.md §8.3 requires
  that a preflight from an unapproved origin fails, tested. That means an
  explicit negative test: a request from an origin that looks close to ours —
  a suffix-appended host, and a same-shaped host under a different scope —
  must be rejected. A test that only proves the allowed origin works proves
  almost nothing.
