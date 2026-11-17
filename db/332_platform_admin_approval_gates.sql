-- Admin-approval gate for every integration that reaches outside the platform, extended to two more
-- places (db/332): the AI connector (MCP) and WhatsApp automatic sending. GST lookup already worked this
-- way (db/306); this makes the pattern consistent everywhere the owner asked for it.
--
-- WhatsApp automation: admin.html's "Plan and limits" editor already had a `whatsapp` checkbox labelled
-- "WhatsApp automation -- Automatic messages to their customers" (site/admin.html) -- but nothing server-
-- side ever actually read caps->>'whatsapp'. A shop could flip its own "Send messages automatically"
-- switch on regardless of what the admin's toggle showed. wa_save_settings now actually enforces it:
-- turning automatic sending ON needs the admin's approval first; turning it OFF never needs anything.
-- (allow_platform, the separate "may send from AUZslab's own number" switch, is unrelated and untouched --
-- this is the broader "may automate at all" gate, whichever WhatsApp number ends up sending.)
--
-- AI connector (MCP): mcp_create_key had zero admin gate at all -- any owner could mint a connector key
-- the instant they opened the page. Doesn't cost AUZslab anything (the owner's own AI subscription pays
-- for the actual AI calls), but the owner still wants every tenant integration approved before it's live,
-- not just the ones with a per-call cost -- so it gets the exact same cap mechanism as everything else.

-- Grandfather tenants who were ALREADY using these before the gate existed -- otherwise this migration
-- would retroactively break something that already worked for them (the owner just now asked for every
-- NEW grant to go through admin approval, not for existing, already-working setups to be yanked away).
update tenant_settings set caps = coalesce(caps, '{}'::jsonb) || '{"whatsapp":true}'::jsonb
  where tenant_id in (select tenant_id from wa_tenant_settings where enabled = true);
update tenant_settings set caps = coalesce(caps, '{}'::jsonb) || '{"ai_connector":true}'::jsonb
  where tenant_id in (select distinct tenant_id from mcp_api_keys);

-- Replaces admin_set_tenant_caps (db/306): only change is adding 'ai_connector' to the allowed keys.
create or replace function admin_set_tenant_caps(p_tenant_id uuid, p_caps jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_slug text; v_clean jsonb := '{}'::jsonb; k text;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  for k in select jsonb_object_keys(coalesce(p_caps, '{}'::jsonb)) loop
    if k in ('online_store', 'images', 'whatsapp', 'multi_pictures', 'gst_lookup', 'ai_connector') then v_clean := v_clean || jsonb_build_object(k, (p_caps ->> k) = 'true'); end if;
  end loop;
  update tenant_settings set caps = v_clean where tenant_id = p_tenant_id;
  if not found then raise exception 'tenant not found'; end if;
  select slug into v_slug from tenants where id = p_tenant_id;
  perform admin_log('set_tenant_caps', 'tenant', p_tenant_id::text, jsonb_build_object('slug', v_slug, 'caps', v_clean));
end $$;

-- Replaces wa_save_settings (db/184): refuses to turn automatic sending ON without the admin's approval
-- (caps->>'whatsapp'). Turning it off always works, and nothing else about this function changed.
create or replace function wa_save_settings(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; ev jsonb := coalesce(p -> 'events', '{}'::jsonb); want_on boolean := coalesce((p ->> 'enabled')::boolean, false);
begin
  select tenant_id into tid from profiles where id = app_uid() and role = 'owner';
  if tid is null then raise exception 'owner access required'; end if;
  if want_on and not tenant_cap_on(tid, 'whatsapp') then
    raise exception 'Ask AUZslab to approve WhatsApp automation for your business first' using errcode = 'P0001';
  end if;
  if jsonb_typeof(ev) <> 'object' then raise exception 'invalid events'; end if;
  ev := (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(ev) e(k, v)
         where jsonb_typeof(v) = 'boolean' and exists (select 1 from wa_templates t where t.key = k and t.audience = 'shop'));
  insert into wa_tenant_settings (tenant_id, enabled, events) values (tid, want_on, ev)
  on conflict (tenant_id) do update set enabled = excluded.enabled, events = excluded.events, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- Replaces mcp_create_key (db/324): refuses to mint a connector key without the admin's approval.
create or replace function mcp_create_key(p_label text default 'Connector key', p_scope text default 'read') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_role text; v_tenant uuid; v_token text; v_id uuid; v_scope text := case when p_scope = 'full' then 'full' else 'read' end;
begin
  select role, tenant_id into v_role, v_tenant from profiles where id = app_uid();
  if v_role is distinct from 'owner' then raise exception 'only the business owner can create a connector key' using errcode = 'P0001'; end if;
  if not tenant_cap_on(v_tenant, 'ai_connector') then raise exception 'Ask AUZslab to approve the AI connector for your business first' using errcode = 'P0001'; end if;
  v_token := 'auz_mcp_' || translate(encode(gen_random_bytes(32), 'base64'), '+/=', '-_');
  insert into mcp_api_keys (tenant_id, user_id, key_hash, label, scope)
    values (v_tenant, app_uid(), encode(digest(v_token, 'sha256'), 'hex'), coalesce(nullif(trim(p_label), ''), 'Connector key'), v_scope)
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'key', v_token, 'scope', v_scope);
end $$;

-- Replaces wa_my_status (db/184): adds automation_allowed so the Settings screen can say plainly why the
-- "Send automatically" switch does nothing yet, instead of just having the save silently fail.
create or replace function wa_my_status() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; r jsonb;
begin
  select tenant_id into tid from profiles where id = app_uid() and role in ('owner','manager');
  if tid is null then raise exception 'owner access required'; end if;
  select jsonb_build_object(
    'connected', exists (select 1 from wa_accounts a where a.tenant_id = tid and a.active),
    'number',    (select display_phone from wa_accounts a where a.tenant_id = tid),
    'enabled',   coalesce((select enabled from wa_tenant_settings where tenant_id = tid), false),
    'allow_platform', coalesce((select allow_platform from wa_tenant_settings where tenant_id = tid), false),
    'automation_allowed', tenant_cap_on(tid, 'whatsapp'),
    'events',    coalesce((select events from wa_tenant_settings where tenant_id = tid), '{}'::jsonb),
    'templates', (select coalesce(jsonb_agg(to_jsonb(x) order by x.key), '[]'::jsonb) from (select key, name, language, title, body, params from wa_templates where audience = 'shop') x),
    'recent',    (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from (
                    select id, to_phone, template, status, error, sender, created_at from wa_outbox
                    where tenant_id = tid order by created_at desc limit 30) m),
    'counts',    (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (
                    select status, count(*) n from wa_outbox where tenant_id = tid and created_at > now() - interval '30 days' group by status) c)
  ) into r;
  return r;
end $$;

-- A tenant can always see whether it's approved yet, without needing to try (and be refused) first.
create or replace function mcp_connector_status() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from profiles where id = app_uid() and role = 'owner';
  if v_tenant is null then raise exception 'owner access required'; end if;
  return jsonb_build_object('allowed', tenant_cap_on(v_tenant, 'ai_connector'));
end $$;
-- Rollback: restore admin_set_tenant_caps, wa_my_status from db/184, wa_save_settings from db/184,
-- mcp_create_key from db/324; drop function mcp_connector_status().
