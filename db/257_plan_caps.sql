-- Per-client plan limits: the platform admin can switch single capabilities off for one client
-- (online store, picture upload, WhatsApp automation). Absent = allowed; only an explicit false blocks.
alter table tenant_settings add column if not exists caps jsonb not null default '{}'::jsonb;

create or replace function tenant_cap(p_tenant uuid, p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select ts.caps ->> p_key from tenant_settings ts where ts.tenant_id = p_tenant), 'true') <> 'false'
$$;

create or replace function admin_set_tenant_caps(p_tenant_id uuid, p_caps jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_slug text; v_clean jsonb := '{}'::jsonb; k text;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  for k in select jsonb_object_keys(coalesce(p_caps, '{}'::jsonb)) loop
    if k in ('online_store', 'images', 'whatsapp') then v_clean := v_clean || jsonb_build_object(k, (p_caps ->> k) = 'true'); end if;
  end loop;
  update tenant_settings set caps = v_clean where tenant_id = p_tenant_id;
  if not found then raise exception 'tenant not found'; end if;
  select slug into v_slug from tenants where id = p_tenant_id;
  perform admin_log('set_tenant_caps', 'tenant', p_tenant_id::text, jsonb_build_object('slug', v_slug, 'caps', v_clean));
end $$;

-- list_clients now also returns the limits
create or replace function list_clients()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'name', t.name, 'slug', t.slug, 'niche', t.niche, 'build_type', t.build_type,
      'plan', t.plan, 'status', t.status,
      'monthly_fee', t.monthly_fee, 'renewal_date', t.renewal_date, 'notes', t.notes,
      'features', coalesce(ts.features, '{}'::jsonb), 'caps', coalesce(ts.caps, '{}'::jsonb), 'created_at', t.created_at,
      'delivered_at', t.delivered_at
    ) order by t.created_at desc)
    from tenants t
    left join tenant_settings ts on ts.tenant_id = t.id
  ), '[]'::jsonb);
end $$;

-- WhatsApp automation: a client whose plan excludes it never queues a message
create or replace function wa_enqueue(p_tenant uuid, p_to text, p_template text, p_params jsonb, p_ref text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare ph text := wa_norm_phone(p_to); t wa_templates%rowtype; s wa_tenant_settings%rowtype; v_id uuid;
begin
  if ph is null then return null; end if;
  select * into t from wa_templates where key = p_template;
  if not found then return null; end if;
  if p_tenant is null then
    if t.audience <> 'platform' then return null; end if;
    if coalesce((select value from platform_flags where key = 'whatsapp_platform_auto'), 'off') <> 'on' then return null; end if;
  else
    if t.audience <> 'shop' then return null; end if;
    if not tenant_cap(p_tenant, 'whatsapp') then return null; end if;
    select * into s from wa_tenant_settings where tenant_id = p_tenant;
    if not found or not s.enabled then return null; end if;
    if (s.events ->> p_template) = 'false' then return null; end if;
  end if;
  if exists (select 1 from wa_optouts o where o.phone = ph and o.tenant_id is not distinct from p_tenant) then return null; end if;
  insert into wa_outbox (tenant_id, to_phone, template, params, ref)
  values (p_tenant, ph, p_template, coalesce(p_params, '[]'::jsonb), p_ref)
  on conflict do nothing returning id into v_id;
  return v_id;
end $$;

-- AUZsStyle online store: wrap the existing functions (renamed once to *_core) with a plan check
do $$ begin
  if to_regprocedure('public_sty_store_core(text)') is null then alter function public_sty_store(text) rename to public_sty_store_core; end if;
  if to_regprocedure('public_sty_place_order_core(text,jsonb)') is null then alter function public_sty_place_order(text, jsonb) rename to public_sty_place_order_core; end if;
  if to_regprocedure('sty_store_save_core(jsonb)') is null then alter function sty_store_save(jsonb) rename to sty_store_save_core; end if;
  if to_regprocedure('sty_context_core()') is null then alter function sty_context() rename to sty_context_core; end if;
end $$;

create or replace function public_sty_store(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_public_tenant(p_slug);
  if tid is not null and not tenant_cap(tid, 'online_store') then
    return jsonb_build_object('closed', true, 'name', coalesce((select name from tenants where id = tid), 'Shop'));
  end if;
  return public_sty_store_core(p_slug);
end $$;

create or replace function public_sty_place_order(p_slug text, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_public_tenant(p_slug);
  if tid is not null and not tenant_cap(tid, 'online_store') then raise exception 'This shop''s online store is not available.' using errcode = 'P0001'; end if;
  return public_sty_place_order_core(p_slug, p);
end $$;

create or replace function sty_store_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_tenant();
  if not tenant_cap(tid, 'online_store') then raise exception 'The online store is not part of your plan. Ask AUZslab to upgrade.' using errcode = '42501'; end if;
  return sty_store_save_core(p);
end $$;

create or replace function sty_context() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; r jsonb;
begin
  r := sty_context_core();
  tid := sty_tenant();
  return r || jsonb_build_object('caps', coalesce((select caps from tenant_settings where tenant_id = tid), '{}'::jsonb));
end $$;
