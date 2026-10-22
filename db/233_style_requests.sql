-- =========================================================
-- AUZsStyle: on-demand requests. A customer asks for a piece the shop does not have (or not in their size). Staff note it
-- at the till; the owner is told straight away; the customer is told when it has been ordered and when it is in stock.
-- A request also counts as lost-demand evidence in the buying analytics (db/234). Additive migration.
-- =========================================================
create table if not exists sty_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid references sty_customers(id) on delete set null,
  name text, phone text,
  style_id uuid references sty_styles(id) on delete set null,
  variant_id uuid references sty_variants(id) on delete set null,
  description text not null,
  colour text, size text,
  qty integer not null default 1 check (qty between 1 and 500),
  status text not null default 'open' check (status in ('open', 'ordered', 'arrived', 'fulfilled', 'cancelled')),
  staff_note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ordered_notified_at timestamptz, arrived_notified_at timestamptz
);
create index if not exists sty_requests_t on sty_requests (tenant_id, status, created_at);
create index if not exists sty_requests_v on sty_requests (variant_id) where variant_id is not null;
alter table sty_requests enable row level security;

insert into wa_templates (key, name, audience, title, body, params) values
  ('style_request_ordered', 'auzslab_style_request_ordered', 'shop', 'Your request is ordered',
   'Hi {{1}}, good news from {{2}}: we have ordered {{3}} for you. We will message you the moment it arrives. Thank you for your patience.', '{customer,shop,item}'),
  ('style_request_ready', 'auzslab_style_request_ready', 'shop', 'Your request is in stock',
   'Hi {{1}}, {{3}} that you asked {{2}} for is now in stock. Please visit us to see it, we are keeping it aside for you. See you soon.', '{customer,shop,item}')
on conflict (key) do update set name = excluded.name, audience = excluded.audience, title = excluded.title, body = excluded.body, params = excluded.params;

create or replace function sty_request_json(r sty_requests) returns jsonb language sql stable as $$
  select jsonb_build_object('id', r.id, 'name', r.name, 'phone', r.phone, 'styleId', r.style_id, 'variantId', r.variant_id, 'description', r.description,
    'colour', r.colour, 'size', r.size, 'qty', r.qty, 'status', r.status, 'staffNote', r.staff_note, 'createdAt', r.created_at, 'updatedAt', r.updated_at,
    'styleName', (select name from sty_styles where id = r.style_id))
$$;

-- p: {id?, name, phone, description, styleId?, variantId?, colour?, size?, qty?}
create or replace function sty_request_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; rid uuid := nullif(p->>'id', '')::uuid; ph text := right(regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g'), 10); r sty_requests; sid uuid; vid uuid; cid uuid; shop text;
begin
  tid := sty_guard('sty_sell');
  if length(trim(coalesce(p->>'description', ''))) < 2 then raise exception 'Write what the customer is asking for' using errcode = 'ST002'; end if;
  if ph <> '' and length(ph) <> 10 then raise exception 'Enter a 10 digit phone number, or leave it empty' using errcode = 'ST002'; end if;
  sid := nullif(p->>'styleId', '')::uuid; vid := nullif(p->>'variantId', '')::uuid;
  if sid is not null and not exists (select 1 from sty_styles where id = sid and tenant_id = tid) then raise exception 'style not found' using errcode = 'ST002'; end if;
  if vid is not null then
    select style_id into sid from sty_variants where id = vid and tenant_id = tid;
    if sid is null then raise exception 'item not found' using errcode = 'ST002'; end if;
  end if;
  if ph <> '' then select id into cid from sty_customers where tenant_id = tid and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = ph limit 1; end if;
  if rid is null then
    insert into sty_requests (tenant_id, customer_id, name, phone, style_id, variant_id, description, colour, size, qty, created_by)
    values (tid, cid, left(nullif(trim(p->>'name'), ''), 80), nullif(ph, ''), sid, vid, left(trim(p->>'description'), 240), left(nullif(trim(p->>'colour'), ''), 40), left(nullif(trim(p->>'size'), ''), 20),
      greatest(1, least(coalesce((p->>'qty')::int, 1), 500)), app_uid()) returning * into r;
    begin
      select coalesce(nullif(shop_name, ''), (select name from tenants where id = tid)) into shop from sty_settings where tenant_id = tid;
      insert into notifications (tenant_id, type, title, body) values (tid, 'style_request', 'Customer request: ' || r.description,
        coalesce(r.name, 'A customer') || coalesce(' (' || r.phone || ')', '') || ' asked for something we do not have. Order it, then mark the request as ordered.');
      perform pg_notify('push_events', jsonb_build_object('tenant_id', tid, 'title', 'Customer request', 'body', left(r.description, 80) || coalesce(' · ' || r.name, ''), 'url', '/style.html#/requests')::text);
    exception when others then null; end;
  else
    update sty_requests set name = case when p ? 'name' then left(nullif(trim(p->>'name'), ''), 80) else name end, phone = case when p ? 'phone' then nullif(ph, '') else phone end,
      description = coalesce(left(nullif(trim(p->>'description'), ''), 240), description), colour = case when p ? 'colour' then left(nullif(trim(p->>'colour'), ''), 40) else colour end,
      size = case when p ? 'size' then left(nullif(trim(p->>'size'), ''), 20) else size end, qty = coalesce(greatest(1, least((p->>'qty')::int, 500)), qty),
      style_id = case when p ? 'styleId' then sid else style_id end, variant_id = case when p ? 'variantId' then vid else variant_id end, updated_at = now()
    where id = rid and tenant_id = tid returning * into r;
    if not found then raise exception 'request not found' using errcode = 'ST002'; end if;
  end if;
  perform sty_audit_log(tid, 'request.save', r.id::text, jsonb_build_object('d', r.description));
  return sty_request_json(r);
end $$;

create or replace function sty_requests_list(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; st text := nullif(p->>'status', '');
begin
  tid := sty_guard('sty_sell');
  return coalesce((select jsonb_agg(sty_request_json(r) order by r.created_at desc) from (
    select * from sty_requests where tenant_id = tid and (st is null or (st = 'active' and status in ('open', 'ordered', 'arrived')) or status = st) order by created_at desc limit 300) r), '[]'::jsonb);
end $$;

create or replace function sty_requests_open() returns integer language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin tid := sty_guard('sty_sell'); return (select count(*) from sty_requests where tenant_id = tid and status in ('open', 'arrived')); end $$;

-- p: {status, staffNote?}. 'ordered' and 'arrived' tell the customer once (if WhatsApp is on for the shop and a phone was given).
create or replace function sty_request_set(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; r sty_requests; shop text; item text;
begin
  tid := sty_guard('sty_sell');
  if p ? 'status' and p->>'status' not in ('open', 'ordered', 'arrived', 'fulfilled', 'cancelled') then raise exception 'bad status' using errcode = 'ST002'; end if;
  update sty_requests set status = coalesce(p->>'status', status), staff_note = case when p ? 'staffNote' then left(p->>'staffNote', 300) else staff_note end, updated_at = now()
    where id = p_id and tenant_id = tid returning * into r;
  if not found then raise exception 'request not found' using errcode = 'ST002'; end if;
  begin
    select coalesce(nullif(shop_name, ''), (select name from tenants where id = tid)) into shop from sty_settings where tenant_id = tid;
    item := coalesce((select name from sty_styles where id = r.style_id), r.description) || coalesce(' (' || nullif(trim(coalesce(r.colour, '') || ' ' || coalesce(r.size, '')), '') || ')', '');
    if r.phone is not null and r.status = 'ordered' and r.ordered_notified_at is null then
      perform wa_enqueue(tid, r.phone, 'style_request_ordered', jsonb_build_array(split_part(coalesce(r.name, 'there'), ' ', 1), coalesce(shop, 'our store'), item), r.id || '-ordered');
      update sty_requests set ordered_notified_at = now() where id = r.id;
    elsif r.phone is not null and r.status = 'arrived' and r.arrived_notified_at is null then
      perform wa_enqueue(tid, r.phone, 'style_request_ready', jsonb_build_array(split_part(coalesce(r.name, 'there'), ' ', 1), coalesce(shop, 'our store'), item), r.id || '-ready');
      update sty_requests set arrived_notified_at = now() where id = r.id;
    end if;
  exception when others then null; end;
  perform sty_audit_log(tid, 'request.set', p_id::text, p);
  return sty_request_json(r);
end $$;

-- stock arriving for a requested variant: mark the request as arrived, tell the customer and the owner
create or replace function sty_request_arrival() returns trigger language plpgsql security definer set search_path = public as $$
declare r record; shop text; item text;
begin
  if new.qty <= 0 or new.kind not in ('purchase', 'transfer_in', 'opening', 'adjust') then return new; end if;
  for r in select * from sty_requests where variant_id = new.variant_id and tenant_id = new.tenant_id and status in ('open', 'ordered') loop
    update sty_requests set status = 'arrived', updated_at = now() where id = r.id;
    select coalesce(nullif(shop_name, ''), (select name from tenants where id = new.tenant_id)) into shop from sty_settings where tenant_id = new.tenant_id;
    item := coalesce((select name from sty_styles where id = r.style_id), r.description) || coalesce(' (' || nullif(trim(coalesce(r.colour, '') || ' ' || coalesce(r.size, '')), '') || ')', '');
    if r.phone is not null and r.arrived_notified_at is null then
      perform wa_enqueue(new.tenant_id, r.phone, 'style_request_ready', jsonb_build_array(split_part(coalesce(r.name, 'there'), ' ', 1), coalesce(shop, 'our store'), item), r.id || '-ready');
      update sty_requests set arrived_notified_at = now() where id = r.id;
    end if;
    insert into notifications (tenant_id, type, title, body) values (new.tenant_id, 'style_request', 'Requested item arrived: ' || item, coalesce(r.name, 'A customer') || ' is waiting for it.');
    perform pg_notify('push_events', jsonb_build_object('tenant_id', new.tenant_id, 'title', 'Requested item is in stock', 'body', item || coalesce(' · ' || r.name, ''), 'url', '/style.html#/requests')::text);
  end loop;
  return new;
exception when others then return new;
end $$;
drop trigger if exists sty_request_arrival_t on sty_stock_moves;
create trigger sty_request_arrival_t after insert on sty_stock_moves for each row execute function sty_request_arrival();
