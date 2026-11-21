-- AUZslab SalesOS: incentive rules (brief's "expenses/incentives" module) + a visit-integrity
-- flag for manager review (anti-fraud, same spirit as sos_trial_verify_conversion's real-tenant
-- check -- a checkout that happens suspidiously fast after check-in is a real red flag worth
-- surfacing, not something to self-certify silently).
create table sos_incentive_rules (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  per_deal_amount numeric not null default 0 check (per_deal_amount >= 0),
  updated_by uuid references auth_users(id),
  updated_at timestamptz not null default now()
);
alter table sos_incentive_rules enable row level security;

create function sos_incentive_rule_set(p_per_deal_amount numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_manage'); row sos_incentive_rules%rowtype;
begin
  if p_per_deal_amount is null or p_per_deal_amount < 0 then raise exception 'Enter an amount of 0 or more'; end if;
  insert into sos_incentive_rules (tenant_id, per_deal_amount, updated_by) values (tid, p_per_deal_amount, app_uid())
  on conflict (tenant_id) do update set per_deal_amount = excluded.per_deal_amount, updated_by = excluded.updated_by, updated_at = now()
  returning * into row;
  perform sos_log('set', 'incentive_rule', null, jsonb_build_object('perDealAmount', p_per_deal_amount));
  return to_jsonb(row);
end $$;

create function sos_incentive_rule_get() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard(); row sos_incentive_rules%rowtype;
begin
  select * into row from sos_incentive_rules where tenant_id = tid;
  return jsonb_build_object('perDealAmount', coalesce(row.per_deal_amount, 0));
end $$;

-- own incentive earned this month = deals won this month x the flat per-deal rate.
-- A flat rate is deliberately the only scheme for a first build; a %-of-deal-value scheme
-- would need deal_value filled in reliably first, which it is not yet (optional field).
create function sos_my_incentive() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_field'); month_start date := date_trunc('month', current_date)::date; rate numeric; v_deals int;
begin
  select per_deal_amount into rate from sos_incentive_rules where tenant_id = tid;
  rate := coalesce(rate, 0);
  select count(*) into v_deals from sos_leads where tenant_id = tid and (owner_id = app_uid() or created_by = app_uid()) and stage = 'won' and updated_at >= month_start;
  return jsonb_build_object('dealsWon', v_deals, 'perDealAmount', rate, 'earned', v_deals * rate);
end $$;

-- visit integrity: a checkout under 2 minutes after check-in is flagged for review, computed
-- on read (not stored) so a change to the threshold needs no backfill.
create function sos_flagged_visits() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_manage');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'businessName', b.name, 'staffName', coalesce(p.name, u.email),
      'checkInAt', v.check_in_at, 'checkOutAt', v.check_out_at, 'seconds', extract(epoch from v.check_out_at - v.check_in_at),
      'reviewed', v.flag_reviewed_at is not null) order by v.check_in_at desc)
    from sos_visits v join sos_businesses b on b.id = v.business_id join auth_users u on u.id = v.staff_id left join profiles p on p.id = v.staff_id
    where v.tenant_id = tid and v.status = 'completed' and v.check_out_at is not null
      and v.check_out_at - v.check_in_at < interval '2 minutes'), '[]'::jsonb);
end $$;

alter table sos_visits add column flag_reviewed_at timestamptz;
alter table sos_visits add column flag_reviewed_by uuid references auth_users(id);
alter table sos_visits add column flag_note text;

create function sos_visit_mark_reviewed(p_id uuid, p_note text default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_manage');
begin
  update sos_visits set flag_reviewed_at = now(), flag_reviewed_by = app_uid(), flag_note = p_note where id = p_id and tenant_id = tid;
  if found then perform sos_log('review', 'visit', p_id, jsonb_build_object('note', p_note)); end if;
  return found;
end $$;

grant select, insert, update on sos_incentive_rules to app;
grant execute on function sos_incentive_rule_set(numeric) to app;
grant execute on function sos_incentive_rule_get() to app;
grant execute on function sos_my_incentive() to app;
grant execute on function sos_flagged_visits() to app;
grant execute on function sos_visit_mark_reviewed(uuid, text) to app;
