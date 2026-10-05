-- Renewal reminders. tenants.renewal_date already exists (db/006, set by an admin per client).
--   my_subscription()      any member of a business: plan, status, renewal date, days left, entitled products (apps show this).
--   renewal_notify_run()   called daily by the API (server/src/maintenance.js, NOT registered in the RPC allow-list): for each
--                          non-demo active business creates ONE in-app notification per stage (7, 3, 1 days, due today, expired) and
--                          one for the platform admin, and returns the owner email addresses so the API can email them.
create table if not exists renewal_notices (
  tenant_id    uuid not null references tenants(id) on delete cascade,
  renewal_date date not null,
  stage        text not null,
  created_at   timestamptz not null default now(),
  primary key (tenant_id, renewal_date, stage)
);
alter table renewal_notices enable row level security;   -- no policies: only the function below touches it

create or replace function my_subscription() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; r record;
begin
  if app_uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select p.tenant_id into tid from profiles p where p.id = app_uid();
  if tid is null then raise exception 'not a tenant member' using errcode = '42501'; end if;
  select t.name, t.slug, t.niche, t.plan, t.status, t.is_demo, t.monthly_fee, t.renewal_date,
         (t.renewal_date - current_date) as days_left,
         coalesce((select jsonb_agg(k order by k) from jsonb_each_text(coalesce(ts.features, '{}'::jsonb)) e(k, v) where v = 'true'), '[]'::jsonb) as products
    into r from tenants t left join tenant_settings ts on ts.tenant_id = t.id where t.id = tid;
  return jsonb_build_object('name', r.name, 'slug', r.slug, 'niche', r.niche, 'plan', r.plan, 'status', r.status, 'is_demo', r.is_demo,
    'monthly_fee', r.monthly_fee, 'renewal_date', r.renewal_date, 'days_left', r.days_left,
    'state', case when r.is_demo or r.renewal_date is null then 'active' when r.days_left < 0 then 'expired' when r.days_left <= 7 then 'due_soon' else 'active' end,
    'products', r.products);
end $$;

create or replace function renewal_notify_run() returns jsonb language plpgsql security definer set search_path = public as $$
declare t record; d int; stage text; out jsonb := '[]'::jsonb; fresh int; ttl text; msg text; emails text[];
begin
  for t in select id, name, renewal_date from tenants where not is_demo and status = 'active' and renewal_date is not null loop
    d := t.renewal_date - current_date;
    stage := case when d < 0 then 'expired' when d = 0 then 'd0' when d <= 1 then 'd1' when d <= 3 then 'd3' when d <= 7 then 'd7' else null end;
    continue when stage is null;
    insert into renewal_notices(tenant_id, renewal_date, stage) values (t.id, t.renewal_date, stage) on conflict do nothing;
    get diagnostics fresh = row_count;
    continue when fresh = 0;
    ttl := case stage when 'expired' then 'Your AUZslab plan has expired' when 'd0' then 'Your AUZslab plan ends today'
                      when 'd1' then 'Your AUZslab plan ends tomorrow' else 'Your AUZslab plan ends in ' || d || ' days' end;
    msg := 'Plan renewal date: ' || to_char(t.renewal_date, 'DD Mon YYYY') || '. Please renew to keep every app working. Open Plan & account in your app, or contact AUZslab.';
    insert into notifications(tenant_id, type, title, body, link) values (t.id, 'renewal', ttl, msg, 'https://auzslab.in/account.html#notifications');
    insert into notifications(tenant_id, type, title, body) values (null, 'renewal', t.name || ' - ' || replace(ttl, 'Your AUZslab plan', 'plan'), msg);
    select coalesce(array_agg(au.email), '{}') into emails from profiles p join auth_users au on au.id = p.id
     where p.tenant_id = t.id and p.role = 'owner' and au.deleted_at is null and au.email not like '%@staff.auzslab.in';
    out := out || jsonb_build_object('tenant', t.name, 'stage', stage, 'days', d, 'renewal_date', t.renewal_date, 'emails', to_jsonb(emails));
  end loop;
  return out;
end $$;
