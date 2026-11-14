-- The AI connector's whatsapp_status tool (wa_my_status, db/184) already returns the 30 most recent outbound
-- WhatsApp messages for the whole tenant -- useful for "is WhatsApp working", not for "what have we sent THIS
-- customer", since a busy tenant's other customers' messages crowd out the one being asked about. This gives
-- the connector a phone-scoped view, same tenant-from-app_uid() safety as mcp_send_whatsapp (db/319): a
-- connector key can only ever see its own business's messages, never another tenant's.
create or replace function mcp_whatsapp_history(p_phone text default null, p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_role text; v_tenant uuid; v_phone text;
begin
  select role, tenant_id into v_role, v_tenant from profiles where id = app_uid();
  if v_role not in ('owner', 'manager') then raise exception 'owner or manager access required' using errcode = 'P0001'; end if;
  v_phone := case when nullif(trim(p_phone), '') is not null then wa_norm_phone(p_phone) end;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'to_phone', to_phone, 'template', template, 'params', params, 'status', status, 'error', error, 'sender', sender, 'created_at', created_at) order by created_at desc)
    from (
      select * from wa_outbox where tenant_id = v_tenant and (v_phone is null or to_phone = v_phone)
      order by created_at desc limit greatest(1, least(coalesce(p_limit, 50), 200))
    ) x
  ), '[]'::jsonb);
end $$;
