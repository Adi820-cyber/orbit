-- ============================================================================
-- 20261006000200_erp_billing.sql
--
-- Billing in the hospital operations ERP (ADR 0022). Adds what ADR 0016 left
-- out (billing was a non-goal there; the product owner added it on
-- 2026-10-06):
--
--   1. patient_coverage  one insurance cover per patient: payer type, an
--                        optional fictional payer name, and the percentage the
--                        payer covers. Kept apart from `patients`, which holds
--                        no insurance fields by design (ERP_PLAN §5.1).
--   2. bills, bill_lines a bill per closed visit, priced from the hospital's
--                        own price list (facility_services.illustrative_tariff)
--                        at the moment it is issued. Amounts are frozen: the
--                        insurer and patient shares come from the cover then.
--   3. payments          money received against a bill, from the patient or the
--                        insurer, never more than that payer still owes.
--   4. Rules             only an admin changes a price or cancels a bill; a bill
--                        with a payment cannot be cancelled; a billed service
--                        cannot be cancelled while its bill stands.
--   5. revenue_feed()    per-hospital revenue AGGREGATES for leaders, bounded
--                        exactly like the operations feed (ADR 0018).
--   6. Knowledge         billing summaries for the Orbit Assistant, readable by
--                        finance and operations leaders.
--
-- Money is numeric(14,2) in the organization currency (INR for Kestrion,
-- 20261006000100). Every amount is illustrative: fictional patients, prices
-- derived from the reference dataset (ADR 0022 §2), no real charge.
--
-- All tables: RLS enabled and forced, policies in the per-statement form of
-- 20261001000500, grants for exactly the operations the API uses, no DELETE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Insurance cover
-- ---------------------------------------------------------------------------
create table orbit_erp.patient_coverage (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null default orbit.current_org(),
  patient_id               uuid not null,
  payer_type               text not null default 'self-pay',
  payer_name               text,
  coverage_percent         numeric(5, 2) not null default 0,
  updated_by_membership_id uuid default orbit.current_membership_id() references orbit.org_memberships (id),
  version                  integer not null default 1,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  foreign key (patient_id, organization_id) references orbit_erp.patients (id, organization_id),
  constraint coverage_payer_type_known check (payer_type in ('self-pay', 'government', 'private')),
  constraint coverage_percent_range check (coverage_percent >= 0 and coverage_percent <= 100),
  -- Self-pay covers nothing and names no payer; an insurer covers something.
  constraint coverage_self_pay_consistent check (
    (payer_type = 'self-pay') = (coverage_percent = 0)
    and (payer_type <> 'self-pay' or payer_name is null)
  ),
  constraint coverage_payer_name_length check (payer_name is null or char_length(payer_name) between 1 and 120),
  constraint coverage_version_positive check (version >= 1),
  unique (patient_id)
);

comment on table orbit_erp.patient_coverage is
  'The current insurance cover of a synthetic patient: payer type, optional fictional payer name, '
  'percentage covered. A bill copies it when issued, so later changes never alter a bill.';

-- ---------------------------------------------------------------------------
-- 2. Bills and their lines
-- ---------------------------------------------------------------------------
create sequence orbit_erp.bill_number_seq start with 100001;

create table orbit_erp.bills (
  id                         uuid primary key default gen_random_uuid(),
  organization_id            uuid not null default orbit.current_org(),
  facility_id                uuid not null,
  encounter_id               uuid not null,
  patient_id                 uuid not null,
  bill_number                text not null default ('DEMO-BILL-' || lpad(nextval('orbit_erp.bill_number_seq')::text, 6, '0')),
  status                     text not null default 'issued',
  payer_type                 text not null,
  payer_name                 text,
  coverage_percent           numeric(5, 2) not null,
  gross_amount               numeric(14, 2) not null,
  insurance_amount           numeric(14, 2) not null,
  patient_amount             numeric(14, 2) not null,
  issued_at                  timestamptz not null default now(),
  issued_by_membership_id    uuid not null default orbit.current_membership_id() references orbit.org_memberships (id),
  cancelled_at               timestamptz,
  cancelled_by_membership_id uuid references orbit.org_memberships (id),
  cancel_reason              text,
  idempotency_key            uuid not null,
  version                    integer not null default 1,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  foreign key (facility_id, organization_id) references orbit.facilities (id, organization_id),
  foreign key (encounter_id, organization_id) references orbit_erp.encounters (id, organization_id),
  foreign key (patient_id, organization_id) references orbit_erp.patients (id, organization_id),
  constraint bills_number_format check (bill_number ~ '^DEMO-BILL-[0-9]{6,9}$'),
  constraint bills_status_known check (status in ('issued', 'cancelled')),
  constraint bills_payer_type_known check (payer_type in ('self-pay', 'government', 'private')),
  constraint bills_amounts_nonnegative check (gross_amount >= 0 and insurance_amount >= 0 and patient_amount >= 0),
  constraint bills_shares_add_up check (insurance_amount + patient_amount = gross_amount),
  constraint bills_cancel_consistent check (
    (status = 'cancelled') = (cancelled_at is not null)
    and (status = 'cancelled') = (cancelled_by_membership_id is not null)
    and (status = 'cancelled') = (cancel_reason is not null)
  ),
  constraint bills_cancel_reason_length check (cancel_reason is null or char_length(cancel_reason) between 3 and 500),
  constraint bills_version_positive check (version >= 1),
  unique (organization_id, bill_number),
  unique (organization_id, idempotency_key),
  unique (id, organization_id)
);

create index bills_facility_idx on orbit_erp.bills (facility_id, issued_at desc);
create index bills_encounter_idx on orbit_erp.bills (encounter_id);

comment on table orbit_erp.bills is
  'Illustrative bills for closed visits. Amounts are fixed when issued; an admin may cancel a bill '
  'that has no payment. Not a real charge.';

create table orbit_erp.bill_lines (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null default orbit.current_org(),
  bill_id             uuid not null,
  facility_id         uuid not null,
  service_delivery_id uuid not null,
  service_id          uuid not null,
  description         text not null,
  quantity            integer not null,
  unit_price          numeric(12, 2) not null,
  line_amount         numeric(14, 2) not null,
  foreign key (bill_id, organization_id) references orbit_erp.bills (id, organization_id),
  foreign key (facility_id, organization_id) references orbit.facilities (id, organization_id),
  foreign key (service_id, organization_id) references orbit_erp.services (id, organization_id),
  foreign key (service_delivery_id) references orbit_erp.service_deliveries (id),
  constraint bill_lines_quantity_range check (quantity between 1 and 100),
  constraint bill_lines_price_nonnegative check (unit_price >= 0),
  constraint bill_lines_amount_matches check (line_amount = quantity * unit_price),
  unique (bill_id, service_delivery_id)
);

create index bill_lines_delivery_idx on orbit_erp.bill_lines (service_delivery_id);

-- ---------------------------------------------------------------------------
-- 3. Payments (append-only)
-- ---------------------------------------------------------------------------
create table orbit_erp.payments (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null default orbit.current_org(),
  bill_id                   uuid not null,
  facility_id               uuid not null,
  payer                     text not null,
  method                    text not null,
  amount                    numeric(14, 2) not null,
  received_at               timestamptz not null default now(),
  reference                 text,
  recorded_by_membership_id uuid not null default orbit.current_membership_id() references orbit.org_memberships (id),
  idempotency_key           uuid not null,
  created_at                timestamptz not null default now(),
  foreign key (bill_id, organization_id) references orbit_erp.bills (id, organization_id),
  foreign key (facility_id, organization_id) references orbit.facilities (id, organization_id),
  constraint payments_payer_known check (payer in ('patient', 'insurer')),
  constraint payments_method_known check (method in ('cash', 'card', 'upi', 'bank-transfer', 'insurance-settlement')),
  -- An insurer settles; a patient pays by cash, card, UPI or transfer.
  constraint payments_method_matches_payer check ((payer = 'insurer') = (method = 'insurance-settlement')),
  constraint payments_amount_positive check (amount > 0),
  constraint payments_reference_length check (reference is null or char_length(reference) between 1 and 60),
  unique (organization_id, idempotency_key)
);

create index payments_bill_idx on orbit_erp.payments (bill_id);
create index payments_facility_idx on orbit_erp.payments (facility_id, received_at desc);

comment on table orbit_erp.payments is
  'Illustrative money received against a bill. Append-only: no update, no delete. '
  'Never more than the payer still owes on that bill.';

-- The ERP audit trail learns the new record types.
alter table orbit_erp.audit_events drop constraint erp_audit_target_known;
alter table orbit_erp.audit_events add constraint erp_audit_target_known check (target_type in (
  'patient', 'encounter', 'service_delivery', 'staff', 'doctor', 'service',
  'facility_service', 'roster', 'punch', 'correction', 'settings',
  'coverage', 'bill', 'payment'
));

-- ---------------------------------------------------------------------------
-- 4. Rules
-- ---------------------------------------------------------------------------

-- Prices are an admin decision (ADR 0022 §3). A hospital account may still
-- switch whether a service is offered, as before. The rule binds the API's
-- role (every operator request runs as orbit_app); a seed run by the database
-- owner, with no operator claims, sets the dataset-derived prices.
create function orbit_erp.check_price_change()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
begin
  if new.illustrative_tariff is distinct from old.illustrative_tariff
     and current_user = 'orbit_app' and not orbit_erp.is_admin() then
    raise exception 'erp:price_admin_only' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger facility_services_price_admin before update on orbit_erp.facility_services
  for each row execute function orbit_erp.check_price_change();

-- A service on a standing bill cannot be cancelled: cancel the bill first.
create function orbit_erp.check_billed_delivery()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' and exists (
    select 1 from orbit_erp.bill_lines bl
    join orbit_erp.bills b on b.id = bl.bill_id
    where bl.service_delivery_id = new.id and b.status = 'issued'
  ) then
    raise exception 'erp:delivery_billed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger deliveries_billed before update on orbit_erp.service_deliveries
  for each row execute function orbit_erp.check_billed_delivery();

-- A bill's amounts never change. The only change is issued -> cancelled, and
-- only while nothing has been paid.
create function orbit_erp.check_bill_update()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
begin
  if old.status = 'cancelled' then
    raise exception 'erp:bill_cancelled' using errcode = 'P0001';
  end if;
  if (new.facility_id, new.encounter_id, new.patient_id, new.bill_number, new.payer_type, new.payer_name,
      new.coverage_percent, new.gross_amount, new.insurance_amount, new.patient_amount, new.issued_at,
      new.issued_by_membership_id, new.idempotency_key)
     is distinct from
     (old.facility_id, old.encounter_id, old.patient_id, old.bill_number, old.payer_type, old.payer_name,
      old.coverage_percent, old.gross_amount, old.insurance_amount, old.patient_amount, old.issued_at,
      old.issued_by_membership_id, old.idempotency_key) then
    raise exception 'erp:bill_immutable' using errcode = 'P0001';
  end if;
  if new.status = 'cancelled' and exists (select 1 from orbit_erp.payments p where p.bill_id = new.id) then
    raise exception 'erp:bill_has_payments' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger bills_integrity before update on orbit_erp.bills
  for each row execute function orbit_erp.check_bill_update();

-- A payment is for a standing bill at its hospital, and never more than that
-- payer still owes. Payments to one bill are serialised, so two at once cannot
-- both fit under the balance.
create function orbit_erp.check_payment()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
declare
  v_bill orbit_erp.bills%rowtype;
  v_due  numeric(14, 2);
  v_paid numeric(14, 2);
begin
  perform pg_advisory_xact_lock(hashtextextended('orbit_erp.payment:' || new.bill_id::text, 0));
  select * into v_bill from orbit_erp.bills b where b.id = new.bill_id;
  if not found or v_bill.facility_id <> new.facility_id then
    raise exception 'erp:bill_not_at_facility' using errcode = 'P0001';
  end if;
  if v_bill.status <> 'issued' then
    raise exception 'erp:bill_cancelled' using errcode = 'P0001';
  end if;
  if new.received_at < v_bill.issued_at - interval '1 minute' then
    raise exception 'erp:payment_before_bill' using errcode = 'P0001';
  end if;
  v_due := case new.payer when 'patient' then v_bill.patient_amount else v_bill.insurance_amount end;
  select coalesce(sum(p.amount), 0) into v_paid
  from orbit_erp.payments p where p.bill_id = new.bill_id and p.payer = new.payer;
  if new.amount > v_due - v_paid then
    raise exception 'erp:payment_exceeds_balance' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger payments_integrity before insert on orbit_erp.payments
  for each row execute function orbit_erp.check_payment();

-- ---------------------------------------------------------------------------
-- Issuing a bill
--
-- SECURITY INVOKER: every read and write below is filtered by the caller's own
-- RLS, so a hospital account can only bill a visit at its own hospital. The
-- bill covers the visit's completed services not already on a standing bill;
-- a service recorded after a bill is billed by the next one.
-- ---------------------------------------------------------------------------
create function orbit_erp.issue_bill(p_encounter_id uuid, p_idempotency_key uuid)
  returns uuid
  language plpgsql
  security invoker
  set search_path = pg_catalog, public
as $$
declare
  v_existing uuid;
  v_enc      orbit_erp.encounters%rowtype;
  v_missing  text;
  v_count    integer;
  v_gross    numeric(14, 2);
  v_type     text := 'self-pay';
  v_name     text;
  v_percent  numeric(5, 2) := 0;
  v_ins      numeric(14, 2);
  v_bill     uuid;
begin
  select b.id into v_existing from orbit_erp.bills b
  where b.organization_id = orbit.current_org() and b.idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return v_existing;                       -- a replay returns the bill it made
  end if;

  select * into v_enc from orbit_erp.encounters e where e.id = p_encounter_id;
  if not found then
    return null;                             -- not visible: the API answers not_found
  end if;
  if v_enc.status <> 'closed' then
    raise exception 'erp:bill_needs_closed_visit' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('orbit_erp.bill:' || p_encounter_id::text, 0));

  create temporary table _unbilled on commit drop as
    select sd.id as delivery_id, sd.service_id, sv.name, sd.quantity, fs.illustrative_tariff as price
    from orbit_erp.service_deliveries sd
    join orbit_erp.services sv on sv.id = sd.service_id
    left join orbit_erp.facility_services fs on fs.facility_id = sd.facility_id and fs.service_id = sd.service_id
    where sd.encounter_id = p_encounter_id
      and sd.status = 'completed'
      and not exists (
        select 1 from orbit_erp.bill_lines bl
        join orbit_erp.bills b on b.id = bl.bill_id
        where bl.service_delivery_id = sd.id and b.status = 'issued'
      );

  select string_agg(distinct u.name, ', ' order by u.name) into v_missing from _unbilled u where u.price is null;
  if v_missing is not null then
    raise exception 'erp:price_missing:%', v_missing using errcode = 'P0001';
  end if;
  select count(*), coalesce(sum(u.quantity * u.price), 0) into v_count, v_gross from _unbilled u;
  if v_count = 0 then
    raise exception 'erp:nothing_to_bill' using errcode = 'P0001';
  end if;

  select c.payer_type, c.payer_name, c.coverage_percent into v_type, v_name, v_percent
  from orbit_erp.patient_coverage c where c.patient_id = v_enc.patient_id;
  if not found then
    v_type := 'self-pay'; v_name := null; v_percent := 0;
  end if;
  v_ins := round(v_gross * v_percent / 100, 2);

  insert into orbit_erp.bills (facility_id, encounter_id, patient_id, payer_type, payer_name, coverage_percent,
                               gross_amount, insurance_amount, patient_amount, idempotency_key)
  values (v_enc.facility_id, v_enc.id, v_enc.patient_id, v_type, v_name, v_percent,
          v_gross, v_ins, v_gross - v_ins, p_idempotency_key)
  returning id into v_bill;

  insert into orbit_erp.bill_lines (bill_id, facility_id, service_delivery_id, service_id, description, quantity, unit_price, line_amount)
  select v_bill, v_enc.facility_id, u.delivery_id, u.service_id, u.name, u.quantity, u.price, u.quantity * u.price
  from _unbilled u;

  drop table _unbilled;
  return v_bill;
end;
$$;

comment on function orbit_erp.issue_bill(uuid, uuid) is
  'Issues a bill for a closed visit''s unbilled completed services, priced from the hospital''s price '
  'list, split by the patient''s cover. Refuses unpriced services by name. Idempotent per key. '
  'Security invoker: the caller''s RLS bounds every row.';

-- ---------------------------------------------------------------------------
-- 5. Revenue aggregates for leaders (bounded like the operations feed)
-- ---------------------------------------------------------------------------
create function orbit_erp.revenue_feed(p_days integer default 30)
  returns table (
    facility_id         uuid,
    bills_period        integer,
    gross_period        numeric,
    insurance_period    numeric,
    patient_period      numeric,
    collected_period    numeric,
    gross_today         numeric,
    collected_today     numeric,
    open_bills          integer,
    outstanding_patient numeric,
    outstanding_insurer numeric
  )
  language plpgsql
  stable
  security definer
  set search_path = pg_catalog, public
as $$
#variable_conflict use_column
declare
  v_tz    text;
  v_today date;
begin
  if p_days is null or p_days < 1 or p_days > 92 then
    raise exception 'erp:revenue_range_invalid' using errcode = 'P0001';
  end if;
  select o.timezone into v_tz from orbit.organizations o where o.id = orbit.current_org();
  if v_tz is null then
    return;
  end if;
  v_today := (now() at time zone v_tz)::date;

  return query
    with f as (select v.f as id from orbit_erp.ops_visible_facilities() as v(f)),
    b as (
      select bl.*, (bl.issued_at at time zone v_tz)::date as issued_day
      from orbit_erp.bills bl join f on f.id = bl.facility_id
      where bl.status = 'issued'
    ),
    p as (
      select py.*, (py.received_at at time zone v_tz)::date as received_day
      from orbit_erp.payments py
      join orbit_erp.bills bl on bl.id = py.bill_id and bl.status = 'issued'
      join f on f.id = py.facility_id
    ),
    paid as (select p.bill_id, p.payer, sum(p.amount) as amount from p group by p.bill_id, p.payer)
    select
      f.id,
      (select count(*) from b where b.facility_id = f.id and b.issued_day > v_today - p_days)::integer,
      (select coalesce(sum(b.gross_amount), 0) from b where b.facility_id = f.id and b.issued_day > v_today - p_days),
      (select coalesce(sum(b.insurance_amount), 0) from b where b.facility_id = f.id and b.issued_day > v_today - p_days),
      (select coalesce(sum(b.patient_amount), 0) from b where b.facility_id = f.id and b.issued_day > v_today - p_days),
      (select coalesce(sum(p.amount), 0) from p where p.facility_id = f.id and p.received_day > v_today - p_days),
      (select coalesce(sum(b.gross_amount), 0) from b where b.facility_id = f.id and b.issued_day = v_today),
      (select coalesce(sum(p.amount), 0) from p where p.facility_id = f.id and p.received_day = v_today),
      (select count(*) from b where b.facility_id = f.id
         and b.gross_amount > coalesce((select sum(pd.amount) from paid pd where pd.bill_id = b.id), 0))::integer,
      (select coalesce(sum(b.patient_amount - coalesce((select pd.amount from paid pd where pd.bill_id = b.id and pd.payer = 'patient'), 0)), 0)
         from b where b.facility_id = f.id),
      (select coalesce(sum(b.insurance_amount - coalesce((select pd.amount from paid pd where pd.bill_id = b.id and pd.payer = 'insurer'), 0)), 0)
         from b where b.facility_id = f.id)
    from f
    order by f.id;
end;
$$;

comment on function orbit_erp.revenue_feed(integer) is
  'Per hospital: bills and amounts issued in the last p_days days and today, money collected, and what '
  'is still owed. Aggregates only, for a LEADER''s own hospitals (ops_visible_facilities); empty otherwise.';

create function orbit_erp.revenue_feed_daily(p_days integer default 30)
  returns table (facility_id uuid, day date, gross numeric, collected numeric)
  language plpgsql
  stable
  security definer
  set search_path = pg_catalog, public
as $$
#variable_conflict use_column
declare
  v_tz    text;
  v_today date;
begin
  if p_days is null or p_days < 1 or p_days > 92 then
    raise exception 'erp:revenue_range_invalid' using errcode = 'P0001';
  end if;
  select o.timezone into v_tz from orbit.organizations o where o.id = orbit.current_org();
  if v_tz is null then
    return;
  end if;
  v_today := (now() at time zone v_tz)::date;

  return query
    with f as (select v.f as id from orbit_erp.ops_visible_facilities() as v(f)),
    days as (select f.id as facility_id, d::date as day from f, generate_series(v_today - (p_days - 1), v_today, interval '1 day') d)
    select days.facility_id, days.day,
      coalesce((select sum(b.gross_amount) from orbit_erp.bills b
                where b.facility_id = days.facility_id and b.status = 'issued'
                  and (b.issued_at at time zone v_tz)::date = days.day), 0),
      coalesce((select sum(p.amount) from orbit_erp.payments p
                join orbit_erp.bills b on b.id = p.bill_id and b.status = 'issued'
                where p.facility_id = days.facility_id and (p.received_at at time zone v_tz)::date = days.day), 0)
    from days
    order by days.facility_id, days.day;
end;
$$;

comment on function orbit_erp.revenue_feed_daily(integer) is
  'Per hospital and day: amount billed and money collected. Aggregates only, for a LEADER''s own hospitals.';

-- ---------------------------------------------------------------------------
-- 6. Billing knowledge for the Orbit Assistant
--
-- One chunk per hospital, region and the group, rebuilt by the knowledge sync
-- after orbit.knowledge_refresh(). Source 'erp:billing', so knowledge_refresh
-- (which manages only 'auto:%') never removes them; this function removes its
-- own stale ones. Readable through the 'hospital-billing' domain grant below.
-- ---------------------------------------------------------------------------
insert into orbit.knowledge_role_access (role_id, domain) values
  ('group-cfo',              'hospital-billing'),
  ('billing-lead',           'hospital-billing'),
  ('corporate-revenue-lead', 'hospital-billing'),
  ('regional-coo',           'hospital-billing'),
  ('hospital-dho',           'hospital-billing')
on conflict do nothing;

create function orbit.knowledge_refresh_billing()
  returns integer
  language plpgsql
  security definer
  set search_path = pg_catalog, public
as $$
declare
  v_org   record;
  v_saved text := current_setting('orbit.membership', true);
  v_count integer;
begin
  create temporary table if not exists _rev (
    organization_id uuid, currency text, facility_id uuid, bills integer, gross numeric, insurance numeric,
    patient numeric, collected numeric, gross_today numeric, collected_today numeric, open_bills integer,
    due_patient numeric, due_insurer numeric
  ) on commit drop;
  truncate _rev;

  -- Group scope is borrowed for one organization at a time, as knowledge_refresh does.
  for v_org in select o.id, o.currency from orbit.organizations o loop
    perform set_config('orbit.membership', json_build_object(
      'membershipId', gen_random_uuid(), 'subject', gen_random_uuid(), 'organizationId', v_org.id, 'role', 'chairman',
      'scopes', json_build_array(json_build_object('grain', 'group', 'entityId', v_org.id)))::text, true);
    insert into _rev
    select v_org.id, v_org.currency, r.facility_id, r.bills_period, r.gross_period, r.insurance_period, r.patient_period,
           r.collected_period, r.gross_today, r.collected_today, r.open_bills, r.outstanding_patient, r.outstanding_insurer
    from orbit_erp.revenue_feed(30) r;
  end loop;
  perform set_config('orbit.membership', coalesce(v_saved, ''), true);

  create temporary table if not exists _bk (organization_id uuid, source_key text, grain text, entity_id uuid, title text, content text) on commit drop;
  truncate _bk;
  insert into _bk
  select u.organization_id, 'billing:' || u.grain || ':' || u.entity_id, u.grain, u.entity_id,
         'Hospital billing: ' || u.name,
         'Hospital billing for ' || u.name || ' (' || u.grain
         || case when u.grain = 'facility' then '' else ', ' || u.hospitals || ' hospitals' end
         || '), simulated ERP data in ' || u.currency || ', last 30 days: ' || u.bills || ' bills issued, '
         || to_char(u.gross, 'FM999999999990.00') || ' ' || u.currency || ' billed, of which insurers owe '
         || to_char(u.insurance, 'FM999999999990.00') || ' and patients ' || to_char(u.patient, 'FM999999999990.00')
         || '; ' || to_char(u.collected, 'FM999999999990.00') || ' ' || u.currency || ' collected. Today: '
         || to_char(u.gross_today, 'FM999999999990.00') || ' billed, ' || to_char(u.collected_today, 'FM999999999990.00')
         || ' collected. Still owed on all bills: ' || to_char(u.due_patient, 'FM999999999990.00') || ' by patients and '
         || to_char(u.due_insurer, 'FM999999999990.00') || ' by insurers, across ' || u.open_bills
         || ' bills not fully paid. Illustrative amounts, not real charges.'
  from (
    select r.organization_id, r.currency, 'facility' as grain, r.facility_id as entity_id, fa.name, 1 as hospitals,
           r.bills, r.gross, r.insurance, r.patient, r.collected, r.gross_today, r.collected_today, r.open_bills, r.due_patient, r.due_insurer
    from _rev r join orbit.facilities fa on fa.id = r.facility_id
    union all
    select r.organization_id, min(r.currency), 'region', fa.region_id, re.name, count(*)::int,
           sum(r.bills)::int, sum(r.gross), sum(r.insurance), sum(r.patient), sum(r.collected), sum(r.gross_today),
           sum(r.collected_today), sum(r.open_bills)::int, sum(r.due_patient), sum(r.due_insurer)
    from _rev r join orbit.facilities fa on fa.id = r.facility_id join orbit.regions re on re.id = fa.region_id
    group by r.organization_id, fa.region_id, re.name
    union all
    select r.organization_id, min(r.currency), 'group', r.organization_id, o.name, count(*)::int,
           sum(r.bills)::int, sum(r.gross), sum(r.insurance), sum(r.patient), sum(r.collected), sum(r.gross_today),
           sum(r.collected_today), sum(r.open_bills)::int, sum(r.due_patient), sum(r.due_insurer)
    from _rev r join orbit.organizations o on o.id = r.organization_id
    group by r.organization_id, o.name
  ) u;

  insert into orbit.knowledge_chunks as k
    (organization_id, source_key, source, domain, visible_roles, entity_grain, entity_id, title, content, content_hash)
  select w.organization_id, w.source_key, 'erp:billing', 'hospital-billing', '{}', w.grain, w.entity_id,
         w.title, w.content, md5(w.title || E'\n' || w.content)
  from _bk w
  on conflict (organization_id, source_key) where source_key is not null
  do update set title = excluded.title, content = excluded.content, content_hash = excluded.content_hash,
                entity_grain = excluded.entity_grain, entity_id = excluded.entity_id, updated_at = now()
  where k.content_hash is distinct from excluded.content_hash;

  delete from orbit.knowledge_chunks k
  where k.source = 'erp:billing'
    and not exists (select 1 from _bk w where w.organization_id = k.organization_id and w.source_key = k.source_key);

  select count(*)::int into v_count from _bk;
  return v_count;
end;
$$;

comment on function orbit.knowledge_refresh_billing() is
  'Builds the billing knowledge chunks (source erp:billing, domain hospital-billing) from revenue_feed(30) '
  'for every hospital, region and group. Aggregates only. Run by the knowledge sync.';

-- ---------------------------------------------------------------------------
-- RLS: enabled and forced; per-statement forms (20261001000500)
-- ---------------------------------------------------------------------------
alter table orbit_erp.patient_coverage enable row level security;
alter table orbit_erp.bills            enable row level security;
alter table orbit_erp.bill_lines       enable row level security;
alter table orbit_erp.payments         enable row level security;
alter table orbit_erp.patient_coverage force row level security;
alter table orbit_erp.bills            force row level security;
alter table orbit_erp.bill_lines       force row level security;
alter table orbit_erp.payments         force row level security;

-- Cover: whoever can see the patient (patients_select) may read and set it.
create policy coverage_select on orbit_erp.patient_coverage for select to orbit_app
  using (organization_id = (select orbit.current_org())
         and exists (select 1 from orbit_erp.patients p where p.id = patient_coverage.patient_id));
create policy coverage_insert on orbit_erp.patient_coverage for insert to orbit_app
  with check (organization_id = (select orbit.current_org())
              and (select orbit_erp.is_operator())
              and updated_by_membership_id = (select orbit.current_membership_id())
              and exists (select 1 from orbit_erp.patients p where p.id = patient_coverage.patient_id));
create policy coverage_update on orbit_erp.patient_coverage for update to orbit_app
  using (organization_id = (select orbit.current_org())
         and exists (select 1 from orbit_erp.patients p where p.id = patient_coverage.patient_id))
  with check (organization_id = (select orbit.current_org())
              and updated_by_membership_id = (select orbit.current_membership_id()));

-- Bills: both operator roles issue for hospitals they can see; only an admin cancels.
create policy bills_select on orbit_erp.bills for select to orbit_app
  using (organization_id = (select orbit.current_org())
         and (facility_id = any (coalesce((select orbit_erp.visible_facility_ids()), array[]::uuid[]))));
create policy bills_insert on orbit_erp.bills for insert to orbit_app
  with check (organization_id = (select orbit.current_org())
              and (facility_id = any (coalesce((select orbit_erp.visible_facility_ids()), array[]::uuid[])))
              and issued_by_membership_id = (select orbit.current_membership_id())
              and status = 'issued');
create policy bills_update on orbit_erp.bills for update to orbit_app
  using (organization_id = (select orbit.current_org())
         and (select orbit_erp.is_admin())
         and (facility_id = any (coalesce((select orbit_erp.visible_facility_ids()), array[]::uuid[]))))
  with check (organization_id = (select orbit.current_org())
              and (select orbit_erp.is_admin())
              and cancelled_by_membership_id = (select orbit.current_membership_id()));

create policy bill_lines_select on orbit_erp.bill_lines for select to orbit_app
  using (organization_id = (select orbit.current_org())
         and (facility_id = any (coalesce((select orbit_erp.visible_facility_ids()), array[]::uuid[]))));
create policy bill_lines_insert on orbit_erp.bill_lines for insert to orbit_app
  with check (organization_id = (select orbit.current_org())
              and (facility_id = any (coalesce((select orbit_erp.visible_facility_ids()), array[]::uuid[]))));

-- Payments: recorded as the caller, at a hospital the caller can see. No update.
create policy payments_select on orbit_erp.payments for select to orbit_app
  using (organization_id = (select orbit.current_org())
         and (facility_id = any (coalesce((select orbit_erp.visible_facility_ids()), array[]::uuid[]))));
create policy payments_insert on orbit_erp.payments for insert to orbit_app
  with check (organization_id = (select orbit.current_org())
              and (facility_id = any (coalesce((select orbit_erp.visible_facility_ids()), array[]::uuid[])))
              and recorded_by_membership_id = (select orbit.current_membership_id()));

-- ---------------------------------------------------------------------------
-- Grants: exactly what the API uses. No DELETE or TRUNCATE.
-- ---------------------------------------------------------------------------
grant select, insert, update on orbit_erp.patient_coverage, orbit_erp.bills to orbit_app;
grant select, insert on orbit_erp.bill_lines, orbit_erp.payments to orbit_app;
grant usage on sequence orbit_erp.bill_number_seq to orbit_app;

revoke all on function orbit_erp.check_price_change() from public;
revoke all on function orbit_erp.check_billed_delivery() from public;
revoke all on function orbit_erp.check_bill_update() from public;
revoke all on function orbit_erp.check_payment() from public;
revoke all on function orbit_erp.issue_bill(uuid, uuid) from public;
revoke all on function orbit_erp.revenue_feed(integer) from public;
revoke all on function orbit_erp.revenue_feed_daily(integer) from public;
revoke all on function orbit.knowledge_refresh_billing() from public;
grant execute on function orbit_erp.issue_bill(uuid, uuid) to orbit_app;
grant execute on function orbit_erp.revenue_feed(integer) to orbit_app;
grant execute on function orbit_erp.revenue_feed_daily(integer) to orbit_app;
grant execute on function orbit.knowledge_refresh_billing() to orbit_app;
