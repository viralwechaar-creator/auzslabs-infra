-- AI integration ("Connectors"): lets a tenant owner generate an API key for their own AI app (Claude, ChatGPT,
-- etc.) to use against an MCP server this backend exposes (server/src/routes/mcp.js). The owner's AI app brings its
-- own subscription/model -- this key only ever authorizes OUR server to let that AI read/write THIS tenant's data,
-- the same way it already does for a logged-in staff member, via withAuth(). No AI provider is ever called by us.
--
-- Same "real table, zero RLS policies, every access through a SECURITY DEFINER function" discipline as pay_*/mob_*
-- (see db/073_payroll_schema.sql) -- a stolen DB credential (never the `app` role anyway, see db/000's own comment)
-- still could not read a key, let alone every tenant's keys, by a bare `select`.
--
-- The key itself is never stored. Like every other token in this codebase (email-verification/password-reset
-- tokens, db/000's own sha256() helper pattern), only its sha256 hash is kept; the server looks a presented key up
-- by that hash directly (server/src/routes/mcp.js, a raw pool query before any session/RLS context exists -- same
-- shape as server/src/auth/password.js's login() looking up auth_users by email before a JWT exists). The key is
-- shown to the owner exactly once, at creation, never again -- same discipline as a password-reset link.
create table mcp_api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth_users(id) on delete cascade,
  key_hash text not null unique,
  label text not null default 'Connector key',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index mcp_api_keys_tenant_idx on mcp_api_keys (tenant_id) where revoked_at is null;
alter table mcp_api_keys enable row level security;
-- No policies and nothing granted (same discipline as pay_*/mob_*, see db/073's own comment): the `app` role has
-- no path to this table except through the SECURITY DEFINER functions below, which run as the table owner and
-- bypass RLS/grants entirely -- a plain `select` as `app`, even with a grant, would see zero rows.

-- Owner-only: generates a brand-new key, returns the plaintext once. 'auz_mcp_' prefix makes a leaked key
-- grep-able/revocable at a glance and keeps it visibly distinct from a JWT (never mistaken for one in a header).
create or replace function mcp_create_key(p_label text default 'Connector key') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_role text; v_tenant uuid; v_token text; v_id uuid;
begin
  select role, tenant_id into v_role, v_tenant from profiles where id = app_uid();
  if v_role is distinct from 'owner' then raise exception 'only the business owner can create a connector key' using errcode = 'P0001'; end if;
  -- 32 random bytes, base64url, no padding -- about 256 bits, same entropy class as a session jti, never guessable.
  v_token := 'auz_mcp_' || translate(encode(gen_random_bytes(32), 'base64'), '+/=', '-_');
  insert into mcp_api_keys (tenant_id, user_id, key_hash, label)
    values (v_tenant, app_uid(), encode(digest(v_token, 'sha256'), 'hex'), coalesce(trim(p_label), 'Connector key'))
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'key', v_token);
end $$;

-- Owner-only: list this tenant's keys (never the key itself -- only ever returned once, above).
create or replace function mcp_list_keys() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_role text; v_tenant uuid;
begin
  select role, tenant_id into v_role, v_tenant from profiles where id = app_uid();
  if v_role is distinct from 'owner' then raise exception 'only the business owner can view connector keys' using errcode = 'P0001'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', id, 'label', label, 'created_at', created_at, 'last_used_at', last_used_at, 'revoked', revoked_at is not null
  ) order by created_at desc) from mcp_api_keys where tenant_id = v_tenant), '[]'::jsonb);
end $$;

-- Owner-only: revoke a key immediately (the MCP route checks revoked_at on every call, so this takes effect on the
-- very next request -- no cache, no delay, same as revokeSession()'s treatment of a JWT jti).
create or replace function mcp_revoke_key(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_role text; v_tenant uuid;
begin
  select role, tenant_id into v_role, v_tenant from profiles where id = app_uid();
  if v_role is distinct from 'owner' then raise exception 'only the business owner can revoke a connector key' using errcode = 'P0001'; end if;
  update mcp_api_keys set revoked_at = now() where id = p_id and tenant_id = v_tenant and revoked_at is null;
end $$;

-- Called by server/src/routes/mcp.js with no app.uid set (there is no authenticated caller yet -- this IS the
-- auth step, same shape as login() in server/src/auth/password.js looking up auth_users by email before a JWT
-- exists). SECURITY DEFINER so it can see the table at all despite RLS/no-grants above. Touches last_used_at so
-- Account -> AI connectors can show "last used" without a second round trip; any revoked or unknown key resolves
-- to nothing, treated by mcp.js exactly like a bad token (401), with no distinction given to the caller.
create or replace function mcp_resolve_key(p_key_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row record;
begin
  update mcp_api_keys set last_used_at = now()
    where key_hash = p_key_hash and revoked_at is null
    returning tenant_id, user_id into v_row;
  if v_row is null then return null; end if;
  return jsonb_build_object('tenant_id', v_row.tenant_id, 'user_id', v_row.user_id);
end $$;

-- The MCP "create a bill" write tool deliberately does NOT write a finished order straight into `records` --
-- getting a niche's real billing math wrong (tax, service charge, packing/delivery, rounding -- see `tot()`'s own
-- comment in app/public/pos/core.js) would write a wrong financial document with no human in the loop. Instead it
-- reuses the exact same reviewed-by-a-human path a QR customer's order already goes through: place_order() inserts
-- into guest_orders, staff accept it from their existing inbox (acceptG() in pos/shell.js), which is what actually
-- runs the real billing math. This function is that same insert, just for an authenticated owner/manager's AI
-- instead of an anonymous QR scan, with the note tagged so staff can see where it came from.
create or replace function mcp_create_draft_order(p_table text, p_items jsonb, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_role text; v_tenant uuid; v_id uuid;
begin
  select role, tenant_id into v_role, v_tenant from profiles where id = app_uid();
  if v_role is null then raise exception 'not a staff member of any business' using errcode = 'P0001'; end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'p_items must be a non-empty array of {name,qty,price}' using errcode = 'P0001';
  end if;
  insert into guest_orders (tenant_id, tbl, name, phone, note, items)
    values (v_tenant, coalesce(p_table, 'AI'), 'AI connector', '-', trim('Drafted via AI connector -- review before accepting. ' || coalesce(p_note, '')), p_items)
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'pending_staff_review');
end $$;
