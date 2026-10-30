-- AUZsStyle: GST number lookup for customers and suppliers, switched on per business by the admin (db/306).
-- 1. Customers can hold a GST number and an address (they were name / phone / size / dates only).
-- 2. New plan limit 'gst_lookup' = the admin allowed "fetch details from GST number" for this business. It is OFF until the admin ticks it
--    (unlike the other limits, which are on unless switched off): tenant_cap_on() is true only for an explicit true.
-- 3. gst_lookup_allowed() (used by POST /gst/lookup) refuses an AUZsStyle business that has not been allowed.
alter table sty_customers add column if not exists gstin text, add column if not exists address text;

create or replace function tenant_cap_on(p_tenant uuid, p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select ts.caps ->> p_key from tenant_settings ts where ts.tenant_id = p_tenant), 'false') = 'true'
$$;

create or replace function admin_set_tenant_caps(p_tenant_id uuid, p_caps jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_slug text; v_clean jsonb := '{}'::jsonb; k text;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  for k in select jsonb_object_keys(coalesce(p_caps, '{}'::jsonb)) loop
    if k in ('online_store', 'images', 'whatsapp', 'multi_pictures', 'gst_lookup') then v_clean := v_clean || jsonb_build_object(k, (p_caps ->> k) = 'true'); end if;
  end loop;
  update tenant_settings set caps = v_clean where tenant_id = p_tenant_id;
  if not found then raise exception 'tenant not found'; end if;
  select slug into v_slug from tenants where id = p_tenant_id;
  perform admin_log('set_tenant_caps', 'tenant', p_tenant_id::text, jsonb_build_object('slug', v_slug, 'caps', v_clean));
end $$;

create or replace function gst_lookup_allowed() returns uuid language plpgsql stable security definer set search_path = public as $$
declare t uuid; is_style boolean := false;
begin
  begin t := acc_guard('acc_sales'); exception when others then t := null; end;
  if t is null then
    begin t := fin_guard('write'); exception when others then t := null; end;
  end if;
  if t is null then
    begin t := sty_guard('sty_view'); exception when others then t := null; end;
  end if;
  if t is null then return null; end if;
  select coalesce((features ->> 'style') = 'true', false) into is_style from tenant_settings where tenant_id = t;
  if is_style and not tenant_cap_on(t, 'gst_lookup') then return null; end if;
  return t;
end $$;

create or replace function sty_save_customer(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cid uuid; ph text;
begin
  tid := sty_guard('sty_sell');
  cid := nullif(p->>'id', '')::uuid; ph := nullif(regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g'), '');
  if ph is not null and length(ph) > 10 then ph := right(ph, 10); end if;
  if cid is null and ph is not null then select id into cid from sty_customers where tenant_id = tid and phone = ph; end if;
  if cid is null then
    insert into sty_customers (id, tenant_id, name, phone, usual_size, birthday, anniversary, notes, gender, city, wa_optin, gstin, address)
    values (coalesce(nullif(p->>'newId', '')::uuid, gen_random_uuid()), tid, coalesce(nullif(trim(p->>'name'), ''), 'Customer'), ph, p->>'usualSize', nullif(p->>'birthday', '')::date, nullif(p->>'anniversary', '')::date, p->>'notes',
            nullif(p->>'gender', ''), nullif(trim(coalesce(p->>'city', '')), ''), coalesce((p->>'waOptin')::boolean, true), nullif(upper(trim(coalesce(p->>'gstin', ''))), ''), nullif(trim(coalesce(p->>'address', '')), '')) returning id into cid;
  else
    update sty_customers set name = coalesce(nullif(trim(p->>'name'), ''), name), phone = coalesce(ph, phone), usual_size = case when p ? 'usualSize' then p->>'usualSize' else usual_size end,
      birthday = case when p ? 'birthday' then nullif(p->>'birthday', '')::date else birthday end,
      anniversary = case when p ? 'anniversary' then nullif(p->>'anniversary', '')::date else anniversary end,
      notes = case when p ? 'notes' then p->>'notes' else notes end,
      gender = case when p ? 'gender' then nullif(p->>'gender', '') else gender end,
      city = case when p ? 'city' then nullif(trim(coalesce(p->>'city', '')), '') else city end,
      wa_optin = case when p ? 'waOptin' then coalesce((p->>'waOptin')::boolean, true) else wa_optin end,
      gstin = case when p ? 'gstin' then nullif(upper(trim(coalesce(p->>'gstin', ''))), '') else gstin end,
      address = case when p ? 'address' then nullif(trim(coalesce(p->>'address', '')), '') else address end
    where id = cid and tenant_id = tid;
  end if;
  return (select jsonb_build_object('id', id, 'name', name, 'phone', phone, 'usualSize', usual_size, 'points', points, 'credit', credit, 'birthday', birthday) from sty_customers where id = cid);
end $$;

create or replace function sty_crm_list(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; q text := nullif(trim(coalesce(p->>'q', '')), ''); seg text := nullif(p->>'segment', ''); lim int := least(coalesce((p->>'limit')::int, 300), 1000);
begin
  tid := sty_guard('sty_view');
  return coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('id', r.id, 'name', r.name, 'phone', r.phone, 'usualSize', r.usual_size, 'gstin', r.gstin, 'address', r.address, 'birthday', r.birthday, 'anniversary', r.anniversary, 'notes', r.notes,
      'gender', r.gender, 'city', r.city, 'waOptin', r.wa_optin, 'points', r.points, 'credit', r.credit, 'visits', r.visits, 'spent', r.spent, 'lastAt', r.last_at,
      'tier', r.tier, 'status', r.status) x
    from sty_crm_rows(tid) r
    where (q is null or r.name ilike '%' || q || '%' or r.phone like '%' || q || '%')
      and (seg is null or seg = 'all' or r.status = seg or r.tier = initcap(seg) or (seg = 'credit' and r.credit > 0) or (seg = 'points' and r.points > 0))
    order by r.spent desc, r.created_at desc limit lim) q), '[]'::jsonb);
end $$;

create or replace function sty_customer_detail(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; row_ record;
begin
  tid := sty_guard('sty_view');
  select * into row_ from sty_crm_rows(tid) r where r.id = p_id;
  if not found then raise exception 'customer not found' using errcode = 'ST002'; end if;
  return jsonb_build_object(
    'id', row_.id, 'name', row_.name, 'phone', row_.phone, 'usualSize', row_.usual_size, 'gstin', row_.gstin, 'address', row_.address, 'birthday', row_.birthday, 'anniversary', row_.anniversary, 'notes', row_.notes,
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
-- Rollback: create or replace gst_lookup_allowed() from db/283 and admin_set_tenant_caps() from db/259; drop function tenant_cap_on(uuid,text).
