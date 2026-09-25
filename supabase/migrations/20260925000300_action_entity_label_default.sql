-- ============================================================================
-- 20260925000300_action_entity_label_default.sql
--
-- Fills actions.entity_label from the organization tables whenever an insert
-- does not supply it (20260925000200 left it to the API). Found on the
-- deployed demo: an action created by an older API build had no label, so its
-- assignee saw a raw region id. The API still sends the label it resolved; the
-- trigger is the fallback, and the backfill repairs rows written meanwhile.
--
-- Security definer because the name must come from the entity the action is
-- about, which the inserting creator can already see; it reads names only,
-- scoped to the row's own organization, and returns nothing else.
-- ============================================================================

create or replace function orbit.action_entity_label(p_org uuid, p_grain text, p_entity uuid)
  returns text
  language sql
  stable
  security definer
  set search_path = pg_catalog, public
as $$
  select case p_grain
    when 'group' then (select o.name from orbit.organizations o where o.id = p_entity and o.id = p_org)
    when 'region' then (select r.name from orbit.regions r where r.id = p_entity and r.organization_id = p_org)
    when 'facility' then (select f.name from orbit.facilities f where f.id = p_entity and f.organization_id = p_org)
    when 'coe' then (select c.name from orbit.coes c where c.id = p_entity and c.organization_id = p_org)
  end
$$;

revoke all on function orbit.action_entity_label(uuid, text, uuid) from public;

create or replace function orbit.fill_action_entity_label()
  returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog, public
as $$
begin
  if new.entity_label is null then
    new.entity_label := orbit.action_entity_label(new.organization_id, new.entity_grain, new.entity_id);
  end if;
  return new;
end;
$$;

revoke all on function orbit.fill_action_entity_label() from public;

create trigger actions_fill_entity_label
  before insert on orbit.actions
  for each row execute function orbit.fill_action_entity_label();

update orbit.actions a
set entity_label = orbit.action_entity_label(a.organization_id, a.entity_grain, a.entity_id)
where a.entity_label is null;
