-- ============================================================================
-- 20260925000100_action_review_and_delegation.sql
--
-- Action workflow v2 (services/api/TRANSITIONS.md, PROPOSED for Aditya's
-- sign-off), requested by the product owner after the v1 flow let an assignee
-- close work with no approval and gave them no way to hand it on:
--
-- 1. A `submitted` state: the assignee submits finished work, and the creator
--    approves it (-> completed) or sends it back (-> in_progress).
-- 2. Delegation: the assignee may hand part of the work to someone inside
--    their own scope as a linked sub-action (`parent_action_id`). The child
--    carries the parent's fixed evidence snapshot; its assignee still comes
--    from orbit.permitted_assignees() under the delegator's claims, so
--    delegation only ever goes downward (ADR 0011 §6).
-- 3. `action_events.actor_role`, so the action's history can say who did what
--    without exposing membership ids.
--
-- Additive: no policy or grant changes. Existing rows stay valid.
-- ============================================================================

alter table orbit.actions drop constraint actions_state_known;
alter table orbit.actions add constraint actions_state_known
  check (state in ('open', 'acknowledged', 'in_progress', 'submitted', 'completed', 'cancelled'));

alter table orbit.actions
  add column parent_action_id uuid references orbit.actions (id) on delete restrict;

alter table orbit.actions add constraint actions_not_own_parent check (parent_action_id is null or parent_action_id <> id);

create index actions_parent_idx on orbit.actions (parent_action_id) where parent_action_id is not null;

comment on column orbit.actions.parent_action_id is
  'Set when the assignee of the parent delegated part of it. Visibility is '
  'still creator-or-assignee of this row only; the parent''s creator does not '
  'gain access to the child.';

alter table orbit.action_events add column actor_role text references orbit.role_ids (role_id);

update orbit.action_events e
set actor_role = m.role_id
from orbit.org_memberships m
where m.id = e.actor_membership_id and e.actor_role is null;

alter table orbit.action_events alter column actor_role set default orbit.current_role_id();
alter table orbit.action_events alter column actor_role set not null;

-- The insert policy already pins the actor to the caller; pin the role too.
drop policy action_events_insert_as_self on orbit.action_events;
create policy action_events_insert_as_self
  on orbit.action_events for insert to orbit_app
  with check (
    organization_id = orbit.current_org()
    and actor_membership_id = orbit.current_membership_id()
    and actor_role = orbit.current_role_id()
    and exists (select 1 from orbit.actions a where a.id = action_events.action_id)
  );
