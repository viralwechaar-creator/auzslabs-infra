-- AUZsStyle: CRM (segments, tiers, follow-ups, customer detail) and WhatsApp automation
-- (bill link on every bill, birthday / anniversary greetings, win-back). Messages go through wa_enqueue,
-- so they only leave when the platform admin allowed the shop AND the shop owner turned WhatsApp on.
alter table sty_customers add column if not exists gender text;
alter table sty_customers add column if not exists city text;
alter table sty_customers add column if not exists wa_optin boolean not null default true;

create or replace function sty_save_customer(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cid uuid; ph text;
begin
  tid := sty_guard('sty_sell');
  cid := nullif(p->>'id', '')::uuid; ph := nullif(regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g'), '');
  if ph is not null and length(ph) > 10 then ph := right(ph, 10); end if;
  if cid is null and ph is not null then select id into cid from sty_customers where tenant_id = tid and phone = ph; end if;
  if cid is null then
    insert into sty_customers (tenant_id, name, phone, usual_size, birthday, anniversary, notes, gender, city, wa_optin)
    values (tid, coalesce(nullif(trim(p->>'name'), ''), 'Customer'), ph, p->>'usualSize', nullif(p->>'birthday', '')::date, nullif(p->>'anniversary', '')::date, p->>'notes',
            nullif(p->>'gender', ''), nullif(trim(coalesce(p->>'city', '')), ''), coalesce((p->>'waOptin')::boolean, true)) returning id into cid;
  else
    update sty_customers set name = coalesce(nullif(trim(p->>'name'), ''), name), phone = coalesce(ph, phone), usual_size = case when p ? 'usualSize' then p->>'usualSize' else usual_size end,
      birthday = case when p ? 'birthday' then nullif(p->>'birthday', '')::date else birthday end,
      anniversary = case when p ? 'anniversary' then nullif(p->>'anniversary', '')::date else anniversary end,
      notes = case when p ? 'notes' then p->>'notes' else notes end,
      gender = case when p ? 'gender' then nullif(p->>'gender', '') else gender end,
      city = case when p ? 'city' then nullif(trim(coalesce(p->>'city', '')), '') else city end,
      wa_optin = case when p ? 'waOptin' then coalesce((p->>'waOptin')::boolean, true) else wa_optin end
    where id = cid and tenant_id = tid;
  end if;
  return (select jsonb_build_object('id', id, 'name', name, 'phone', phone, 'usualSize', usual_size, 'points', points, 'credit', credit, 'birthday', birthday) from sty_customers where id = cid);
end $$;

-- one row per customer with spend, visits and the CRM labels
create or replace function sty_crm_rows(tid uuid) returns table (
  id uuid, name text, phone text, usual_size text, birthday date, anniversary date, notes text, gender text, city text, wa_optin boolean,
  points int, credit numeric, created_at timestamptz, visits bigint, spent numeric, last_at timestamptz, tier text, status text)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.phone, c.usual_size, c.birthday, c.anniversary, c.notes, c.gender, c.city, c.wa_optin, c.points, c.credit, c.created_at,
    coalesce(s.visits, 0), coalesce(s.spent, 0), s.last_at,
    case when coalesce(s.spent, 0) >= 10000 then 'Gold' when coalesce(s.spent, 0) >= 3000 then 'Silver' else 'Member' end,
    case when s.last_at is null then 'new'
         when s.last_at < now() - interval '60 days' then 'lapsed'
         when coalesce(s.visits, 0) <= 1 then 'new' else 'regular' end
  from sty_customers c
  left join lateral (select count(*) visits, sum(total) spent, max(at) last_at from sty_sales x where x.customer_id = c.id and x.status <> 'void') s on true
  where c.tenant_id = tid
$$;
revoke all on function sty_crm_rows(uuid) from public;

create or replace function sty_crm_list(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; q text := nullif(trim(coalesce(p->>'q', '')), ''); seg text := nullif(p->>'segment', ''); lim int := least(coalesce((p->>'limit')::int, 300), 1000);
begin
  tid := sty_guard('sty_view');
  return coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('id', r.id, 'name', r.name, 'phone', r.phone, 'usualSize', r.usual_size, 'birthday', r.birthday, 'anniversary', r.anniversary, 'notes', r.notes,
      'gender', r.gender, 'city', r.city, 'waOptin', r.wa_optin, 'points', r.points, 'credit', r.credit, 'visits', r.visits, 'spent', r.spent, 'lastAt', r.last_at,
      'tier', r.tier, 'status', r.status) x
    from sty_crm_rows(tid) r
    where (q is null or r.name ilike '%' || q || '%' or r.phone like '%' || q || '%')
      and (seg is null or seg = 'all' or r.status = seg or r.tier = initcap(seg) or (seg = 'credit' and r.credit > 0) or (seg = 'points' and r.points > 0))
    order by r.spent desc, r.created_at desc limit lim) q), '[]'::jsonb);
end $$;

create or replace function sty_crm_overview() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  tid := sty_guard('sty_view');
  return (
    with r as (select * from sty_crm_rows(tid)),
    ev as (
      select id, name, phone, 'birthday' kind, birthday d,
        (make_date(extract(year from today)::int, extract(month from birthday)::int, least(extract(day from birthday)::int, 28)) + case when (extract(month from birthday), extract(day from birthday)) < (extract(month from today), extract(day from today)) then interval '1 year' else interval '0' end)::date nxt
        from r where birthday is not null
      union all
      select id, name, phone, 'anniversary', anniversary,
        (make_date(extract(year from today)::int, extract(month from anniversary)::int, least(extract(day from anniversary)::int, 28)) + case when (extract(month from anniversary), extract(day from anniversary)) < (extract(month from today), extract(day from today)) then interval '1 year' else interval '0' end)::date
        from r where anniversary is not null)
    select jsonb_build_object(
      'total', (select count(*) from r), 'newCount', (select count(*) from r where status = 'new'), 'regular', (select count(*) from r where status = 'regular'),
      'lapsed', (select count(*) from r where status = 'lapsed'), 'gold', (select count(*) from r where tier = 'Gold'), 'silver', (select count(*) from r where tier = 'Silver'),
      'withPhone', (select count(*) from r where phone is not null), 'points', (select coalesce(sum(points), 0) from r), 'credit', (select coalesce(sum(credit), 0) from r),
      'upcoming', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'phone', phone, 'kind', kind, 'on', nxt, 'days', nxt - today) order by nxt) from ev where nxt - today <= 30), '[]'::jsonb),
      'lapsedList', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'phone', phone, 'lastAt', last_at, 'spent', spent) order by spent desc) from (select * from r where status = 'lapsed' order by spent desc limit 40) z), '[]'::jsonb),
      'top', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'spent', spent, 'visits', visits, 'tier', tier)) from (select * from r where spent > 0 order by spent desc limit 8) z), '[]'::jsonb))
  );
end $$;

create or replace function sty_customer_detail(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; row_ record;
begin
  tid := sty_guard('sty_view');
  select * into row_ from sty_crm_rows(tid) r where r.id = p_id;
  if not found then raise exception 'customer not found' using errcode = 'ST002'; end if;
  return jsonb_build_object(
    'id', row_.id, 'name', row_.name, 'phone', row_.phone, 'usualSize', row_.usual_size, 'birthday', row_.birthday, 'anniversary', row_.anniversary, 'notes', row_.notes,
    'gender', row_.gender, 'city', row_.city, 'waOptin', row_.wa_optin, 'points', row_.points, 'credit', row_.credit, 'visits', row_.visits, 'spent', row_.spent,
    'lastAt', row_.last_at, 'tier', row_.tier, 'status', row_.status,
    'avgBill', case when row_.visits > 0 then round(row_.spent / row_.visits, 2) else 0 end,
    'due', coalesce((select sum(total - paid) from sty_sales where customer_id = p_id and tenant_id = tid and status = 'due'), 0),
    'bills', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'number', number, 'at', at, 'total', total, 'status', status) order by at desc) from (select * from sty_sales where customer_id = p_id and tenant_id = tid order by at desc limit 8) b), '[]'::jsonb),
    'likes', coalesce((select jsonb_agg(jsonb_build_object('name', n, 'qty', q) order by q desc) from (
        select l.style_name n, sum(l.qty) q from sty_sale_lines l join sty_sales s on s.id = l.sale_id where s.customer_id = p_id and s.tenant_id = tid and s.status <> 'void' group by l.style_name order by 2 desc limit 4) z), '[]'::jsonb),
    'sizes', coalesce((select jsonb_agg(jsonb_build_object('name', n, 'qty', q) order by q desc) from (
        select l.size n, sum(l.qty) q from sty_sale_lines l join sty_sales s on s.id = l.sale_id where s.customer_id = p_id and s.tenant_id = tid and s.status <> 'void' and l.size is not null group by l.size order by 2 desc limit 3) z), '[]'::jsonb),
    'colours', coalesce((select jsonb_agg(jsonb_build_object('name', n, 'qty', q) order by q desc) from (
        select l.colour n, sum(l.qty) q from sty_sale_lines l join sty_sales s on s.id = l.sale_id where s.customer_id = p_id and s.tenant_id = tid and s.status <> 'void' and l.colour is not null group by l.colour order by 2 desc limit 3) z), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('template', template, 'status', status, 'at', created_at) order by created_at desc) from (
        select o.template, o.status, o.created_at from wa_outbox o where o.tenant_id = tid and o.to_phone = wa_norm_phone(row_.phone) order by o.created_at desc limit 6) m), '[]'::jsonb));
end $$;

-- ---------- WhatsApp automation ----------
-- store-friendly win-back wording (the salon one talks about appointments); create it in WhatsApp Manager as auzslab_style_winback
insert into wa_templates (key, name, audience, title, body, params) values
  ('style_winback', 'auzslab_style_winback', 'shop', 'We miss you (store)',
   'Hi {{1}}, it has been a while since your last visit to {{2}}. Come and see what is new in store, we would love to see you again.', '{customer,shop}')
on conflict (key) do update set name = excluded.name, audience = excluded.audience, title = excluded.title, body = excluded.body, params = excluded.params;

-- 1. the bill link goes to the customer the moment a bill is saved
create or replace function wa_sty_bill_msg() returns trigger language plpgsql security definer set search_path = public as $$
declare shop text; c sty_customers; tok text; link text;
begin
  begin
    if new.customer_id is null or new.status = 'void' then return new; end if;
    select * into c from sty_customers where id = new.customer_id;
    if not found or c.phone is null or c.phone = '' or not c.wa_optin then return new; end if;
    select name into shop from tenants where id = new.tenant_id;
    tok := new.share_token;
    if tok is null then
      update sty_sales set share_token = substr(replace(gen_random_uuid()::text, '-', ''), 1, 10) where id = new.id and share_token is null returning share_token into tok;
      if tok is null then select share_token into tok from sty_sales where id = new.id; end if;
    end if;
    link := wa_tenant_link(new.tenant_id, '/b/' || tok);
    if link is null then return new; end if;
    perform wa_enqueue(new.tenant_id, c.phone, 'invoice_link',
      jsonb_build_array(split_part(c.name, ' ', 1), coalesce(shop, 'us'), coalesce(new.number, ''), wa_money(new.total), link), new.id || '-bill');
  exception when others then null;
  end;
  return new;
end $$;
drop trigger if exists sty_sales_wa on sty_sales;
create trigger sty_sales_wa after insert on sty_sales for each row execute function wa_sty_bill_msg();

-- 2. daily: birthday and anniversary greetings, win-back for customers who stopped coming
create or replace function sty_wa_daily_run() returns jsonb language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date; rec record; n_b int := 0; n_a int := 0; n_l int := 0; id_ uuid; bucket bigint := floor(extract(epoch from now()) / (60 * 86400));
begin
  for rec in select cu.id, cu.tenant_id, cu.name, cu.phone, cu.birthday, cu.anniversary, t.name shop from sty_customers cu join tenants t on t.id = cu.tenant_id
           where cu.phone is not null and cu.wa_optin and (cu.birthday is not null or cu.anniversary is not null) loop
    begin
      if rec.birthday is not null and extract(month from rec.birthday) = extract(month from today) and extract(day from rec.birthday) = extract(day from today) then
        id_ := wa_enqueue(rec.tenant_id, rec.phone, 'birthday_greeting', jsonb_build_array(split_part(rec.name, ' ', 1), rec.shop), rec.id || '-bday-' || extract(year from today));
        if id_ is not null then n_b := n_b + 1; end if;
      end if;
      if rec.anniversary is not null and extract(month from rec.anniversary) = extract(month from today) and extract(day from rec.anniversary) = extract(day from today) then
        id_ := wa_enqueue(rec.tenant_id, rec.phone, 'anniversary_greeting', jsonb_build_array(split_part(rec.name, ' ', 1), rec.shop), rec.id || '-anni-' || extract(year from today));
        if id_ is not null then n_a := n_a + 1; end if;
      end if;
    exception when others then null;
    end;
  end loop;
  for rec in select r.id, t.id tenant_id, r.name, r.phone, t.name shop from tenants t
           join lateral sty_crm_rows(t.id) r on true
           where r.status = 'lapsed' and r.phone is not null and r.wa_optin and r.spent > 0 and r.last_at > now() - interval '180 days'
             and exists (select 1 from wa_tenant_settings w where w.tenant_id = t.id and w.enabled) loop
    begin
      id_ := wa_enqueue(rec.tenant_id, rec.phone, 'style_winback', jsonb_build_array(split_part(rec.name, ' ', 1), rec.shop), rec.id || '-lapsed-' || bucket);
      if id_ is not null then n_l := n_l + 1; end if;
    exception when others then null;
    end;
  end loop;
  return jsonb_build_object('birthday', n_b, 'anniversary', n_a, 'lapsed', n_l);
end $$;
revoke all on function sty_wa_daily_run() from public;
