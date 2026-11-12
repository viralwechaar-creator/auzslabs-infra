-- AI connector hardening (follows db/318, db/320, db/323):
--  * a key can be read-only (scope 'read') or full ('full'); existing keys stay 'full' so nothing already connected breaks
--  * OAuth refresh tokens now expire (30 days) and are replaced on every use; reusing an old one revokes the whole grant
-- mcp_create_key gains a second argument, so the old one-argument version is dropped first (two overloads with
-- defaults would be ambiguous for the API's named-argument call).
alter table mcp_api_keys add column if not exists scope text not null default 'full';
alter table mcp_api_keys drop constraint if exists mcp_api_keys_scope_check;
alter table mcp_api_keys add constraint mcp_api_keys_scope_check check (scope in ('read', 'full'));

drop function if exists mcp_create_key(text);
create or replace function mcp_create_key(p_label text default 'Connector key', p_scope text default 'read') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_role text; v_tenant uuid; v_token text; v_id uuid; v_scope text := case when p_scope = 'full' then 'full' else 'read' end;
begin
  select role, tenant_id into v_role, v_tenant from profiles where id = app_uid();
  if v_role is distinct from 'owner' then raise exception 'only the business owner can create a connector key' using errcode = 'P0001'; end if;
  v_token := 'auz_mcp_' || translate(encode(gen_random_bytes(32), 'base64'), '+/=', '-_');
  insert into mcp_api_keys (tenant_id, user_id, key_hash, label, scope)
    values (v_tenant, app_uid(), encode(digest(v_token, 'sha256'), 'hex'), coalesce(nullif(trim(p_label), ''), 'Connector key'), v_scope)
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'key', v_token, 'scope', v_scope);
end $$;

create or replace function mcp_list_keys() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_role text; v_tenant uuid;
begin
  select role, tenant_id into v_role, v_tenant from profiles where id = app_uid();
  if v_role is distinct from 'owner' then raise exception 'only the business owner can view connector keys' using errcode = 'P0001'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', id, 'label', label, 'scope', scope, 'created_at', created_at, 'last_used_at', last_used_at, 'revoked', revoked_at is not null
  ) order by created_at desc) from mcp_api_keys where tenant_id = v_tenant), '[]'::jsonb);
end $$;

create or replace function mcp_resolve_key(p_key_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row record;
begin
  update mcp_api_keys set last_used_at = now()
    where key_hash = p_key_hash and revoked_at is null
    returning id, tenant_id, user_id, scope into v_row;
  if v_row is null then return null; end if;
  return jsonb_build_object('id', v_row.id, 'tenant_id', v_row.tenant_id, 'user_id', v_row.user_id, 'scope', v_row.scope);
end $$;

-- OAuth: refresh tokens expire and rotate; the previous one is remembered so a replay can be spotted.
alter table oauth_tokens add column if not exists refresh_expires_at timestamptz not null default (now() + interval '30 days');
alter table oauth_tokens add column if not exists prev_refresh_hash text;
create index if not exists oauth_tokens_prev_refresh_idx on oauth_tokens (prev_refresh_hash) where prev_refresh_hash is not null;
