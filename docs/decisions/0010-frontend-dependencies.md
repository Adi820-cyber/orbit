# ADR 0010: frontend and UI-kit dependencies

- **Status:** Proposed — the dependency families are already approved in `ARCHITECTURE.md` §§3, 5, and 15; this record pins the adopted surface for review.
- **Owner:** Ayas (frontend and UI kit)
- **Reviewer:** Aditya (dependency approval per `RULES.md`)
- **Date opened:** 2026-09-23

## Context

The first frontend slice needs a React SPA, provisioned-account Supabase sign-in,
shared design tokens and primitives, route handling, unit tests, and responsive
browser/accessibility checks. The repository already selects these technology
families in `ARCHITECTURE.md`; this ADR records the exact packages used rather
than introducing a new framework or product boundary.

## Decision

Adopt the following runtime dependencies in `apps/web`:

| Package | Version | Purpose and adopted surface |
|---|---:|---|
| `react`, `react-dom` | ^19.3.0 | Render the client-only SPA with standard React components and DOM mounting. |
| `react-router` | ^7.18.4 | Data-mode route objects, redirects, navigation state, and form submission state. No framework mode or SSR. |
| `@supabase/supabase-js` | ^2.117.0 | Browser authentication only: create a public-key client, restore sessions, and call `signInWithPassword`. It is not used for direct business-data access. |
| `@orbit/ui-kit` | workspace ^0.0.0 | Consume repository-owned tokens and primitives without duplicating them in the app. |

Adopt the following development dependencies:

| Package | Version | Purpose and adopted surface |
|---|---:|---|
| `vite`, `@vitejs/plugin-react` | ^8.3.0, ^6.1.1 | Build and serve the static React SPA. |
| `typescript` | ^7.0.2 | Use the same compiler major as every contract-owning workspace, as required by ADR 0006. No compiler API is consumed. |
| `vitest` | ^5.0.1 | Feature-level unit and contract tests. |
| `@playwright/test`, `@axe-core/playwright` | ^1.63.0, ^4.13.0 | Responsive browser, keyboard, and automated accessibility smoke checks. Axe supplements manual keyboard review. |
| `@types/react`, `@types/react-dom` | ^19.3.0 | Type declarations matching the selected React major. |

`packages/ui-kit` exposes React as a peer dependency so consuming applications
own the single React runtime. Its only development dependencies are the matching
React types and TypeScript ^7.0.2.

## Alternatives considered

- **No router:** rejected because guarded routes, redirects, loading state, and
  future role surfaces would otherwise become an application-specific routing
  layer. React Router 7 is already selected in the architecture.
- **Direct Supabase database reads from the browser:** rejected. The browser uses
  Supabase only for authentication; business data must pass through the API's
  authorization and RLS boundary.
- **A styled component library or broad state library:** rejected for this slice.
  Native HTML, CSS tokens, React state, and router data APIs cover the approved
  login behavior with less bundle and governance surface.
- **A second TypeScript major:** rejected because separate compilers could accept
  different interpretations of shared `@orbit/contracts` types while individual
  workspace checks still appear green.
- **Accessibility checks without Playwright/axe:** rejected because unit tests do
  not detect viewport overflow, browser focus order, or DOM-level axe findings.

## Impact

- **Security:** only the Supabase URL and publishable key may enter `VITE_*`.
  Database credentials, service-role keys, model keys, and authorization logic
  remain server-side. Authentication establishes a session but does not grant a
  role or business-data scope in the browser.
- **Bundle/runtime:** React, React Router, and the Supabase browser client enter
  the web bundle. Vitest, Playwright, axe, TypeScript, and Vite are development
  tooling and do not ship as application runtime modules. The UI kit adds source
  CSS and React primitives but no second React copy.
- **Accessibility:** semantic controls and visible focus styling remain the
  implementation baseline. Playwright checks 390 px, 768 px, and desktop layouts;
  axe is automated coverage, not proof of full accessibility.
- **Operational weight:** no server process, cache, ORM, state service, or local
  container requirement is added. Vite produces static assets for the selected
  Vercel web project.
- **AWS portability:** the output is a static SPA. The dependencies do not bind
  business logic to Vercel and can be served from S3/CloudFront or another static
  host. Supabase auth remains behind the frontend auth helper boundary.

## Compatibility evidence

- `ARCHITECTURE.md` selects React 19, Vite, React Router 7, Supabase Auth,
  Vitest, Playwright, and axe for this frontend.
- React Router's documented data APIs match the adopted route-object usage.
- Supabase documents `signInWithPassword` for password authentication and Vite
  documents that `VITE_*` variables are public bundle inputs.
- Microsoft released TypeScript 7.0 as the stable native compiler; this code uses
  only the `tsc` CLI, not the programmatic compiler API that is deferred to 7.1.

## Acceptance test

Before this record is accepted and the frontend branch merges:

- `npm run typecheck`, `npm test`, `npm run lint`, and `npm run build` pass at the
  repository root with TypeScript ^7.0.2 resolved for all typed workspaces.
- `npm run test:e2e --workspace @orbit/web` passes at 390 px, 768 px, and desktop
  widths, including keyboard validation and axe checks.
- A dependency/secret scan confirms that no server credential or private source
  material is present in the frontend changes.

## Known limits

- Live Supabase sign-in remains unverified until approved development-project
  values are provided through environment variables.
- Automated axe checks do not replace the required manual keyboard review.
