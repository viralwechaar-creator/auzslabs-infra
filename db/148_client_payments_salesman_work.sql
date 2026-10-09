-- =========================================================
-- Admin panel: (1) client payments with UTR, (2) salesman work dashboard.
-- Payments are recorded by hand by the platform admin (UPI / bank transfer received outside the
-- Razorpay flow). A UTR can only be used once. Recording a payment for a salesman's trial also
-- ends its trial (is_trial = false): that is what "converted" means on the salesman dashboard.
-- RLS on, no policies, nothing granted: reachable only through the SECURITY DEFINER functions.
-- =========================================================
create table if not exists client_payments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  amount      numeric(12,2) not null check (amount > 0),
  paid_on     date not null default current_date,
  mode        text not null default 'upi' check (mode in ('upi','bank','cash','cheque','card','other')),
  utr         text,
  purpose     text,
  note        text,
  recorded_by uuid references auth_users(id),
  created_at  timestamptz not null default now()
);
alter table client_payments enable row level security;
create unique index if not exists client_payments_utr_idx on client_payments (lower(utr)) where utr is not null;
create index if not exists client_payments_tenant_idx on client_payments (tenant_id, paid_on desc);

create or replace function admin_add_client_payment(
  p_tenant_id uuid, p_amount numeric, p_paid_on date default current_date, p_mode text default 'upi',
  p_utr text default null, p_purpose text default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid uuid; u text := nullif(btrim(coalesce(p_utr, '')), '');
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if not exists (select 1 from tenants where id = p_tenant_id) then raise exception 'unknown client'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'enter the amount received'; end if;
  if p_mode in ('upi','bank') and u is null then raise exception 'enter the UTR / reference number for a UPI or bank payment'; end if;
  if u is not null and exists (select 1 from client_payments where lower(utr) = lower(u)) then
    raise exception 'that UTR is already recorded';
  end if;
  insert into client_payments (tenant_id, amount, paid_on, mode, utr, purpose, note, recorded_by)
    values (p_tenant_id, p_amount, coalesce(p_paid_on, current_date), coalesce(p_mode, 'upi'), u,
            nullif(btrim(coalesce(p_purpose, '')), ''), nullif(btrim(coalesce(p_note, '')), ''), app_uid())
    returning id into pid;
  update tenants set is_trial = false where id = p_tenant_id and is_trial;
  perform admin_log('client_payment_add', 'tenant', p_tenant_id::text, jsonb_build_object('amount', p_amount, 'utr', u, 'mode', p_mode));
  return jsonb_build_object('id', pid);
end $$;

create or replace function admin_list_client_payments(p_tenant_id uuid default null) returns jsonb
language plpgsql security definer stable set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(x order by x.paid_on desc, x.created_at desc) from (
    select p.id, p.tenant_id, t.name as client, t.slug, p.amount, p.paid_on, p.mode, p.utr, p.purpose, p.note, p.created_at
    from client_payments p join tenants t on t.id = p.tenant_id
    where p_tenant_id is null or p.tenant_id = p_tenant_id
    order by p.paid_on desc, p.created_at desc limit 500
  ) x), '[]'::jsonb);
end $$;

create or replace function admin_delete_client_payment(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r client_payments;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  delete from client_payments where id = p_id returning * into r;
  if r.id is not null then
    perform admin_log('client_payment_delete', 'tenant', r.tenant_id::text, jsonb_build_object('amount', r.amount, 'utr', r.utr));
  end if;
end $$;

-- Salesman work: one object per salesman, with their prospects. p_days = 0 means all time.
create or replace function admin_salesman_work(p_days int default 0) returns jsonb
language plpgsql security definer stable set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(s_row order by (s_row->>'created')::int desc) from (
    select jsonb_build_object(
      'id', s.id, 'name', coalesce(s.name, u.email), 'email', u.email, 'active', s.active,
      'created', (select count(*) from tenants t where t.created_by_salesman = s.id
                  and (coalesce(p_days,0) = 0 or t.created_at >= now() - make_interval(days => p_days))),
      'converted', (select count(*) from tenants t where t.created_by_salesman = s.id and not t.is_trial
                  and (coalesce(p_days,0) = 0 or t.created_at >= now() - make_interval(days => p_days))),
      'paid_total', coalesce((select sum(cp.amount) from client_payments cp join tenants t on t.id = cp.tenant_id
                  where t.created_by_salesman = s.id
                  and (coalesce(p_days,0) = 0 or cp.paid_on >= current_date - p_days)), 0),
      'last_activity', (select max(t.created_at) from tenants t where t.created_by_salesman = s.id),
      'prospects', coalesce((select jsonb_agg(jsonb_build_object(
          'id', t.id, 'name', t.name, 'slug', t.slug, 'niche', t.niche, 'created_at', t.created_at,
          'status', case when not t.is_trial then 'converted' else 'trial' end,
          'has_owner', exists(select 1 from profiles p where p.tenant_id = t.id and p.role = 'owner'),
          'paid', coalesce((select sum(cp.amount) from client_payments cp where cp.tenant_id = t.id), 0)
        ) order by t.created_at desc)
        from tenants t where t.created_by_salesman = s.id
        and (coalesce(p_days,0) = 0 or t.created_at >= now() - make_interval(days => p_days))), '[]'::jsonb)
    ) as s_row
    from platform_salesmen s join auth_users u on u.id = s.id
  ) q), '[]'::jsonb);
end $$;
