# ADR 0015: Adding data from the dashboards

- **Status:** Proposed. Nothing is built. This changes release-one scope (PRD §5.2), so the scope question in §1 is **Aditya's** call. The design in §3–§6, if §1 is accepted, needs **Maruti** (schema, RLS), **Ayas** (the 14 dashboards), and **Ghansham** (API, contracts).
- **Author:** Ghansham
- **Owners:** Aditya (scope, write entitlements), Maruti (tables, RLS), Ayas (forms), Ghansham (API, contracts)
- **Date opened:** 2026-09-24
- **Date resolved:** _(fill in when Accepted or Rejected)_

## Context

The request is that each role's dashboard can **add new data**, with a form in every dashboard and a backend to store it. Today Orbit is read-only for data: every number comes from Maruti's deterministic synthetic generator (PRD §8). The only thing a user can write is an internal action (PRD FR-06).

Four existing decisions stand in the way, and this ADR exists so they are changed deliberately rather than worked around:

1. **PRD §5.2 excludes it.** Release one does not include "real patient, employee, payer, or client operational data" or "a system-of-record replacement". A form that stores KPI values makes Orbit the place data is entered.
2. **Every number is illustrative (PRD §8.4).** `ProvenanceSchema` is `z.literal('illustrative')`, and `DataQualitySchema.state` is always `illustrative`. A typed-in value is not synthetic. Storing it under that label would mislabel it; storing it under a new label changes the contracts every surface renders.
3. **The dataset is reproducible and reconciled (PRD §8.2, §8.4).** Same seed, same snapshot, same checksum, and roll-ups that reconcile. A hand-entered facility value that the region total does not include breaks reconciliation silently.
4. **Nobody may write data yet.** Entitlements (ADR 0005, ADR 0011) say what each role may **read**. Which role may enter which KPI, for which entity, was never decided. RULES.md forbids inventing it.

## 1. The scope decision (Aditya)

| Option | What gets added | Scope change | Recommendation |
|---|---|---|---|
| **A. Do not add data entry in v1** | Nothing | None | Acceptable; keeps the release as specified |
| **B. Context notes only** | Written notes attached to a KPI observation or exception, e.g. "two wards closed for maintenance" | Small: new write surface, no numbers | **Recommended for v1** |
| **C. Manual KPI values, clearly separated** | Numeric entries stored apart from the synthetic dataset, labelled as manual, never folded into roll-ups | Large: new provenance, contract changes across every number surface | Only with a named reason and a pilot owner |
| **D. Manual values that replace generated ones** | Entered values feed the brief, explorer, and Ask like generated data | Makes Orbit a system of record | **Reject** for v1: contradicts PRD §5.2 and §8 |

Why B: it gives each role a way to add what the data cannot show (context, explanations, local knowledge), which is the gap a leader feels when a figure looks wrong. It changes no number, no roll-up, no checksum, and no existing contract. Ask can later cite notes as "user-provided context", clearly separated from observed evidence.

## 2. Rules that apply whichever option is chosen

- **Authorization first.** A write is allowed only where the role can already **read** the same assignment at the same grain and entity (the existing scope check). Writing never widens what a role can see.
- **Server-side identity.** The author, role, and organization come from the verified token and membership, never from the form.
- **Append-only history.** An entry is never edited in place. A correction is a new entry that supersedes the old one, and both stay in the audit trail (PRD FR-07).
- **Idempotent and conflict-safe.** Creates take an idempotency key; supersessions take the expected version, as actions already do.
- **Visibly labelled.** Anything a person entered is shown as entered by a role on a date, never styled like generated data.
- **No personal data.** Free text is length-limited, and the form says not to enter patient or employee identity (PRD §5.2). This is a warning, not a guarantee, so notes are readable only inside the author's own scope.

## 3. Design for option B (context notes), if accepted

### Data (Maruti)

- `orbit.kpi_notes`: `id`, `organization_id`, `assignment_id`, `grain`, `entity_id`, `period_start`, `period_end`, optional `observation_id` or `exception_id`, `body` (≤ 1,000 characters), `author_membership_id`, `author_role`, `supersedes_id`, `version`, `idempotency_key`, `created_at`.
- RLS, following ADR 0002, 0011 and the existing policies:
  - **Read:** same organization, and the entity is inside the caller's scope.
  - **Insert:** the same check plus `author_membership_id = current_membership_id()`.
  - **No UPDATE or DELETE grant** to anyone.
- pgTAP allow and deny tests for COO North and COO South, a Hospital DHO, the Chairman, and the second organization.

### Contracts (Ghansham, reviewed by Ayas)

Additive only; no existing shape changes.

- `KpiNoteSchema`, `CreateKpiNoteRequestSchema` (idempotency key, target, period, body, optional `supersedes` with `expectedVersion`), and `KpiNoteListResponseSchema`.
- A note carries `authorRole` and `createdAt`, never a subject or membership id, like actions.

### API (Ghansham)

- `GET /api/notes?assignmentId&grain&entityId&from&to` and `POST /api/notes`.
- Both go through the existing `assertInScope`, so out-of-scope requests get `403 out_of_scope`.
- The write and its `audit_events` row commit in one transaction.
- A `notes` source in `ORBIT_LIVE_SOURCES`, fail-closed until the table exists.

### Dashboards (Ayas)

- One shared "Add context" panel in `packages/ui-kit` or `features/workspace`, reused by all 14 role views. Not 14 separate forms.
- Placed on the KPI explorer detail and on each exception in the brief and inbox, where the question "why is this number like this?" arises.
- Shows existing notes with author role and date; a note's history is visible after supersession.
- Accessible by the same rules as every surface: labelled field, keyboard submit, error states.

## 4. Additional design for option C (manual values), only if chosen

On top of §2 and §3:

- A new provenance value, e.g. `manual`, added to `ProvenanceSchema`. Every number surface must render it distinctly. **Contract change across the whole UI.**
- Values stored in a separate `orbit.manual_observations` table, never written to generated tables and never included in roll-ups, reconciliation, or the dataset checksum.
- A **write entitlement column** per role and assignment, decided by Aditya like ADR 0011. Default: none.
- Unit and dimension validation from the KPI definition, and explicit handling of missing versus zero (PRD §7.9).
- Ask must not mix manual and generated values in one answer without saying so.

## 5. Delivery order, once a decision is made

1. Aditya decides §1 and, for C, the write entitlements.
2. Maruti: migration, RLS, pgTAP.
3. Ghansham: contracts PR (Ayas reviews), then the API behind `ORBIT_LIVE_SOURCES`.
4. Ayas: the shared panel, then placement across the 14 dashboards, working against the preview fixture in parallel with step 2.
5. End-to-end check: COO North adds a note to a North facility; COO South is refused; the note appears after refresh with an audit row.

## 6. Open questions

1. Can notes be cited by Ask, and how is "user-provided context" shown apart from observed evidence?
2. Should a note be visible up the hierarchy? For example, a Hospital DHO's note seen by its Regional COO. ADR 0011 §2 does not cover this. Default: author's own scope only.
3. Retention: how long do notes live, and can an administrator remove one entered in error? Nothing else in the system allows deletion today.

## 7. What this ADR does not claim

Nothing here is built or tested. It proposes a scope decision and, conditionally, a design. The request also mentioned ranking KPIs with machine learning (XGBoost). That is out of scope here: PRD §7 forbids a model-made score until a reviewed scoring model exists, and v1 data is synthetic. A transparent, rule-based priority order is the proposed alternative, and would be its own ADR.
