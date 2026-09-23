-- ============================================================================
-- 20260923000600_drop_segment_grain.sql
--
-- Removes `segment` from the grains the entitlement matrix may reference.
--
-- AUTHOR: Maruti
-- IMPLEMENTS: ADR 0012 (segment is not a scope grain) and ADR 0011 §4
--             ("no row with grain segment")
--
-- WHY A NEW MIGRATION RATHER THAN AN EDIT
--   20260923000500 is already applied to the dev project and recorded in
--   supabase_migrations.schema_migrations. Editing an applied migration would
--   leave the file and the database disagreeing, and would not re-run. So the
--   constraint is replaced forward.
--
-- CONTEXT
--   `org_membership_scopes` never accepted `segment` -- its CHECK has always
--   listed only ('group','region','facility','coe'). ADR 0012 confirms that
--   rejection is "permanently correct, not a placeholder."
--
--   `entitlements` was the inconsistency: its grains/breakdowns CHECKs still
--   permitted `segment`, on the original assumption that segments would
--   eventually get an entity table. ADR 0012 settles that they will not --
--   `segment` describes a payer/insurer dimension, not a position in the
--   organizational hierarchy, so it is not a scope grain at all and
--   `ScopeEntity` is the wrong shape to carry it.
--
--   With no entity table and no hierarchy position, an entitlement row naming
--   `segment` would grant access to something unidentifiable. Rejecting it in
--   the schema means the matrix generator cannot emit such a row even by
--   mistake, rather than relying on a generator-side assertion alone.
--
-- NOT DONE HERE
--   Removing `segment` from `GrainSchema` in @orbit/contracts. ADR 0012 assigns
--   that jointly to Ghansham and me, and it belongs in a contracts PR he
--   reviews -- not folded into a migration.
-- ============================================================================

-- Both constraints are replaced rather than altered: PostgreSQL has no
-- ALTER CONSTRAINT for a CHECK expression.

alter table orbit.entitlements
  drop constraint if exists entitlements_grains_valid;

alter table orbit.entitlements
  add constraint entitlements_grains_valid
  check (grains <@ array['group', 'region', 'facility', 'coe']::text[]);

alter table orbit.entitlements
  drop constraint if exists entitlements_breakdowns_valid;

alter table orbit.entitlements
  add constraint entitlements_breakdowns_valid
  check (breakdowns <@ array['group', 'region', 'facility', 'coe']::text[]);

comment on constraint entitlements_grains_valid on orbit.entitlements is
  'Grains a role may read an assignment at. Excludes `segment`: it is a '
  'payer/insurer dimension, not an organizational grain, and has no entity '
  'table (ADR 0012).';

comment on constraint entitlements_breakdowns_valid on orbit.entitlements is
  'Grains a role may decompose an assignment by. Excludes `segment` for the '
  'same reason as entitlements_grains_valid (ADR 0012).';

-- Supersede the table comment written by 20260923000500, which said `segment`
-- was "rejected until segments exist". ADR 0012 establishes that it is not a
-- scope grain at all, so the rejection is permanent rather than provisional.
--
-- 000500's inline `--` comments still carry the older reasoning. They are left
-- as written: it is already applied, and editing an applied migration to
-- restate history makes the file disagree with what actually ran. This
-- migration is the authoritative statement.
comment on table orbit.org_membership_scopes is
  'Entities a membership is scoped to. Typed FK per grain so a scope cannot '
  'name a nonexistent entity. Grain `segment` is rejected permanently -- it is '
  'a payer/insurer dimension, not an organizational grain (ADR 0012).';
