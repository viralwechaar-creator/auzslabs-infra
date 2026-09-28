-- =========================================================
-- Phase 1: generic business modules
--   1. Bookings: real slot-conflict enforcement + booking -> order
--   2. Expenses: no schema change needed (kind='exp' already exists
--      in 002_core_engine.sql's r_ins/r_upd policies, and the real
--      shape is already live in app/public/index.html's V.rep --
--      {note, amt, d} -- amt not amount, d not date, no category
--      field at all today). This file adds an OPT-IN category
--      (business_rules.expense_categories, read as coalesce(cat,
--      'Uncategorized') so old and new expense rows both work).
--   3. Reports & Analytics: read-only, tenant-scoped aggregate RPC
--      over the existing `records` table, reading the REAL order
--      shape (data->'t'->>'total' etc, `lines` not `items`,
--      data->>'paidAt' + status='paid', not updated_at) confirmed
--      against index.html's newOrder()/tot()/persist()/V.rep.
--
-- Additive only. Existing tenants are unaffected until they opt in
-- (see the backfill note at the bottom).
-- =========================================================

-- ---------------------------------------------------------
-- 1a. Bookings: columns needed for real conflict checking
-- ---------------------------------------------------------
create extension if not exists btree_gist;

alter table bookings add column if not exists end_time time;
alter table bookings add column if not exists order_id text; -- loose ref into records(kind='order'), same style resource_id already uses

-- tenant_id now defaults from the caller's own session, same pattern
-- push_subs.tenant_id already uses in 002_core_engine.sql -- the
-- client never needs to (and shouldn't) send it.
alter table bookings alter column tenant_id set default ((me()->>'tenant_id')::uuid);

-- Generated LOCAL timestamp range (not timestamptz), used only for
-- the exclusion constraint below. Two reasons for plain `timestamp`:
-- (1) a booking conflict is about the business's own wall-clock time,
-- not UTC, so tz-naive is actually more correct here, not just
-- convenient; (2) `date + time` produces a plain `timestamp`, and
-- casting that to `timestamptz` depends on the session's timezone
-- setting -- Postgres rejects that as a generated column ("generation
-- expression is not immutable"), confirmed by hand against a real
-- Postgres 16 while writing this migration. Falls back to a
-- same-instant zero-length range when time/end_time aren't set yet
-- (a booking still being drafted), which the constraint's WHERE
-- clause excludes from conflict checking anyway.
alter table bookings add column if not exists start_ts timestamp
  generated always as (date + coalesce(time, '00:00'::time)) stored;
alter table bookings add column if not exists end_ts timestamp
  generated always as (date + coalesce(end_time, time, '00:00'::time)) stored;

-- ---------------------------------------------------------
-- 1b. Bookings: the actual conflict/overlap enforcement
--
-- A real DB constraint, not app-level validation: two bookings for
-- the same resource, in the same tenant, with overlapping
-- [start_ts, end_ts) ranges, cannot both exist. Cancelled bookings
-- and not-yet-slotted bookings (no resource, or no time/end_time
-- yet) are excluded from the check.
-- ---------------------------------------------------------
alter table bookings
  add constraint bookings_no_overlap
  exclude using gist (
    tenant_id with =,
    resource_id with =,
    tsrange(start_ts, end_ts, '[)') with &&
  )
  where (
    status <> 'cancelled'
    and resource_id is not null
    and time is not null
    and end_time is not null
  );
-- A client insert/update that violates this comes back from Postgres
-- as error code 23P01 (exclusion_violation) -- server/src/index.js
-- turns that into a friendly 409, not a raw 500.

-- ---------------------------------------------------------
-- 2. Booking -> Order conversion
--
-- Creates a plain OPEN, unpaid order pre-filled from the booking's
-- customer + line items -- NOT a fully "paid" order. This is
-- deliberate: fully replicating payment (dedu() stock deduction,
-- mk() kitchen ticket, printing) only makes sense as real UI side
-- effects staff trigger themselves. An open order with real `lines`/
-- `cust`/`t` shows up under V.tabs' "Open orders" exactly like any
-- order created by hand, and opens correctly in the POS screen to
-- be sent to kitchen / paid normally.
--
-- Real order shape confirmed against index.html: newOrder() (id,
-- type, table, lines, status, created, by, cust), tot() (sub, d,
-- tax, round, total under a nested `t` object, not flat columns),
-- and persist() (`o.t=tot(o)` stored alongside `no`). Line items are
-- `lines`, each `{id,name,price,qty,sent,st}` (addLine()/qty()/mk()).
-- ---------------------------------------------------------
create function convert_booking_to_order(p_booking_id uuid, p_invoice_prefix text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  tid uuid;
  b bookings%rowtype;
  new_id text := gen_random_uuid()::text;
  settings_data jsonb;
  tax_rate numeric;
  prefix text;
  lines jsonb;
  sub numeric;
  ex numeric;
  total numeric;
  inv text;
begin
  tid := (me()->>'tenant_id')::uuid;
  if tid is null then
    raise exception 'not authorized';
  end if;

  select * into b from bookings where id = p_booking_id and tenant_id = tid;
  if not found then
    raise exception 'booking not found';
  end if;
  if b.order_id is not null then
    raise exception 'booking already converted to order %', b.order_id;
  end if;

  select data into settings_data from records where tenant_id = tid and kind = 'settings' and id = 'settings';
  tax_rate := coalesce((settings_data->>'tax')::numeric, 0);
  prefix := coalesce(p_invoice_prefix, settings_data->>'prefix', 'INV');

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', coalesce(item->>'id', item->>'name', 'item'),
           'name', item->>'name',
           'price', (item->>'price')::numeric,
           'qty', (item->>'qty')::numeric,
           'sent', 0,
           'st', coalesce(item->>'st', 'Kitchen')
         )), '[]'::jsonb),
         coalesce(sum((item->>'price')::numeric * (item->>'qty')::numeric), 0)
    into lines, sub
    from jsonb_array_elements(coalesce(b.items, '[]'::jsonb)) item;

  ex := sub * (1 + tax_rate / 100);
  total := round(ex);
  inv := next_invoice_no(prefix);

  insert into records (id, tenant_id, kind, data, deleted)
  values (
    new_id, tid, 'order',
    jsonb_build_object(
      'id', new_id,
      'type', 'Dine-in',
      'table', null,
      'lines', lines,
      'status', 'open',
      'created', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'by', app_uid(),
      'cust', jsonb_build_object('name', b.customer_name, 'phone', b.customer_phone),
      'no', inv,
      't', jsonb_build_object('sub', sub, 'd', 0, 'tax', round(sub * tax_rate / 100, 2), 'round', total - ex, 'total', total),
      'source', 'booking',
      'bookingId', b.id
    ),
    false
  );

  update bookings set order_id = new_id, status = 'completed'
  where id = b.id and tenant_id = tid;

  return jsonb_build_object('order_id', new_id, 'invoice_no', inv);
end $$;
-- Gated by the me()/tenant check inside the function body, same as
-- every other RPC in 002_core_engine.sql -- not a role grant.

-- ---------------------------------------------------------
-- 3. Reports & Analytics
--
-- One security-definer function, one round trip, tenant-scoped via
-- me() exactly like everything else. Read-only. Field paths
-- confirmed against the real client: order totals live at
-- data->'t'->>'total' (tot()/persist() in index.html), NOT a flat
-- data->>'total'; line items are data->'lines', NOT data->'items';
-- "which day" is data->>'paidAt' + status='paid' (V.rep's own
-- filter), NOT updated_at; expense amount is data->>'amt' and its
-- date is data->>'d' (V.rep's "Add expense" widget), NOT
-- data->>'amount'/'date'. There is no category field on expenses
-- today -- by_category reads it as an opt-in addition, defaulting
-- to 'Uncategorized' so existing rows still aggregate correctly.
-- ---------------------------------------------------------
create function report_dashboard(p_from date, p_to date)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare
  tid uuid;
  result jsonb;
begin
  tid := (me()->>'tenant_id')::uuid;
  if tid is null then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),

    'sales', (
      select jsonb_build_object(
        'total_revenue', coalesce(sum((data->'t'->>'total')::numeric), 0),
        'discounts', coalesce(sum((data->'t'->>'d')::numeric), 0),
        'tax_collected', coalesce(sum((data->'t'->>'tax')::numeric), 0),
        'order_count', count(*)
      )
      from records
      where tenant_id = tid and kind = 'order' and not deleted
        and data->>'status' = 'paid'
        and (data->>'paidAt')::timestamptz::date between p_from and p_to
    ),

    'sales_by_day', (
      select coalesce(jsonb_agg(row_to_json(d) order by d.day), '[]'::jsonb)
      from (
        select (data->>'paidAt')::timestamptz::date as day,
               coalesce(sum((data->'t'->>'total')::numeric), 0) as revenue,
               count(*) as order_count
        from records
        where tenant_id = tid and kind = 'order' and not deleted
          and data->>'status' = 'paid'
          and (data->>'paidAt')::timestamptz::date between p_from and p_to
        group by (data->>'paidAt')::timestamptz::date
      ) d
    ),

    'refunds_total', (
      select coalesce(sum((r->>'amt')::numeric), 0)
      from records rec, jsonb_array_elements(coalesce(rec.data->'refunds', '[]'::jsonb)) r
      where rec.tenant_id = tid and rec.kind = 'order' and not rec.deleted
        and rec.data->>'status' = 'paid'
        and (rec.data->>'paidAt')::timestamptz::date between p_from and p_to
    ),

    'expenses', (
      select jsonb_build_object(
        'total', coalesce((select sum((data->>'amt')::numeric) from records
                            where tenant_id = tid and kind = 'exp' and not deleted
                              and (data->>'d')::date between p_from and p_to), 0),
        'by_category', coalesce((
          select jsonb_object_agg(coalesce(cat, 'Uncategorized'), cat_total)
          from (
            select data->>'cat' as cat, sum((data->>'amt')::numeric) as cat_total
            from records
            where tenant_id = tid and kind = 'exp' and not deleted
              and (data->>'d')::date between p_from and p_to
            group by data->>'cat'
          ) e
        ), '{}'::jsonb)
      )
    ),

    'best_sellers', (
      select coalesce(jsonb_agg(row_to_json(bs) order by bs.qty desc), '[]'::jsonb)
      from (
        select line->>'name' as name,
               sum((line->>'qty')::numeric) as qty,
               sum((line->>'qty')::numeric * (line->>'price')::numeric) as revenue
        from records r, jsonb_array_elements(r.data->'lines') line
        where r.tenant_id = tid and r.kind = 'order' and not r.deleted
          and r.data->>'status' = 'paid'
          and (r.data->>'paidAt')::timestamptz::date between p_from and p_to
        group by line->>'name'
        order by qty desc
        limit 10
      ) bs
    ),

    'peak_hours', (
      select coalesce(jsonb_agg(row_to_json(ph) order by ph.hour), '[]'::jsonb)
      from (
        select extract(hour from (data->>'paidAt')::timestamptz)::int as hour, count(*) as order_count
        from records
        where tenant_id = tid and kind = 'order' and not deleted
          and data->>'status' = 'paid'
          and (data->>'paidAt')::timestamptz::date between p_from and p_to
        group by extract(hour from (data->>'paidAt')::timestamptz)
      ) ph
    )
  ) into result;

  return result;
end $$;

-- ---------------------------------------------------------
-- 4. Feature flags + config for the new modules
--
-- Additive to niche_presets only -- future onboarding gets these
-- switched on by niche; already-onboarded tenants keep whatever
-- their tenant_settings.features already says (a missing key reads
-- as falsy client-side, i.e. off).
-- ---------------------------------------------------------
update niche_presets
set default_features = default_features || '{"expenses": true, "reports": true}'::jsonb,
    default_labels = default_labels || '{"expense": "Expense", "report": "Reports"}'::jsonb,
    default_business_rules = default_business_rules ||
      '{"expense_categories": ["Rent", "Supplies", "Utilities", "Payroll", "Marketing", "Other"]}'::jsonb;

-- To turn these on for a client who already onboarded, run per-tenant:
--   update tenant_settings set features = features || '{"expenses":true,"reports":true}'::jsonb
--   where tenant_id = '<their tenant id>';
-- This migration intentionally does not do that automatically.
