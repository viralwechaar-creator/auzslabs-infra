-- AI Activity Audit Log: until now, nothing recorded what an AI agent actually did through the connector --
-- no log of which tool ran, with what arguments, whether it succeeded, or which connector key was used. Every
-- other sensitive write path in this codebase has an audit trail (pos_audit, acc_audit, pay_audit, mob_audit)
-- except the connector itself, which is the one surface specifically built to let something other than a
-- human staff member write real data. Same discipline as pos_audit (db/068): a real table, RLS read-only for
-- owner/manager, a trigger that blocks update/delete so the log itself can never be edited, and insertion only
-- through a SECURITY DEFINER helper.
create table if not exists mcp_audit (
  id         bigserial primary key,
  tenant_id  uuid not null references tenants(id) on delete cascade,
  key_id     uuid references mcp_api_keys(id) on delete set null,
  at         timestamptz not null default now(),
  tool       text not null,
  ok         boolean not null,
  error      text,
  args       jsonb
);
create index if not exists mcp_audit_tenant_at on mcp_audit (tenant_id, at desc);
alter table mcp_audit enable row level security;
drop policy if exists mcp_audit_read on mcp_audit;
create policy mcp_audit_read on mcp_audit for select
  using (me() is not null and tenant_id = (me()->>'tenant_id')::uuid and (me()->>'role') in ('owner', 'manager'));
grant select on mcp_audit to app;

create or replace function mcp_audit_block() returns trigger language plpgsql as $$
begin
  if exists (select 1 from tenants where id = old.tenant_id) then raise exception 'The AI activity log cannot be changed or deleted'; end if;
  return old;
end $$;
drop trigger if exists mcp_audit_no_change on mcp_audit;
create trigger mcp_audit_no_change before update or delete on mcp_audit for each row execute function mcp_audit_block();

-- mcp_resolve_key (db/318) didn't return the key's own id, which the audit log needs to say which key made
-- the call. Additive only (one more field in the same jsonb shape) -- every existing caller that only reads
-- tenant_id/user_id is unaffected.
create or replace function mcp_resolve_key(p_key_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row record;
begin
  update mcp_api_keys set last_used_at = now()
    where key_hash = p_key_hash and revoked_at is null
    returning id, tenant_id, user_id into v_row;
  if v_row is null then return null; end if;
  return jsonb_build_object('id', v_row.id, 'tenant_id', v_row.tenant_id, 'user_id', v_row.user_id);
end $$;

-- NOT registered in the callRpc/RPC registry on purpose, same discipline as provision_from_payment /
-- addon_request_pricing_context (db/072's own comment): tenant_id here comes from the already-resolved
-- connector key, not from app_uid()/a session, so this must only ever be called from trusted server code
-- (server/src/routes/mcp.js, right after mcp_resolve_key), never reachable by an API caller directly.
create or replace function mcp_audit_add(p_tenant uuid, p_key_id uuid, p_tool text, p_ok boolean, p_error text, p_args jsonb)
returns void language sql security definer set search_path = public as $$
  insert into mcp_audit (tenant_id, key_id, tool, ok, error, args) values (p_tenant, p_key_id, p_tool, p_ok, left(p_error, 500), p_args)
$$;

-- Owner/manager (console) AND an AI agent itself (mcp_my_activity, so it can see its own recent actions)
-- both read through this -- scoped to the caller's own tenant via app_uid(), same as every other mcp_* read.
create or replace function mcp_audit_list(p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_role text; v_tenant uuid;
begin
  select role, tenant_id into v_role, v_tenant from profiles where id = app_uid();
  if v_role not in ('owner', 'manager') then raise exception 'owner or manager access required' using errcode = 'P0001'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'at', a.at, 'tool', a.tool, 'ok', a.ok, 'error', a.error, 'args', a.args,
      'key_label', k.label
    ) order by a.at desc)
    from mcp_audit a left join mcp_api_keys k on k.id = a.key_id
    where a.tenant_id = v_tenant
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ), '[]'::jsonb);
end $$;
