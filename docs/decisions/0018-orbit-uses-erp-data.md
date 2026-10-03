# ADR 0018: Orbit's leadership workspace uses the hospital operations (ERP) data

- **Status:** Accepted by the product owner on 2026-10-03, who chose to decide this directly instead of routing it through the named reviewers (a user instruction overriding the review rule in AGENTS.md). Built, applied to the dev Supabase project and verified. The role allow-list in §2 is decided, not proposed. **Ghansham** owns the code.
- **Author:** Ghansham
- **Date opened:** 2026-10-02
- **Builds on:** [ADR 0016](0016-erp-module-and-operator-roles.md) (ERP and operator roles), [ADR 0017](0017-live-hospital-simulator.md) (the simulator that keeps the ERP data live), ADR 0011 §6 (the bounded security-definer precedent).

## Context

The product owner wants the ERP hosted separately from Orbit, with **one API connecting both**, so that Orbit's leadership workspace uses what the ERP records. Leaders (chairman, regional COO, hospital DHO and others) should see how their hospitals are actually running, from the same data the hospital staff work in.

Two facts shape the answer:

1. The ERP tables are readable only by ERP operators (ADR 0016). A leader's claims match no ERP row, by design.
2. The workbook KPIs describe full-size hospitals (hundreds of beds, paid FTEs, money). The ERP is a small working hospital (about fifty staff). The scales do not match.

## Decisions

### §1 Aggregates through two bounded functions, not table access

`orbit_erp.ops_snapshot()` (right now) and `orbit_erp.ops_daily(days)` (finished days) return **counts and timestamps only**. They are `security definer`, call `ops_visible_facilities()`, and enforce the caller's scope themselves: claims present, a workbook role (an operator gets nothing), the caller's own organization, and `orbit.scope_within_caller('facility', id)`. Group scope sees every hospital, a region its hospitals, a facility its own, and a COE-only scope none. No name, code or id of a person, patient or visit leaves them. No table, policy or table grant changed. This is the same narrow pattern as `orbit.permitted_assignees()`; it is not a security-definer view (ARCHITECTURE §7.2).

### §2 Two gates

1. **API:** a role allow-list in `@orbit/contracts` (`OPERATIONS_FEED_ROLES`: chairman, clinical director, regional COO, hospital DHO, people executive, HR head). A role outside it gets an explicit **403**, never an empty page that looks complete.
2. **Database:** the scope check inside the functions.

The route also re-checks that every hospital returned has a name visible to the caller; one that does not fails the request closed. The allow-list is decided (2026-10-03): the roles that run hospitals, care or people. Finance, legal, procurement, analytics, commercial and COE roles are out, because their workbook remit does not include hospital staffing or activity.

### §3 The KPI scorecard is not overwritten

ERP data is **not** written into the workbook KPI observations. The scale mismatch would make every scorecard number wrong, and the observation model carries targets, definitions and reconciliation that ERP counts do not have. Operations is a **separate surface** ("Hospital operations") beside the scorecard, labelled illustrative and simulated, with a limitation stating that the two are not comparable. Deriving workbook KPIs from ERP data would need the ERP to model the workbook's scale and definitions first; that is a separate decision.

### §4 Every rate shows its counts

Rates are computed from counts over **finished** shifts (rostered minus in progress). No finished shifts is `not_applicable / zero_denominator`, never zero. Roll-ups sum counts and never average percentages. A missing punch is reported as missing. Freshness comes from the hospital's last recorded activity (current within 2 hours, late within 24, otherwise stale); reconciliation is `not_applicable`.

### §5 Topology: one shared API, two web apps

| Project | Root directory | Surface |
|---|---|---|
| `orbit-web` | `apps/web` | `leader` (or unset) |
| `orbit-erp-web` | `apps/web` | `erp` |
| `orbit-api` | `services/api` | `all`, `ORBIT_LIVE_SOURCES` includes `erp` |

The shared API serves both kinds of account (`ORBIT_SURFACE` unset or `all`); the role and scope still come from the verified membership, so sharing the API does not blend the two. `ALLOWED_ORIGINS` lists both web origins. The earlier four-project option (ADR 0016 §9, a separate ERP API) stays available and is the stronger isolation; this ADR chooses the single API because the product owner asked for one connecting API. Both pairs still read **one Supabase project and one database role**.

### §6 The simulator feeds it

The simulator (ADR 0017) writes through the ERP API, so what leaders see reflects live activity with no seeds. If the simulator is stopped the page shows stale data and says so.

## Verification (2026-10-02, locally)

- SQL authorization cases against a scratch database: chairman sees 6 hospitals, each regional COO 3, a DHO 1; a COE-only scope, an ERP operator, another organization and no claims see none; a leader reading the ERP tables directly gets 0 rows; a range of 0 or 61 days is refused.
- Contract tests; API route tests (sums, rates over finished shifts, zero denominator, freshness, empty scope, 403 for a role outside the list, out-of-scope row fails closed, contract failure fails closed, bad range, unavailable source, audit).
- Web tests: the page, navigation visible only to allowed roles, 403 state.

**Also verified:** the migration applied to the dev Supabase project, and `ops_snapshot()` there returned all six hospitals for a chairman.

**Not verified:** the deployed API and CORS, a real browser run against live data, behaviour at larger hospital counts.

## Decided (2026-10-03, product owner)

- The role allow-list and the shared-API topology, as above.
- No dedicated database role for the ERP yet. Both halves share `orbit_app`; the ERP tables stay behind forced row-level security and leaders reach them only through the two bounded functions. Revisit before any real (non-synthetic) data is loaded.
- Workbook KPIs are not derived from ERP data. Revisit only if the ERP is ever modelled at the workbook's scale.
