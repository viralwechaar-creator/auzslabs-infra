-- Admin -> System resources -> "What each client costs us": editable cost settings + per-client usage figures.
-- Read/write by the platform admin only. Money is plain rupees per month. Nothing here changes any client's data.
insert into platform_flags (key, value) values ('cost_settings',
  '{"server":2150,"failover":0,"other":0,"wa_utility":0.12,"wa_marketing":0.78,"razorpay_pct":2,"w_requests":50,"w_data":30,"w_files":20}')
on conflict (key) do nothing;

create or replace function admin_cost_settings() returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return (select value::jsonb from platform_flags where key = 'cost_settings');
end $$;

create or replace function admin_set_cost_settings(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare cur jsonb; k text; v numeric;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select value::jsonb into cur from platform_flags where key = 'cost_settings';
  foreach k in array array['server','failover','other','wa_utility','wa_marketing','razorpay_pct','w_requests','w_data','w_files'] loop
    if p ? k then
      begin v := (p->>k)::numeric; exception when others then raise exception '% must be a number', k; end;
      if v < 0 or v > 10000000 then raise exception '% is out of range', k; end if;
      cur := cur || jsonb_build_object(k, v);
    end if;
  end loop;
  update platform_flags set value = cur::text, updated_at = now() where key = 'cost_settings';
  insert into platform_flags (key, value) select 'cost_settings', cur::text where not exists (select 1 from platform_flags where key = 'cost_settings');
  return cur;
end $$;

-- One row per client: what they pay, how much data they hold, WhatsApp messages and online payments in the last 30 days.
create or replace function admin_client_usage() returns jsonb language plpgsql security definer set search_path = public as $$
declare mkt text[] := array['membership_expiry','anniversary_greeting','birthday_greeting','lapsed_client','style_winback','style_abandoned_bag','review_request'];
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return jsonb_build_object(
    'clients', (
      with rowc as (
        select tenant_id, sum(n) n from (
          select tenant_id, count(*) n from records group by tenant_id
          union all select tenant_id, count(*) from guest_orders group by tenant_id
          union all select tenant_id, count(*) from bookings group by tenant_id
          union all select tenant_id, count(*) from sty_sales group by tenant_id
          union all select tenant_id, count(*) from acc_documents group by tenant_id
          union all select tenant_id, count(*) from mob_sales group by tenant_id) u group by tenant_id),
      wa as (
        select tenant_id,
          count(*) filter (where template <> all (mkt)) util,
          count(*) filter (where template = any (mkt)) marketing
        from wa_outbox
        where sender = 'platform' and status in ('sent','delivered','read') and created_at > now() - interval '30 days' and tenant_id is not null
        group by tenant_id),
      pay as (
        select coalesce(co.tenant_id, pr.tenant_id) tenant_id, sum(p.amount) amt
        from payments p
        left join client_orders co on co.id = p.client_order_id
        left join profiles pr on pr.id = p.user_id
        where p.status = 'paid' and p.paid_at > now() - interval '30 days'
        group by 1)
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'slug', t.slug, 'name', t.name, 'fee', coalesce(t.monthly_fee, 0), 'status', t.status, 'is_demo', coalesce(t.is_demo, false),
        'rows', coalesce(rowc.n, 0), 'wa_util', coalesce(wa.util, 0), 'wa_marketing', coalesce(wa.marketing, 0), 'online_paid', coalesce(pay.amt, 0)
      ) order by t.name), '[]'::jsonb)
      from tenants t
      left join rowc on rowc.tenant_id = t.id
      left join wa on wa.tenant_id = t.id
      left join pay on pay.tenant_id = t.id),
    'own_messages', (select count(*) from wa_outbox where tenant_id is null and status in ('sent','delivered','read') and created_at > now() - interval '30 days')
  );
end $$;
