-- ============================================================================
-- 20260924000700_actions_and_audit.sql
--
-- Internal actions, their event history, the audit trail, and the permitted-
-- assignee lookup (PRD FR-06, FR-07; ARCHITECTURE.md §10; ADR 0011 §6, §7).
--
-- AUTHORED BY: Ghansham, at the product owner's request, for Maruti's review
-- (supabase/ is her path, FILE_STRUCTURE.md §3). Additive only: no existing
-- table, policy, or grant is changed.
--
-- Shapes follow @orbit/contracts (ActionSchema, AuditEventSchema,
-- PermittedAssigneeSchema) and the API ports in services/api/src/modules/ports.ts.
--
-- Deliberately NOT referencing auth.users: memberships already avoid it for
-- portability (see the comment on org_memberships.subject), and every identity
-- here is a membership, which is what the verified claims carry.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Opaque assignee handles
--
-- ActionSchema and PermittedAssigneeSchema expose an `assigneeId` that must not
-- be a membership id or subject. Each membership gets one stable random handle.
-- ---------------------------------------------------------------------------
create table orbit.membership_handles (
  membership_id uuid primary key references orbit.org_memberships (id) on delete cascade,
  handle        uuid not null unique default gen_random_uuid()
);

comment on table orbit.membership_handles is
  'Opaque, stable public id per membership, used as assigneeId on the wire. '
  'Never returned together with the membership id.';

-- Every membership gets a handle, now and whenever one is created.
insert into orbit.membership_handles (membership_id)
select id from orbit.org_memberships
on conflict (membership_id) do nothing;

create or replace function orbit.ensure_membership_handle()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
begin
  insert into orbit.membership_handles (membership_id) values (new.id)
  on conflict (membership_id) do nothing;
  return new;
end;
$$;

create trigger org_memberships_ensure_handle
  after insert on orbit.org_memberships
  for each row execute function orbit.ensure_membership_handle();

alter table orbit.membership_handles enable row level security;
alter table orbit.membership_handles force row level security;
-- No policy and no grant: orbit_app never reads this table directly. It is
-- reached only through orbit.permitted_assignees() below.

-- ---------------------------------------------------------------------------
-- 2. Actions
-- ---------------------------------------------------------------------------
create table orbit.actions (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references orbit.organizations (id) on delete cascade,
  creator_membership_id  uuid not null references orbit.org_memberships (id),
  creator_role           text not null references orbit.role_ids (role_id),
  assignee_membership_id uuid not null references orbit.org_memberships (id),
  assignee_handle        uuid not null,
  assignee_role          text not null references orbit.role_ids (role_id),
  idempotency_key        uuid not null,
  title                  text not null,
  assignment_id          text not null,
  entity_grain           text not null,
  entity_id              uuid not null,
  evidence               jsonb not null,
  due_date               date not null,
  state                  text not null default 'open',
  version                integer not null default 1,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint actions_state_known
    check (state in ('open', 'acknowledged', 'in_progress', 'completed', 'cancelled')),
  constraint actions_grain_known check (entity_grain in ('group', 'region', 'facility', 'coe')),
  constraint actions_title_length check (char_length(title) between 1 and 200),
  constraint actions_version_positive check (version >= 1),
  constraint actions_not_self_assigned check (creator_membership_id <> assignee_membership_id),
  -- Retried creates return the original action (PRD FR-06).
  unique (creator_membership_id, idempotency_key)
);

create index actions_creator_idx  on orbit.actions (creator_membership_id, created_at desc);
create index actions_assignee_idx on orbit.actions (assignee_membership_id, created_at desc);

create table orbit.action_events (
  id                  uuid primary key default gen_random_uuid(),
  action_id           uuid not null references orbit.actions (id) on delete cascade,
  organization_id     uuid not null references orbit.organizations (id) on delete cascade,
  actor_membership_id uuid not null references orbit.org_memberships (id),
  from_state          text,
  to_state            text not null,
  reason              text not null,
  created_at          timestamptz not null default now()
);

create index action_events_action_idx on orbit.action_events (action_id, created_at);

-- ---------------------------------------------------------------------------
-- 3. Audit trail (append-only)
-- ---------------------------------------------------------------------------
create table orbit.audit_events (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references orbit.organizations (id) on delete cascade,
  actor_membership_id uuid not null references orbit.org_memberships (id),
  actor_role          text not null references orbit.role_ids (role_id),
  kind                text not null,
  target_type         text,
  target_id           text,
  outcome             text not null,
  request_id          text not null,
  occurred_at         timestamptz not null default now(),
  constraint audit_events_kind_known check (kind in (
    'action_created', 'action_transitioned', 'ask_answered', 'access_denied', 'evidence_viewed'
  )),
  constraint audit_events_target_pair check ((target_type is null) = (target_id is null)),
  constraint audit_events_target_type_known
    check (target_type is null or target_type in ('action', 'assignment', 'ask', 'route'))
);

create index audit_events_target_idx on orbit.audit_events (target_type, target_id, occurred_at desc);

comment on table orbit.audit_events is
  'Application-protected audit trail (PRD FR-07). INSERT and gated SELECT only; '
  'no UPDATE or DELETE grant to anyone. Not a claim of immutability.';

-- ---------------------------------------------------------------------------
-- 4. RLS: one policy per operation, keyed on the verified claims
-- ---------------------------------------------------------------------------
alter table orbit.actions       enable row level security;
alter table orbit.action_events enable row level security;
alter table orbit.audit_events  enable row level security;
alter table orbit.actions       force row level security;
alter table orbit.action_events force row level security;
alter table orbit.audit_events  force row level security;

-- An action is visible to its creator and its assignee, in their organization.
create policy actions_select_creator_or_assignee
  on orbit.actions for select to orbit_app
  using (
    organization_id = orbit.current_org()
    and orbit.current_membership_id() in (creator_membership_id, assignee_membership_id)
  );

-- Only the caller can be the creator, in their own organization and role.
create policy actions_insert_as_self
  on orbit.actions for insert to orbit_app
  with check (
    organization_id = orbit.current_org()
    and creator_membership_id = orbit.current_membership_id()
    and creator_role = orbit.current_role_id()
  );

-- State changes by the creator or assignee only. Which transition is allowed
-- is decided by the API's TransitionPolicy; the version check is in the query.
create policy actions_update_creator_or_assignee
  on orbit.actions for update to orbit_app
  using (
    organization_id = orbit.current_org()
    and orbit.current_membership_id() in (creator_membership_id, assignee_membership_id)
  )
  with check (
    organization_id = orbit.current_org()
    and orbit.current_membership_id() in (creator_membership_id, assignee_membership_id)
  );

create policy action_events_select_visible_action
  on orbit.action_events for select to orbit_app
  using (exists (select 1 from orbit.actions a where a.id = action_events.action_id));

create policy action_events_insert_as_self
  on orbit.action_events for insert to orbit_app
  with check (
    organization_id = orbit.current_org()
    and actor_membership_id = orbit.current_membership_id()
    and exists (select 1 from orbit.actions a where a.id = action_events.action_id)
  );

-- Anyone may record their own event; nobody may record one as someone else.
create policy audit_events_insert_as_self
  on orbit.audit_events for insert to orbit_app
  with check (
    organization_id = orbit.current_org()
    and actor_membership_id = orbit.current_membership_id()
    and actor_role = orbit.current_role_id()
  );

-- ADR 0011 §7: a member reads the events for actions they created or are
-- assigned, and nothing else. The subquery is itself filtered by the actions
-- select policy, so "visible action" means exactly creator-or-assignee.
create policy audit_events_select_own_actions
  on orbit.audit_events for select to orbit_app
  using (
    organization_id = orbit.current_org()
    and kind in ('action_created', 'action_transitioned')
    and target_type = 'action'
    and exists (select 1 from orbit.actions a where a.id::text = audit_events.target_id)
  );

grant select, insert, update on orbit.actions to orbit_app;
grant select, insert on orbit.action_events to orbit_app;
grant select, insert on orbit.audit_events to orbit_app;
-- Deliberately absent: DELETE on any of these, and UPDATE on action_events and
-- audit_events (append-only, PRD FR-07).

-- ---------------------------------------------------------------------------
-- 5. Permitted assignees (ADR 0011 §6)
--
-- RLS lets orbit_app read only the caller's own membership, so listing other
-- people needs elevated rights. This function is the one narrow exception,
-- written as a function rather than a view (ARCHITECTURE.md §7.2 forbids
-- security-definer views over protected tables) and bounded as follows:
--
-- - returns nothing unless membership claims are set (current_org() is null
--   otherwise);
-- - only active memberships in the caller's own organization;
-- - never the caller (no self-assignment);
-- - only people whose EVERY scope lies inside the caller's scope, using the
--   same claims helpers as the read policies: downward only, never sideways,
--   never upward;
-- - only people whose scope covers the action's entity, or lies under it, so
--   an assignee is responsible for what the action is about;
-- - returns the opaque handle, role and scopes, never a membership id or
--   subject. The API resolves a handle to a membership only by calling this
--   function again with the same target.
-- ---------------------------------------------------------------------------
create or replace function orbit.scope_within_caller(p_grain text, p_entity_id uuid)
  returns boolean
  language sql
  stable
  set search_path = pg_catalog, public
as $$
  select case p_grain
    when 'group' then orbit.has_group_scope() and p_entity_id = orbit.current_org()
    when 'region' then orbit.has_group_scope() or orbit.is_scoped_to('region', p_entity_id)
    when 'facility' then orbit.has_group_scope()
      or orbit.is_scoped_to('facility', p_entity_id)
      or exists (
        select 1 from orbit.facilities f
        where f.id = p_entity_id and orbit.is_scoped_to('region', f.region_id)
      )
    when 'coe' then orbit.has_group_scope()
      or orbit.is_scoped_to('coe', p_entity_id)
      or exists (
        select 1 from orbit.coes c
        where c.id = p_entity_id
          and (orbit.is_scoped_to('region', c.region_id) or orbit.is_scoped_to('facility', c.host_facility_id))
      )
    else false
  end
$$;

create or replace function orbit.permitted_assignees(
  p_assignment_id text,
  p_grain         text,
  p_entity_id     uuid
)
  returns table (assignee_handle uuid, membership_id uuid, role_id text, scopes jsonb)
  language sql
  stable
  security definer
  set search_path = pg_catalog, public
as $$
  with candidates as (
    select m.id, m.role_id
    from orbit.org_memberships m
    where m.organization_id = orbit.current_org()
      and m.status = 'active'
      and m.id <> orbit.current_membership_id()
      and p_assignment_id is not null
  ),
  candidate_scopes as (
    select c.id as membership_id, s.grain, s.entity_id, s.region_id, s.facility_id
    from candidates c
    join orbit.org_membership_scopes s on s.membership_id = c.id
  ),
  eligible as (
    select c.id, c.role_id
    from candidates c
    where exists (select 1 from candidate_scopes cs where cs.membership_id = c.id)
      -- every scope inside the caller's scope
      and not exists (
        select 1 from candidate_scopes cs
        where cs.membership_id = c.id and not orbit.scope_within_caller(cs.grain, cs.entity_id)
      )
      -- at least one scope covers the action's entity, or lies under it
      and exists (
        select 1 from candidate_scopes cs
        where cs.membership_id = c.id
          and (
            (cs.grain = p_grain and cs.entity_id = p_entity_id)
            or cs.grain = 'group'
            or (p_grain = 'region' and cs.grain = 'facility'
                and exists (select 1 from orbit.facilities f where f.id = cs.facility_id and f.region_id = p_entity_id))
            or (p_grain = 'facility' and cs.grain = 'region'
                and exists (select 1 from orbit.facilities f where f.id = p_entity_id and f.region_id = cs.region_id))
          )
      )
  )
  select h.handle, e.id, e.role_id,
         (select jsonb_agg(jsonb_build_object('grain', cs.grain, 'entityId', cs.entity_id::text)
                           order by cs.grain, cs.entity_id)
            from candidate_scopes cs where cs.membership_id = e.id)
  from eligible e
  join orbit.membership_handles h on h.membership_id = e.id
  where orbit.current_org() is not null
$$;

comment on function orbit.permitted_assignees(text, text, uuid) is
  'ADR 0011 §6: active members of the caller''s organization, other than the '
  'caller, whose every scope lies inside the caller''s scope and who cover the '
  'action''s entity. Security definer; empty without claims. The API returns '
  'only handle, role and scopes to clients.';

revoke all on function orbit.scope_within_caller(text, uuid) from public;
revoke all on function orbit.permitted_assignees(text, text, uuid) from public;
revoke all on function orbit.ensure_membership_handle() from public;
grant execute on function orbit.scope_within_caller(text, uuid) to orbit_app;
grant execute on function orbit.permitted_assignees(text, text, uuid) to orbit_app;
