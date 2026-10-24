-- Build-your-own software: a visitor ticks building blocks, gets a working account for 3 days, then it locks until paid.
-- Standard blocks carry a monthly price set by the admin (0 = the admin quotes by hand). The admin can still edit the quote
-- (discount, price change) before the client pays: it is an ordinary client_orders row of kind 'addon'.

create table if not exists trial_blocks (
  key text primary key check (key ~ '^[a-z_]{2,30}$'),
  label text not null,
  blurb text not null default '',
  features text[] not null default '{}',
  price_month numeric(12,2) not null default 0 check (price_month >= 0),
  active boolean not null default true,
  sort int not null default 100
);
alter table trial_blocks enable row level security;

insert into trial_blocks (key, label, blurb, features, price_month, sort) values
  ('pos',        'Billing and POS',         'Fast billing, tables, kitchen, customers and stock.', '{pos,crm,billing,inventory}', 1090, 10),
  ('self_order', 'QR table ordering',       'Guests scan the table QR and order from their phone.', '{self_order}', 400, 20),
  ('payroll',    'Staff, attendance and pay','Clock-in, hourly or monthly pay, leave and payslips.', '{payroll}', 590, 30),
  ('accounting', 'Accounts and GST',        'Invoices, purchases, GST and books.', '{accounting}', 1490, 40),
  ('scan',       'Scan to bill',            'Scan barcodes to sell and add stock.', '{scan}', 460, 50),
  ('mobile',     'Phone shop and repairs',  'IMEI stock, sales, repair job cards.', '{mobile}', 249, 60),
  ('style',      'Clothing and footwear',   'Sizes, colours, tags and online store.', '{style}', 0, 70),
  ('finance',    'Money and dues',          'Money in and out, capital, loans, dues.', '{finance}', 0, 80),
  ('website_builder','Website builder',     'Your own website, edited by you.', '{website_builder}', 0, 90)
on conflict (key) do nothing;

alter table tenant_settings add column if not exists trial jsonb;   -- {state: active|locked|paid, started, ends, blocks:[{key,label,features,price}], locked_features}

insert into platform_flags (key, value) values ('trial_auto_pay', 'on') on conflict (key) do nothing;

create or replace function public_trial_blocks() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label, 'blurb', blurb) order by sort, key), '[]'::jsonb)
  from trial_blocks where active
$$;

-- lock every trial that has run out (features are put aside, not lost)
create or replace function trial_lock_run() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  for r in select ts.tenant_id, ts.features from tenant_settings ts
           where ts.trial->>'state' = 'active' and (ts.trial->>'ends')::timestamptz <= now() loop
    update tenant_settings set trial = jsonb_set(jsonb_set(trial, '{state}', '"locked"'), '{locked_features}', coalesce(r.features, '{}'::jsonb)),
      features = '{}'::jsonb where tenant_id = r.tenant_id;
    insert into notifications (tenant_id, type, title, body) values (r.tenant_id, 'trial_locked', 'Your 3-day trial has ended', 'Subscribe to keep using your software. Your data is safe.');
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function start_self_trial(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := app_uid(); biz text := trim(coalesce(p->>'business_name', '')); cname text := trim(coalesce(p->>'contact_name', ''));
  v_phone text := trim(coalesce(p->>'phone', '')); keys text[]; blocks jsonb; feats jsonb := '{}'; v_slug text; base text; tid uuid; ends timestamptz := now() + interval '3 days';
  b record; email text;
begin
  if uid is null then raise exception 'Please sign in first.'; end if;
  if exists (select 1 from profiles where id = uid) then raise exception 'This login already has a business. Open it from your apps.'; end if;
  if exists (select 1 from platform_admins where id = uid) then raise exception 'Platform admins cannot start a trial.'; end if;
  if biz = '' then raise exception 'Please enter your business name.'; end if;
  if length(regexp_replace(v_phone, '\D', '', 'g')) < 10 then raise exception 'Please enter a valid mobile number.'; end if;
  select coalesce(array_agg(distinct x), '{}') into keys from jsonb_array_elements_text(coalesce(p->'blocks', '[]'::jsonb)) x;
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label, 'features', to_jsonb(features), 'price', price_month) order by sort), '[]'::jsonb) into blocks
    from trial_blocks where active and key = any(keys);
  if jsonb_array_length(blocks) = 0 then raise exception 'Pick at least one block.'; end if;
  for b in select * from trial_blocks where active and key = any(keys) loop
    select feats || coalesce(jsonb_object_agg(f, true), '{}'::jsonb) into feats from unnest(b.features) f;
  end loop;
  base := left(coalesce(nullif(regexp_replace(lower(biz), '[^a-z0-9]', '', 'g'), ''), 'shop'), 24);
  v_slug := base;
  while exists (select 1 from tenants where tenants.slug = v_slug) or v_slug in ('app','www','api','admin','status','mail','auth','login','start','go','demo','agents','next') loop
    v_slug := base || substr(md5(random()::text), 1, 4);
  end loop;
  select au.email into email from auth_users au where au.id = uid;
  insert into tenants (name, slug, niche, status, is_trial) values (left(biz, 160), v_slug, 'retail', 'trial', true) returning id into tid;
  insert into tenant_settings (tenant_id, features, trial)
    values (tid, feats, jsonb_build_object('state', 'active', 'started', now(), 'ends', ends, 'blocks', blocks));
  insert into records (id, tenant_id, kind, data) values ('settings', tid, 'settings', jsonb_build_object('name', left(biz, 160)));
  insert into profiles (id, tenant_id, email, role) values (uid, tid, email, 'owner');
  update auth_users set app_metadata = app_metadata || jsonb_build_object('tenant_id', tid, 'role', 'owner') where id = uid;
  insert into notifications (tenant_id, type, title, body) values (null, 'self_trial', 'New 3-day trial: ' || biz, left(cname, 80) || ' · ' || v_phone || ' · ' || array_to_string(keys, ', '));
  return jsonb_build_object('tenant_id', tid, 'slug', v_slug, 'ends', ends);
end $$;

create or replace function trial_status() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := app_uid(); tid uuid; t jsonb; o client_orders;
begin
  if uid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select tenant_id into tid from profiles where id = uid limit 1;
  if tid is null then return jsonb_build_object('state', 'none'); end if;
  perform trial_lock_run();
  select trial into t from tenant_settings where tenant_id = tid;
  if t is null then return jsonb_build_object('state', 'none'); end if;
  select * into o from client_orders where tenant_id = tid and user_id = uid and status <> 'paid' and status <> 'rejected' and quote is not null order by created_at desc limit 1;
  return jsonb_build_object('state', t->>'state', 'ends', t->>'ends', 'seconds_left', greatest(0, extract(epoch from ((t->>'ends')::timestamptz - now()))::int),
    'blocks', t->'blocks', 'order', case when o.id is null then null else jsonb_build_object('token', o.token, 'status', o.status, 'total', o.totals->>'total') end);
end $$;

-- the client asks to subscribe: an ordinary quote is made from the block prices; the admin can still change it before payment
create or replace function trial_subscribe() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := app_uid(); tid uuid; t jsonb; o client_orders; items jsonb := '[]'; b jsonb; q jsonb; tot jsonb; allpriced boolean := true; auto boolean;
  tn tenants; pr profiles; ap record;
begin
  if uid is null then raise exception 'Please sign in first.'; end if;
  select * into pr from profiles where id = uid limit 1;
  if pr.id is null or pr.role <> 'owner' then raise exception 'Only the owner can subscribe.'; end if;
  tid := pr.tenant_id;
  select trial into t from tenant_settings where tenant_id = tid;
  if t is null or t->>'state' not in ('active', 'locked') then raise exception 'There is nothing to subscribe to.'; end if;
  select * into o from client_orders where tenant_id = tid and user_id = uid and status not in ('paid', 'rejected') and (payment->>'trial') = 'true' order by created_at desc limit 1;
  if o.id is not null then return jsonb_build_object('token', o.token, 'status', o.status); end if;
  for b in select * from jsonb_array_elements(t->'blocks') loop
    if coalesce((b->>'price')::numeric, 0) <= 0 then allpriced := false; end if;
    items := items || jsonb_build_array(jsonb_build_object('key', (b->'features'->>0), 'block', b->>'key', 'label', b->>'label', 'plan', 'month', 'rate', coalesce((b->>'price')::numeric, 0), 'discount', 0, 'gst', 18));
  end loop;
  select * into tn from tenants where id = tid;
  select name, phone into ap from user_profiles where user_id = uid;
  auto := allpriced and coalesce((select value from platform_flags where key = 'trial_auto_pay'), 'on') = 'on';
  q := jsonb_build_object('items', items, 'onboarding', jsonb_build_object('on', false), 'setup', jsonb_build_object('on', false), 'custom', '[]'::jsonb);
  tot := case when allpriced then client_order_totals(q, null) else null end;
  insert into client_orders (user_id, tenant_id, kind, contact_name, phone, email, business_name, slug, products, requirement, quote, totals, status, payment)
  values (uid, tid, 'addon', ap.name, ap.phone, pr.email, tn.name, tn.slug, array(select jsonb_array_elements(t->'blocks')->>'key'),
    'Subscription after the 3-day trial', case when allpriced then q else null end, tot, case when auto then 'link_sent' else 'requested' end, jsonb_build_object('trial', 'true'))
  returning * into o;
  insert into notifications (tenant_id, type, title, body) values (null, 'client_order', 'Trial client wants to subscribe: ' || tn.name, case when auto then 'A quote was made from the block prices. Change it before they pay if you want to give a discount.' else 'Some blocks have no price. Please make the quote.' end);
  return jsonb_build_object('token', o.token, 'status', o.status);
end $$;

-- payment confirmed: give back what the trial had, but only for the blocks that were paid for
create or replace function trial_restore_on_paid() returns trigger
language plpgsql security definer set search_path = public as $$
declare t jsonb; paid_blocks text[]; b jsonb; feats jsonb := '{}'; f text;
begin
  if new.status <> 'paid' or old.status = 'paid' or new.tenant_id is null then return new; end if;
  select trial into t from tenant_settings where tenant_id = new.tenant_id;
  if t is null or t->>'state' not in ('active', 'locked') then return new; end if;
  select coalesce(array_agg(x->>'block'), '{}') into paid_blocks from jsonb_array_elements(new.quote->'items') x where x->>'block' is not null;
  for b in select * from jsonb_array_elements(t->'blocks') loop
    if b->>'key' = any(paid_blocks) then
      for f in select jsonb_array_elements_text(b->'features') loop feats := feats || jsonb_build_object(f, true); end loop;
    end if;
  end loop;
  update tenant_settings set features = coalesce(features, '{}'::jsonb) || feats, trial = jsonb_set(trial, '{state}', '"paid"') where tenant_id = new.tenant_id;
  update tenants set status = 'active', is_trial = false where id = new.tenant_id;
  return new;
exception when others then return new;
end $$;
drop trigger if exists client_orders_trial_restore on client_orders;
create trigger client_orders_trial_restore after update of status on client_orders for each row execute function trial_restore_on_paid();

-- admin: block catalogue
create or replace function admin_list_trial_blocks() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return jsonb_build_object('blocks', coalesce((select jsonb_agg(to_jsonb(b) order by sort, key) from trial_blocks b), '[]'::jsonb),
    'auto_pay', coalesce((select value from platform_flags where key = 'trial_auto_pay'), 'on'));
end $$;

create or replace function admin_save_trial_block(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare k text := p->>'key';
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if k is null and p ? 'auto_pay' then
    insert into platform_flags (key, value) values ('trial_auto_pay', case when (p->>'auto_pay')::boolean then 'on' else 'off' end)
    on conflict (key) do update set value = excluded.value;
    return;
  end if;
  if k is null or k !~ '^[a-z_]{2,30}$' then raise exception 'Bad block key.'; end if;
  insert into trial_blocks (key, label, blurb, features, price_month, active, sort)
  values (k, left(coalesce(nullif(p->>'label', ''), k), 80), left(coalesce(p->>'blurb', ''), 200),
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'features', '[]'::jsonb)) x where x ~ '^[a-z_]{2,30}$'), '{}'),
    greatest(coalesce((p->>'price_month')::numeric, 0), 0), coalesce((p->>'active')::boolean, true), coalesce((p->>'sort')::int, 100))
  on conflict (key) do update set label = excluded.label, blurb = excluded.blurb, features = excluded.features, price_month = excluded.price_month, active = excluded.active, sort = excluded.sort;
  if p ? 'auto_pay' then
    insert into platform_flags (key, value) values ('trial_auto_pay', case when (p->>'auto_pay')::boolean then 'on' else 'off' end)
    on conflict (key) do update set value = excluded.value;
  end if;
  perform admin_log('trial_block', 'trial_block', k, p);
end $$;
