-- db/290: edit the details of a posted payment/receipt (mode, UTR/reference, notes) without touching amounts or the books.
-- The old values go to the audit log. Needs acc_post. Cancelled payments cannot be edited.
create or replace function acc_update_payment_details(p_payment uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid; pay acc_payments; v_mode text; v_ref text; v_notes text;
begin
  tid := acc_guard('acc_post');
  select * into pay from acc_payments where id = p_payment and tenant_id = tid for update;
  if pay.id is null then raise exception 'Payment not found'; end if;
  if pay.status = 'cancelled' then raise exception '% is cancelled and cannot be edited', pay.number; end if;
  v_mode := case when p ? 'mode' then nullif(trim(p->>'mode'), '') else pay.mode end;
  v_ref := case when p ? 'reference' then nullif(trim(p->>'reference'), '') else pay.reference end;
  v_notes := case when p ? 'notes' then nullif(trim(p->>'notes'), '') else pay.notes end;
  if length(coalesce(v_ref, '')) > 120 or length(coalesce(v_mode, '')) > 60 or length(coalesce(v_notes, '')) > 500 then raise exception 'That text is too long'; end if;
  update acc_payments set mode = v_mode, reference = v_ref, notes = v_notes where id = pay.id;
  perform acc_audit_log(tid, 'edit', pay.kind, pay.id::text,
    jsonb_build_object('mode', pay.mode, 'reference', pay.reference, 'notes', pay.notes),
    jsonb_build_object('mode', v_mode, 'reference', v_ref, 'notes', v_notes), 'Payment details edited');
  return jsonb_build_object('id', pay.id, 'mode', v_mode, 'reference', v_ref, 'notes', v_notes);
end $$;
