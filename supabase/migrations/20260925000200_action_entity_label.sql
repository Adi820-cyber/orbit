-- ============================================================================
-- 20260925000200_action_entity_label.sql
--
-- The name of the entity an action is about, as the creator saw it when they
-- raised it. An assignee is often scoped below that entity (a hospital DHO on
-- a regional action) and cannot read the region row, so without this the
-- action page showed a raw id. Like the evidence snapshot, it is fixed at
-- creation. Exposes nothing new: the assignee already knows the action's
-- entity id, and only its display name is added.
-- ============================================================================

alter table orbit.actions add column entity_label text;

update orbit.actions a
set entity_label = coalesce(
  (select o.name from orbit.organizations o where a.entity_grain = 'group' and o.id = a.entity_id),
  (select r.name from orbit.regions r where a.entity_grain = 'region' and r.id = a.entity_id),
  (select f.name from orbit.facilities f where a.entity_grain = 'facility' and f.id = a.entity_id),
  (select c.name from orbit.coes c where a.entity_grain = 'coe' and c.id = a.entity_id)
)
where a.entity_label is null;

alter table orbit.actions add constraint actions_entity_label_length
  check (entity_label is null or char_length(entity_label) between 1 and 200);
