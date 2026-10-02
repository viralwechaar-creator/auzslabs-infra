-- =========================================================
-- POS rebuild: server foundation (see docs/POS_AUDIT.md)
--
--  1. push_record: a write is authorised against the kind ALREADY STORED as well as the new one, and only the
--     owner may change a record's kind. Before this, a cashier could push rid='settings' with rkind='order' and
--     replace the business settings (or turn a menu item into an "order").
--     Staff may flip a table's cleaning state and a retail variant's stock count, nothing else on those masters
--     (both used to fail with "not authorized" for every non-owner, so the write sat in the outbox forever).
--     New staff kinds: register (cash register sessions), waitlist (walk-in queue).
--  2. Manager approvals: an owner/manager sets a PIN (pos_set_pin); a PIN typed on a cashier's till is checked by
--     pos_verify_pin, which returns an approval signed for ONE action on ONE bill (HMAC, per-business secret,
--     valid 24 h). The order guard accepts a cashier's void, refund, credit bill, complimentary bill, over-limit
--     discount or after-KOT cancellation only with that approval (or when the session itself has billing rights).
--  3. Paid and void bills are frozen server-side: lines, totals and payments keep their stored values whatever a
--     device sends (a stale copy force-pushed after a conflict can no longer rewrite a bill); refunds and exchanges
--     are append-only and capped at the bill total.
--  4. pos_audit: append-only audit log written by a trigger on records (actor, role, before/after, approver).
--  5. next_kot_no(day, outlet): daily KOT numbers.
--  6. claim_guest_order: accepting a QR order is atomic, so two tills can never both turn it into an order.
--  7. redeem_giftcard: gift-card tender, atomic and idempotent per bill.
--  8. bookings (restaurant reservations): party size, note, source, outlet; 'seated' and 'no_show' statuses;
--     a no-show or finished reservation no longer blocks the table's time slot.
-- =========================================================

-- ---------- helpers ----------
create or replace function pos_num(t text) returns numeric language plpgsql immutable as $$
begin return t::numeric; exception when others then return null; end $$;

-- billing permission, same rule as can('m') in the POS: owner always; a custom role decides by its 'billing'
-- flag; otherwise managers yes, cashiers no
create or replace function pos_can_bill() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when p.role = 'owner' then true
                when p.role_id is not null then coalesce((r.permissions->>'billing')::boolean, false)
                when p.role = 'manager' then true
                else false end
    from profiles p left join roles r on r.id = p.role_id
    where p.id = app_uid()), false)
$$;

-- true when the only differences between two item records are variant stock counts (qty, usage)
create or replace function pos_only_variant_stock_changed(o jsonb, n jsonb) returns boolean language plpgsql immutable as $$
declare i int; ov jsonb := coalesce(o->'variants', '[]'); nv jsonb := coalesce(n->'variants', '[]');
begin
  if (o - 'variants') is distinct from (n - 'variants') then return false; end if;
  if jsonb_typeof(ov) <> 'array' or jsonb_typeof(nv) <> 'array' or jsonb_array_length(ov) <> jsonb_array_length(nv) then return false; end if;
  for i in 0 .. jsonb_array_length(ov) - 1 loop
    if ((ov->i) - 'qty' - 'usage') is distinct from ((nv->i) - 'qty' - 'usage') then return false; end if;
  end loop;
  return true;
end $$;

-- the write rule for one kind, shared by push_record (the real gate) and the RLS policies (the fallback)
create or replace function pos_kind_ok(k text, d jsonb, old jsonb, deleting boolean) returns boolean language plpgsql stable security definer set search_path = public as $$
declare myrole text := me()->>'role'; myemp text;
begin
  if myrole is null then return false; end if;
  if k in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog', 'membership', 'checkin', 'ticket', 'ticketnote', 'task', 'vendor', 'purchase', 'adjustment', 'transfer', 'customer', 'cashmove', 'register', 'waitlist') then
    return true;
  end if;
  if myrole = 'owner' then return true; end if;
  if myrole = 'manager' and k in ('hr_settings', 'hr_employee', 'hr_shift', 'hr_advance', 'hr_attendance', 'hr_leave', 'hr_payslip', 'hr_announcement', 'hr_document', 'hr_regularization', 'hr_holiday', 'hr_profile', 'plan', 'outlet', 'variant', 'po', 'device', 'addongrp', 'tax', 'settlement', 'platform', 'giftcard', 'segment', 'campaign', 'closing', 'quicklink') then
    return true;
  end if;
  -- operational state on master records: a table's cleaning flag, a retail variant's stock count
  if k = 'table' and old is not null and not deleting then
    -- the POS stamps the current outlet on records it saves; a table without one may gain outlet 'main' and nothing else
    return (d - 'cleaned' - 'cleanedAt' - 'cleanedBy' - (case when not (old ? 'outlet') and coalesce(d->>'outlet', 'main') = 'main' then 'outlet' else '' end))
           is not distinct from (old - 'cleaned' - 'cleanedAt' - 'cleanedBy');
  end if;
  if k = 'item' and old is not null and not deleting then
    return pos_only_variant_stock_changed(old, d);
  end if;
  if k in ('hr_attendance', 'hr_leave', 'hr_document', 'hr_regularization', 'hr_profile', 'hr_advance') then
    myemp := my_employee_id();
    if myemp is null or d->>'empId' is distinct from myemp then return false; end if;
    return case k when 'hr_leave' then d->>'status' = 'pending'
                  when 'hr_regularization' then d->>'status' = 'pending'
                  when 'hr_advance' then d->>'status' = 'requested'
                  else true end;
  end if;
  return false;
end $$;

-- ---------- 1. push_record ----------
create or replace function push_record(rid text, rkind text, rdata jsonb, rdeleted boolean, base timestamptz, force boolean default false) returns jsonb language plpgsql security definer set search_path = public as $$
declare cur timestamptz; cur_kind text; cur_data jsonb; conflict boolean := false; newv timestamptz; tid uuid; myrole text;
begin
  tid := (me()->>'tenant_id')::uuid;
  myrole := me()->>'role';
  if tid is null then raise exception 'not authorized'; end if;

  select updated_at, kind, data into cur, cur_kind, cur_data from records where tenant_id = tid and id = rid;

  if cur is not null and cur_kind <> rkind and myrole <> 'owner' then
    raise exception 'not authorized: a % record cannot be saved as %', cur_kind, rkind using errcode = '42501';
  end if;
  if not pos_kind_ok(rkind, rdata, cur_data, rdeleted) then raise exception 'not authorized' using errcode = '42501'; end if;

  if cur is null then
    insert into records (id, tenant_id, kind, data, deleted) values (rid, tid, rkind, rdata, rdeleted) returning updated_at into newv;
  elsif force or base is null or cur = base then
    update records set kind = rkind, data = rdata, deleted = rdeleted where tenant_id = tid and id = rid returning updated_at into newv;
  else
    conflict := true; newv := cur;
  end if;

  return jsonb_build_object('ok', not conflict, 'conflict', conflict, 'server_updated_at', newv);
end $$;

drop policy if exists r_ins on records;
create policy r_ins on records for insert
  with check (me() is not null and tenant_id = (me()->>'tenant_id')::uuid and pos_kind_ok(kind, data, null, deleted));
drop policy if exists r_upd on records;
create policy r_upd on records for update
  using (me() is not null and tenant_id = (me()->>'tenant_id')::uuid)
  with check (me() is not null and tenant_id = (me()->>'tenant_id')::uuid and pos_kind_ok(kind, data, null, deleted));

-- ---------- 2. manager approvals ----------
create table if not exists pos_pins (
  user_id    uuid primary key references auth_users(id) on delete cascade,
  tenant_id  uuid not null references tenants(id) on delete cascade,
  pin_hash   text not null,
  updated_at timestamptz not null default now()
);
create table if not exists pos_pin_attempts (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id   uuid,
  at        timestamptz not null default now(),
  ok        boolean not null
);
create index if not exists pos_pin_attempts_recent on pos_pin_attempts (tenant_id, user_id, at desc);
create table if not exists pos_secrets (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  secret    text not null
);
-- no policies: these three tables are reachable only through the functions below
alter table pos_pins enable row level security;
alter table pos_pin_attempts enable row level security;
alter table pos_secrets enable row level security;

create or replace function pos_secret(tid uuid) returns text language plpgsql security definer set search_path = public as $$
declare s text;
begin
  select secret into s from pos_secrets where tenant_id = tid;
  if s is null then
    insert into pos_secrets (tenant_id, secret) values (tid, encode(gen_random_bytes(32), 'hex')) on conflict (tenant_id) do nothing;
    select secret into s from pos_secrets where tenant_id = tid;
  end if;
  return s;
end $$;

create or replace function pos_approval_sign(tid uuid, approver text, act text, ref text, exp bigint) returns text language sql security definer set search_path = public as $$
  select encode(hmac(approver || '|' || act || '|' || ref || '|' || exp::text, pos_secret(tid), 'sha256'), 'hex')
$$;

-- an approval object {id, name, action, exp, token} is valid for this action on this record of this business
create or replace function pos_approval_ok(a jsonb, act text, ref text, tid uuid) returns boolean language plpgsql security definer set search_path = public as $$
begin
  if a is null or jsonb_typeof(a) <> 'object' or a->>'action' is distinct from act or a->>'token' is null then return false; end if;
  if pos_num(a->>'exp') is null or pos_num(a->>'exp') < extract(epoch from now()) then return false; end if;
  return a->>'token' = pos_approval_sign(tid, a->>'id', act, ref, (a->>'exp')::bigint);
exception when others then return false;
end $$;

create or replace function pos_pin_status() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'mine', exists (select 1 from pos_pins where user_id = app_uid()),
    'approvers', (select count(*) from pos_pins pp join profiles p on p.id = pp.user_id where pp.tenant_id = (me()->>'tenant_id')::uuid and p.tenant_id = pp.tenant_id),
    'can_approve', pos_can_bill())
$$;

create or replace function pos_set_pin(p_pin text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := (me()->>'tenant_id')::uuid; clash boolean;
begin
  if tid is null then raise exception 'not authorized'; end if;
  if not pos_can_bill() then raise exception 'Only an owner or a manager can set an approval PIN' using errcode = '42501'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then raise exception 'Use 4 to 8 digits'; end if;
  select exists (select 1 from pos_pins where tenant_id = tid and user_id <> app_uid() and crypt(p_pin, pin_hash) = pin_hash) into clash;
  if clash then raise exception 'Someone else already uses that PIN. Choose another.'; end if;
  insert into pos_pins (user_id, tenant_id, pin_hash) values (app_uid(), tid, crypt(p_pin, gen_salt('bf', 8)))
    on conflict (user_id) do update set pin_hash = excluded.pin_hash, tenant_id = excluded.tenant_id, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- checks a PIN typed on the cashier's till against every approver of this business; on success returns an
-- approval signed for p_action on record p_ref
create or replace function pos_verify_pin(p_pin text, p_action text, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := (me()->>'tenant_id')::uuid; fails int; hit record; okv boolean; ex bigint;
begin
  if tid is null then raise exception 'not authorized'; end if;
  if coalesce(p_action, '') not in ('discount', 'void', 'refund', 'cancel', 'comp', 'credit', 'return', 'price') or coalesce(p_ref, '') = '' then
    raise exception 'Unknown approval';
  end if;
  select count(*) into fails from pos_pin_attempts where tenant_id = tid and user_id is not distinct from app_uid() and not ok and at > now() - interval '5 minutes';
  if fails >= 5 then raise exception 'Too many wrong PINs. Try again in 5 minutes.' using errcode = '42501'; end if;
  select pp.user_id, coalesce(nullif(p.name, ''), p.email) as nm, p.role, p.role_id into hit
    from pos_pins pp join profiles p on p.id = pp.user_id
   where pp.tenant_id = tid and p.tenant_id = tid and p_pin ~ '^[0-9]{4,8}$' and crypt(p_pin, pp.pin_hash) = pp.pin_hash
   limit 1;
  okv := hit.user_id is not null and (hit.role = 'owner'
           or (hit.role_id is not null and coalesce((select (r.permissions->>'billing')::boolean from roles r where r.id = hit.role_id), false))
           or (hit.role_id is null and hit.role = 'manager'));
  insert into pos_pin_attempts (tenant_id, user_id, ok) values (tid, app_uid(), okv);
  delete from pos_pin_attempts where at < now() - interval '1 day';
  if not okv then return jsonb_build_object('ok', false); end if;
  ex := extract(epoch from now() + interval '24 hours')::bigint;
  return jsonb_build_object('ok', true, 'id', hit.user_id, 'name', hit.nm, 'role', hit.role, 'action', p_action, 'exp', ex,
                            'token', pos_approval_sign(tid, hit.user_id::text, p_action, p_ref, ex));
end $$;

-- an owner/manager approving their own action gets the same signed approval, so a bill they discounted on one till
-- can be paid by a cashier on another
create or replace function pos_sign_approval(p_action text, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := (me()->>'tenant_id')::uuid; ex bigint; nm text;
begin
  if tid is null or not pos_can_bill() then raise exception 'Only an owner or a manager can approve this' using errcode = '42501'; end if;
  if coalesce(p_action, '') not in ('discount', 'void', 'refund', 'cancel', 'comp', 'credit', 'return', 'price') or coalesce(p_ref, '') = '' then raise exception 'Unknown approval'; end if;
  select coalesce(nullif(name, ''), email) into nm from profiles where id = app_uid();
  ex := extract(epoch from now() + interval '24 hours')::bigint;
  return jsonb_build_object('ok', true, 'id', app_uid(), 'name', nm, 'role', me()->>'role', 'action', p_action, 'exp', ex, 'token', pos_approval_sign(tid, app_uid()::text, p_action, p_ref, ex));
end $$;

-- ---------- 3. order guard: approvals on open bills, frozen paid and void bills ----------
-- union of two jsonb arrays of events: every old element is kept, new elements are added once (matched on at+amt)
create or replace function pos_append_only(old_a jsonb, new_a jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) from (
    select e, o.n as ord from jsonb_array_elements(case when jsonb_typeof(old_a) = 'array' then old_a else '[]' end) with ordinality o(e, n)
    union all
    select e, 100000 + x.n from jsonb_array_elements(case when jsonb_typeof(new_a) = 'array' then new_a else '[]' end) with ordinality x(e, n)
     where not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(old_a) = 'array' then old_a else '[]' end) o2
                        where o2->>'at' is not distinct from e->>'at' and o2->>'amt' is not distinct from e->>'amt')
  ) u
$$;

-- quantity already sent to the kitchen, per line key (item|size|note)
create or replace function pos_sent_by_key(d jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_object_agg(kk, s), '{}') from (
    select coalesce(l->>'id', '') || '|' || coalesce(l->>'size', '') || '|' || coalesce(l->>'note', '') kk, sum(coalesce(pos_num(l->>'sent'), 0)) s
      from jsonb_array_elements(case when jsonb_typeof(d->'lines') = 'array' then d->'lines' else '[]' end) l group by 1) a
$$;

create or replace function pos_sent_decreased(o jsonb, n jsonb) returns boolean language sql immutable as $$
  select exists (select 1 from jsonb_each_text(pos_sent_by_key(o)) a where a.value::numeric > coalesce(pos_num(pos_sent_by_key(n)->>a.key), 0))
$$;

-- a split moves items that were already sent to another bill; every sent quantity that went down must be covered by
-- a new entry in the order's moves log ({at, to, toNo, items:[{k: item|size|note, q}]})
create or replace function pos_moves_cover(o jsonb, n jsonb) returns boolean language sql immutable as $$
  with dec as (select a.key k, a.value::numeric - coalesce(pos_num(pos_sent_by_key(n)->>a.key), 0) q from jsonb_each_text(pos_sent_by_key(o)) a),
       mv as (select it->>'k' k, sum(coalesce(pos_num(it->>'q'), 0)) q
                from jsonb_array_elements(case when jsonb_typeof(n->'moves') = 'array' then n->'moves' else '[]' end) m
                cross join jsonb_array_elements(case when jsonb_typeof(m->'items') = 'array' then m->'items' else '[]' end) it
               where not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(o->'moves') = 'array' then o->'moves' else '[]' end) om where om->>'at' is not distinct from m->>'at')
               group by 1)
  select not exists (select 1 from dec left join mv on mv.k = dec.k where dec.q > 0.0001 and coalesce(mv.q, 0) + 0.0001 < dec.q)
$$;

create or replace function pos_order_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare st_old text; st_new text; merged jsonb; k text; refunded numeric; bill boolean; lim numeric; sub numeric; dsc numeric; e jsonb;
  frozen text[] := array['lines', 't', 'pays', 'no', 'disc', 'complimentary', 'compReason', 'coupon', 'cust', 'type', 'table', 'created', 'paidAt',
                         'tok', 'change', 'loyaltyRedeemed', 'charges', 'tip', 'covers', 'by', 'outlet', 'src', 'addr', 'gst', 'split'];
begin
  if new.kind <> 'order' or (tg_op = 'UPDATE' and old.kind <> 'order') then return new; end if;
  if me() is null then return new; end if;                 -- migrations, demo resets and other system jobs
  bill := pos_can_bill();
  st_old := case when tg_op = 'UPDATE' then coalesce(old.data->>'status', 'open') else 'new' end;
  st_new := coalesce(new.data->>'status', 'open');

  if st_old in ('paid', 'void') then
    if new.deleted and not old.deleted then
      if (me()->>'role') <> 'owner' then raise exception 'A paid or void bill cannot be deleted' using errcode = '42501'; end if;
      return new;
    end if;
    if st_old = 'void' then                                 -- void is final; only the print counter moves
      new.data := old.data || jsonb_build_object('printCount', coalesce(new.data->'printCount', old.data->'printCount', '0'::jsonb));
      return new;
    end if;
    merged := new.data;
    foreach k in array frozen loop
      merged := case when old.data ? k then merged || jsonb_build_object(k, old.data->k) else merged - k end;
    end loop;
    if st_new = 'void' then
      if not bill and not pos_approval_ok(new.data->'voidApprovedBy', 'void', new.id, new.tenant_id) then
        raise exception 'Only a manager can void a paid bill' using errcode = '42501';
      end if;
    elsif st_new <> 'paid' then
      merged := merged || jsonb_build_object('status', 'paid'); -- a stale copy cannot reopen a paid bill
    end if;
    merged := merged || jsonb_build_object('refunds', pos_append_only(old.data->'refunds', new.data->'refunds'),
                                           'exchanges', pos_append_only(old.data->'exchanges', new.data->'exchanges'));
    for e in select x from jsonb_array_elements(merged->'refunds') x
             where not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(old.data->'refunds') = 'array' then old.data->'refunds' else '[]' end) y
                                where y->>'at' is not distinct from x->>'at' and y->>'amt' is not distinct from x->>'amt') loop
      if not bill and not pos_approval_ok(e->'approvedBy', 'refund', new.id, new.tenant_id) then
        raise exception 'Only a manager can refund a bill' using errcode = '42501';
      end if;
      if coalesce(pos_num(e->>'amt'), 0) <= 0 then raise exception 'A refund needs an amount'; end if;
    end loop;
    select coalesce(sum(pos_num(r->>'amt')), 0) into refunded from jsonb_array_elements(merged->'refunds') r;
    if refunded > coalesce(pos_num(old.data->'t'->>'total'), 0) + 0.5 then
      raise exception 'Refunds (₹%) cannot be more than the bill total (₹%)', refunded, old.data->'t'->>'total';
    end if;
    if jsonb_array_length(merged->'exchanges') > jsonb_array_length(pos_append_only(old.data->'exchanges', '[]'))
       and not bill and not pos_approval_ok(new.data->'returnApprovedBy', 'return', new.id, new.tenant_id) then
      raise exception 'Only a manager can take a return' using errcode = '42501';
    end if;
    if jsonb_array_length(merged->'refunds') = 0 and not (old.data ? 'refunds') then merged := merged - 'refunds'; end if;
    if jsonb_array_length(merged->'exchanges') = 0 and not (old.data ? 'exchanges') then merged := merged - 'exchanges'; end if;
    new.data := merged;
    return new;
  end if;

  -- open, held and credit bills: the rules a cashier needs a manager for
  if bill then return new; end if;
  if tg_op = 'UPDATE' and not (new.data ? 'mergedInto') and pos_sent_decreased(old.data, new.data) and not pos_moves_cover(old.data, new.data)
     and not pos_approval_ok(new.data->'lastCancelApprovedBy', 'cancel', new.id, new.tenant_id) then
    raise exception 'Items already sent to the kitchen need a manager to cancel' using errcode = '42501';
  end if;
  if st_new = 'void' and st_old <> 'void' and not (new.data ? 'mergedInto') and tg_op = 'UPDATE'
     and exists (select 1 from jsonb_each_text(pos_sent_by_key(old.data)) s where s.value::numeric > 0)
     and not pos_approval_ok(new.data->'voidApprovedBy', 'void', new.id, new.tenant_id) then
    raise exception 'An order already sent to the kitchen needs a manager to cancel' using errcode = '42501';
  end if;
  if st_new in ('paid', 'due') and st_old not in ('paid', 'due') then
    if st_new = 'due' and not pos_approval_ok(new.data->'creditApprovedBy', 'credit', new.id, new.tenant_id) then
      raise exception 'A credit bill needs a manager' using errcode = '42501';
    end if;
    if coalesce(new.data->>'complimentary', 'false') = 'true' and not pos_approval_ok(new.data->'compApprovedBy', 'comp', new.id, new.tenant_id) then
      raise exception 'A complimentary bill needs a manager' using errcode = '42501';
    end if;
    -- a manual discount above the business limit (Settings: maxDiscountPct; 0 or empty = every manual discount needs a manager)
    sub := coalesce(pos_num(new.data->'t'->>'sub'), 0); dsc := coalesce(pos_num(new.data->'t'->>'d'), 0);
    if dsc > 0 and coalesce(new.data->>'coupon', '') = '' and coalesce(pos_num(new.data->>'loyaltyRedeemed'), 0) = 0
       and coalesce(new.data->>'complimentary', 'false') <> 'true' then
      select coalesce(pos_num(data->>'maxDiscountPct'), 0) into lim from records where tenant_id = new.tenant_id and kind = 'settings' and id = 'settings';
      if (coalesce(lim, 0) <= 0 or (sub > 0 and dsc * 100 / sub > lim + 0.01))
         and not pos_approval_ok(new.data->'disc'->'approvedBy', 'discount', new.id, new.tenant_id) then
        raise exception 'This discount needs a manager' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists records_order_guard on records;
create trigger records_order_guard before insert or update on records for each row when (new.kind = 'order') execute function pos_order_guard();

-- ---------- 4. append-only audit log ----------
create table if not exists pos_audit (
  id          bigserial primary key,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  at          timestamptz not null default now(),
  actor       uuid,
  actor_role  text,
  action      text not null,
  kind        text not null,
  record_id   text not null,
  ref         text,
  amount      numeric(14,2),
  reason      text,
  approved_by text,
  outlet      text,
  before      jsonb,
  after       jsonb
);
create index if not exists pos_audit_tenant_at on pos_audit (tenant_id, at desc);
alter table pos_audit enable row level security;
drop policy if exists pos_audit_read on pos_audit;
create policy pos_audit_read on pos_audit for select
  using (me() is not null and tenant_id = (me()->>'tenant_id')::uuid and (me()->>'role') in ('owner', 'manager'));
grant select on pos_audit to app;

create or replace function pos_audit_block() returns trigger language plpgsql as $$
begin
  -- rows go only when their whole business is deleted (tenants -> on delete cascade); otherwise the log is append-only
  if exists (select 1 from tenants where id = old.tenant_id) then raise exception 'The audit log cannot be changed or deleted'; end if;
  return old;
end $$;
drop trigger if exists pos_audit_no_change on pos_audit;
create trigger pos_audit_no_change before update or delete on pos_audit for each row execute function pos_audit_block();

create or replace function pos_audit_add(n records, act text, ref text, amt numeric, why text, appr text, bef jsonb, aft jsonb) returns void language sql security definer set search_path = public as $$
  insert into pos_audit (tenant_id, actor, actor_role, action, kind, record_id, ref, amount, reason, approved_by, outlet, before, after)
  values (n.tenant_id, app_uid(), me()->>'role', act, n.kind, n.id, ref, round(amt, 2), left(why, 300), left(appr, 120), n.data->>'outlet', bef, aft)
$$;

-- changed keys only, with long values (a logo data URL) replaced by their length
create or replace function pos_changed_keys(o jsonb, n jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'before', coalesce((select jsonb_object_agg(k, case when length(coalesce(o->>k, '')) > 300 then to_jsonb('(' || length(o->>k) || ' characters)') else o->k end)
                          from (select k from jsonb_object_keys(case when jsonb_typeof(o) = 'object' then o else '{}' end) k
                                union select k from jsonb_object_keys(case when jsonb_typeof(n) = 'object' then n else '{}' end) k) ks
                         where o->k is distinct from n->k and o ? k), '{}'),
    'after',  coalesce((select jsonb_object_agg(k, case when length(coalesce(n->>k, '')) > 300 then to_jsonb('(' || length(n->>k) || ' characters)') else n->k end)
                          from (select k from jsonb_object_keys(case when jsonb_typeof(o) = 'object' then o else '{}' end) k
                                union select k from jsonb_object_keys(case when jsonb_typeof(n) = 'object' then n else '{}' end) k) ks
                         where o->k is distinct from n->k and n ? k), '{}'))
$$;

create or replace function pos_audit_records() returns trigger language plpgsql security definer set search_path = public as $$
declare o jsonb; d jsonb := new.data; st_o text; st_n text; e jsonb; ch jsonb; sent_o jsonb; sent_n jsonb; k text; nm text; q numeric;
  total numeric := pos_num(new.data->'t'->>'total'); ref text := new.data->>'no'; was_deleted boolean := false;
begin
  if tg_op = 'UPDATE' then o := old.data; was_deleted := old.deleted; end if;
  if new.kind = 'order' then
    st_o := coalesce(o->>'status', 'new'); st_n := coalesce(d->>'status', 'open');
    if new.deleted and not was_deleted then perform pos_audit_add(new, 'bill_delete', ref, total, null, null, null, null); end if;
    if st_n <> st_o then
      if st_n = 'paid' then perform pos_audit_add(new, 'bill_paid', ref, total, null, null, null, jsonb_build_object('pays', d->'pays'));
      elsif st_n = 'due' then perform pos_audit_add(new, 'bill_credit', ref, total, null, d->'creditApprovedBy'->>'name', null, jsonb_build_object('pays', d->'pays'));
      elsif st_n = 'void' then
        perform pos_audit_add(new, case when d ? 'mergedInto' then 'bill_merged' else 'bill_void' end, ref, total, coalesce(d->>'voidReason', d->>'mergedInto'),
                              d->'voidApprovedBy'->>'name', jsonb_build_object('status', st_o), null);
      end if;
    end if;
    for e in select x from jsonb_array_elements(case when jsonb_typeof(d->'refunds') = 'array' then d->'refunds' else '[]' end) x
             where not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(o->'refunds') = 'array' then o->'refunds' else '[]' end) y
                                where y->>'at' is not distinct from x->>'at' and y->>'amt' is not distinct from x->>'amt') loop
      perform pos_audit_add(new, 'refund', ref, pos_num(e->>'amt'), e->>'reason', e->'approvedBy'->>'name', null, e - 'approvedBy');
    end loop;
    for e in select x from jsonb_array_elements(case when jsonb_typeof(d->'exchanges') = 'array' then d->'exchanges' else '[]' end) x
             where not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(o->'exchanges') = 'array' then o->'exchanges' else '[]' end) y
                                where y->>'at' is not distinct from x->>'at' and y->>'amt' is not distinct from x->>'amt') loop
      perform pos_audit_add(new, 'return', ref, pos_num(e->>'amt'), e->>'reason', d->'returnApprovedBy'->>'name', null, e);
    end loop;
    if (d->'disc') is distinct from (o->'disc') and jsonb_typeof(d->'disc') = 'object' and st_n <> 'void' then
      perform pos_audit_add(new, 'discount', ref, pos_num(d->'t'->>'d'), coalesce(d->'disc'->>'reason', d->>'coupon'), d->'disc'->'approvedBy'->>'name',
                            jsonb_build_object('disc', (o->'disc') - 'approvedBy'), jsonb_build_object('disc', (d->'disc') - 'approvedBy'));
    end if;
    if coalesce(d->>'complimentary', 'false') = 'true' and coalesce(o->>'complimentary', 'false') <> 'true' then
      perform pos_audit_add(new, 'complimentary', ref, pos_num(d->'t'->>'sub'), d->>'compReason', d->'compApprovedBy'->>'name', null, null);
    end if;
    if tg_op = 'UPDATE' and coalesce(pos_num(d->>'printCount'), 0) > greatest(coalesce(pos_num(o->>'printCount'), 0), 1) then
      perform pos_audit_add(new, 'reprint', ref, total, null, null, null, jsonb_build_object('printCount', d->'printCount'));
    end if;
    if tg_op = 'UPDATE' and (d->>'table') is distinct from (o->>'table') and o->>'table' is not null and st_n <> 'void' then
      perform pos_audit_add(new, 'table_move', ref, null, null, null, jsonb_build_object('table', o->'table'), jsonb_build_object('table', d->'table'));
    end if;
    for e in select x from jsonb_array_elements(case when jsonb_typeof(d->'moves') = 'array' then d->'moves' else '[]' end) x
             where not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(o->'moves') = 'array' then o->'moves' else '[]' end) y where y->>'at' is not distinct from x->>'at') loop
      perform pos_audit_add(new, 'items_moved', ref, (select sum(coalesce(pos_num(i->>'q'), 0)) from jsonb_array_elements(case when jsonb_typeof(e->'items') = 'array' then e->'items' else '[]' end) i),
                            'to ' || coalesce(e->>'toNo', e->>'to', '?'), null, null, e);
    end loop;
    if tg_op = 'UPDATE' and st_n <> 'void' and not (d ? 'mergedInto') and not pos_moves_cover(o, d) then -- items cut after they reached the kitchen
      sent_o := pos_sent_by_key(o); sent_n := pos_sent_by_key(d);
      for k in select jsonb_object_keys(sent_o) loop
        q := coalesce(pos_num(sent_o->>k), 0) - coalesce(pos_num(sent_n->>k), 0);
        if q > 0 then
          select l->>'name' into nm from jsonb_array_elements(o->'lines') l where coalesce(l->>'id', '') || '|' || coalesce(l->>'size', '') || '|' || coalesce(l->>'note', '') = k limit 1;
          perform pos_audit_add(new, 'kot_cancel', ref, q, d->>'lastCancelReason', d->'lastCancelApprovedBy'->>'name',
                                jsonb_build_object('item', nm, 'sent', sent_o->k), jsonb_build_object('item', nm, 'sent', coalesce(sent_n->k, '0'::jsonb)));
        end if;
      end loop;
    end if;
  elsif new.kind = 'settings' then
    if tg_op = 'INSERT' or o is distinct from d then
      ch := pos_changed_keys(o, d);
      perform pos_audit_add(new, 'settings_change', null, null, null, null, ch->'before', ch->'after');
    end if;
  elsif new.kind = 'item' then
    if tg_op = 'INSERT' then perform pos_audit_add(new, 'item_add', d->>'name', pos_num(d->>'price'), null, null, null, jsonb_build_object('price', d->'price', 'sizes', d->'sizes'));
    elsif new.deleted and not was_deleted then perform pos_audit_add(new, 'item_delete', d->>'name', pos_num(d->>'price'), null, null, null, null);
    elsif (o->'price') is distinct from (d->'price') or (o->'sizes') is distinct from (d->'sizes') then
      perform pos_audit_add(new, 'price_change', d->>'name', pos_num(d->>'price'), null, null, jsonb_build_object('price', o->'price', 'sizes', o->'sizes'), jsonb_build_object('price', d->'price', 'sizes', d->'sizes'));
    end if;
  elsif new.kind in ('coupon', 'giftcard', 'tax') then
    if tg_op = 'INSERT' or o is distinct from d or new.deleted <> was_deleted then
      ch := pos_changed_keys(o, d);
      perform pos_audit_add(new, new.kind || case when tg_op = 'INSERT' then '_add' when new.deleted and not was_deleted then '_delete' else '_change' end,
                            coalesce(d->>'code', d->>'name'), coalesce(pos_num(d->>'bal'), pos_num(d->>'value'), pos_num(d->>'rate')), null, null, ch->'before', ch->'after');
    end if;
  elsif new.kind = 'cashmove' and tg_op = 'INSERT' then
    perform pos_audit_add(new, case when d->>'type' = 'out' then 'cash_out' else 'cash_in' end, null, pos_num(d->>'amt'), d->>'note', null, null, d);
  elsif new.kind = 'register' then
    if tg_op = 'INSERT' then
      perform pos_audit_add(new, 'register_open', d->>'name', pos_num(d->>'float'), null, null, null, jsonb_build_object('float', d->'float', 'by', d->'openedBy'));
    end if;
    if d->>'closedAt' is not null and (o is null or o->>'closedAt' is null) then
      perform pos_audit_add(new, 'register_close', d->>'name', pos_num(d->>'variance'), d->>'closeNote', null,
                            jsonb_build_object('expected', d->'expected'), jsonb_build_object('counted', d->'counted', 'variance', d->'variance'));
    end if;
  elsif new.kind = 'dayclose' then
    if tg_op = 'INSERT' then perform pos_audit_add(new, 'day_close', d->>'d', null, null, null, null, d);
    elsif new.deleted and not was_deleted then perform pos_audit_add(new, 'day_reopen', d->>'d', null, null, null, null, null);
    end if;
  end if;
  return null;
exception when others then
  -- never block a sale because the log could not be written; record that it failed instead
  begin
    insert into pos_audit (tenant_id, actor, actor_role, action, kind, record_id, reason) values (new.tenant_id, app_uid(), me()->>'role', 'audit_error', new.kind, new.id, left(sqlerrm, 300));
  exception when others then raise warning 'pos_audit failed: %', sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists records_audit on records;
create trigger records_audit after insert or update on records for each row
  when (new.kind in ('order', 'settings', 'item', 'coupon', 'giftcard', 'tax', 'cashmove', 'register', 'dayclose'))
  execute function pos_audit_records();

-- ---------- 5. KOT numbers per business day and outlet ----------
create table if not exists kot_counters (
  tenant_id uuid not null references tenants(id) on delete cascade,
  outlet    text not null default 'main',
  day       date not null,
  seq       int not null default 0,
  primary key (tenant_id, outlet, day)
);
alter table kot_counters enable row level security;

create or replace function next_kot_no(p_day date, p_outlet text) returns int language plpgsql security definer set search_path = public as $$
declare tid uuid := (me()->>'tenant_id')::uuid; n int;
begin
  if tid is null then raise exception 'not authorized'; end if;
  insert into kot_counters (tenant_id, outlet, day, seq) values (tid, coalesce(nullif(p_outlet, ''), 'main'), coalesce(p_day, current_date), 1)
    on conflict (tenant_id, outlet, day) do update set seq = kot_counters.seq + 1 returning seq into n;
  return n;
end $$;

-- ---------- 6. QR orders are accepted exactly once ----------
create or replace function claim_guest_order(p_id uuid, p_status text) returns boolean language plpgsql security definer set search_path = public as $$
declare tid uuid := (me()->>'tenant_id')::uuid;
begin
  if tid is null then raise exception 'not authorized'; end if;
  if coalesce(p_status, '') not in ('done', 'rejected') then raise exception 'Unknown status'; end if;
  update guest_orders set status = p_status where id = p_id and tenant_id = tid and status = 'new';
  return found;
end $$;

-- ---------- 7. gift-card tender ----------
create or replace function redeem_giftcard(p_code text, p_amount numeric, p_order text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := (me()->>'tenant_id')::uuid; rid text; g jsonb; bal numeric;
begin
  if tid is null then raise exception 'not authorized'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount'; end if;
  if coalesce(p_order, '') = '' then raise exception 'Missing bill'; end if;
  select id, data into rid, g from records where tenant_id = tid and kind = 'giftcard' and not deleted and upper(data->>'code') = upper(trim(coalesce(p_code, ''))) for update;
  if rid is null then raise exception 'No gift card with that code'; end if;
  if coalesce(g->>'exp', '') <> '' and pos_num(replace(g->>'exp', '-', '')) is not null and (g->>'exp')::date < current_date then
    raise exception 'This gift card expired on %', g->>'exp';
  end if;
  bal := coalesce(pos_num(g->>'bal'), 0);
  if exists (select 1 from jsonb_array_elements(case when jsonb_typeof(g->'uses') = 'array' then g->'uses' else '[]' end) u
              where u->>'order' = p_order and pos_num(u->>'amt') = p_amount) then
    return jsonb_build_object('ok', true, 'balance', bal, 'repeat', true, 'code', g->>'code');  -- the same tender sent twice (retry after a timeout)
  end if;
  if p_amount > bal then raise exception 'Only ₹% left on this card', bal; end if;
  update records set data = data || jsonb_build_object('bal', bal - p_amount,
           'uses', coalesce(case when jsonb_typeof(data->'uses') = 'array' then data->'uses' end, '[]') || jsonb_build_array(jsonb_build_object('order', p_order, 'amt', p_amount, 'at', now(), 'by', app_uid())))
   where tenant_id = tid and id = rid;
  return jsonb_build_object('ok', true, 'balance', bal - p_amount, 'code', g->>'code');
end $$;

-- ---------- 8. restaurant reservations on the bookings table ----------
alter table bookings add column if not exists party_size int;
alter table bookings add column if not exists note text;
alter table bookings add column if not exists source text;
alter table bookings add column if not exists outlet text;
alter table bookings drop constraint if exists bookings_status_check;
alter table bookings add constraint bookings_status_check check (status in ('pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'));
alter table bookings drop constraint if exists bookings_no_overlap;
alter table bookings add constraint bookings_no_overlap exclude using gist (
    tenant_id with =,
    resource_id with =,
    tsrange(start_ts, end_ts, '[)') with &&
  ) where (status not in ('cancelled', 'no_show', 'completed') and resource_id is not null and time is not null and end_time is not null);
