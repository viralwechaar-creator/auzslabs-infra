-- Lets the AI connector (db/318) trigger a WhatsApp message to a customer -- but only ever one of the business's
-- own already-approved templates (wa_templates, db/184: fixed content, {{n}} placeholders filled in, never free
-- text -- a WhatsApp Business Platform rule we can't loosen even if we wanted to), and only for the connector
-- key's own tenant.
--
-- wa_enqueue(p_tenant, ...) (db/184) is NOT safe to expose directly over the API: it trusts whatever p_tenant the
-- caller passes, with no check that the caller actually belongs to it -- fine as long as every call site is
-- trusted server code (salon automations, booking/order flows, fin_send_reminder), not fine the moment a caller
-- is a tenant's own API key. This wrapper resolves the tenant from app_uid() itself, the same pattern every other
-- mcp_* function in db/318 already uses, so a connector key can only ever send on behalf of its own business.
create or replace function mcp_send_whatsapp(p_to text, p_template text, p_params jsonb default '[]'::jsonb, p_ref text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_role text; v_tenant uuid; v_id uuid;
begin
  select role, tenant_id into v_role, v_tenant from profiles where id = app_uid();
  if v_role not in ('owner', 'manager') then raise exception 'owner or manager access required' using errcode = 'P0001'; end if;
  if not exists (select 1 from wa_templates where key = p_template and audience = 'shop') then
    raise exception 'unknown template: % (use whatsapp_status to see the available ones)', p_template using errcode = 'P0001';
  end if;
  v_id := wa_enqueue(v_tenant, p_to, p_template, coalesce(p_params, '[]'::jsonb), p_ref);
  if v_id is null then
    raise exception 'could not queue this message -- check whatsapp_status: WhatsApp may not be connected/enabled for this template, the number may be invalid, or this exact message was already sent' using errcode = 'P0001';
  end if;
  return jsonb_build_object('id', v_id, 'status', 'queued');
end $$;
