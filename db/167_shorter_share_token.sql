-- =========================================================
-- Shorten AUZsLedger/AUZsScan's public share-link token (owner
-- request: "make url as short as possible" for the WhatsApp bill
-- link). It was two concatenated UUIDs with hyphens stripped (64 hex
-- characters, 256 bits) -- a single UUID (32 hex characters, 128 bits)
-- is already astronomically unguessable and matches the length this
-- project already uses for the exact same purpose elsewhere
-- (client_orders.token, the request-first onboarding bill link, is
-- 32 hex characters). Existing shared links (already-sent, already
-- 64 chars) keep working -- only new shares get the shorter token,
-- and public_acc_document's own length guard is loosened to accept
-- both lengths rather than only the old one.
-- =========================================================

create or replace function acc_share_document(p_doc uuid, p_enable boolean default true) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; tok text;
begin
  tid := acc_guard('acc_view');
  if not (acc_perm('acc_sales') or acc_perm('acc_purchase')) then raise exception 'Your role does not allow sharing documents'; end if;
  if p_enable then
    update acc_documents set share_token = coalesce(share_token, replace(gen_random_uuid()::text, '-', ''))
      where id = p_doc and tenant_id = tid and doc_type in ('invoice', 'credit_note', 'quotation', 'sales_order', 'delivery_challan') and status in ('posted', 'open', 'converted') returning share_token into tok;
    if tok is null then raise exception 'Only posted invoices and open quotes/orders can be shared'; end if;
  else
    update acc_documents set share_token = null where id = p_doc and tenant_id = tid;
  end if;
  perform acc_audit_log(tid, case when p_enable then 'share' else 'unshare' end, 'document', p_doc::text, null, null);
  return jsonb_build_object('token', tok);
end $$;

create or replace function public_acc_document(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d acc_documents; o acc_org;
begin
  if p_token is null or length(p_token) < 30 then return null; end if;
  select * into d from acc_documents where share_token = p_token;
  if d.id is null then return null; end if;
  select * into o from acc_org where tenant_id = d.tenant_id;
  return jsonb_build_object(
    'org', jsonb_build_object('name', coalesce(o.trade_name, o.legal_name), 'legal_name', o.legal_name, 'gstin', o.gstin, 'pan', o.pan, 'address', o.address, 'city', o.city, 'pincode', o.pincode, 'phone', o.phone, 'email', o.email,
                              'bank_details', o.bank_details, 'footer', o.invoice_footer, 'state_code', o.state_code, 'brand', coalesce(o.settings->'brand', '{}'::jsonb)),
    'doc', jsonb_build_object('type', d.doc_type, 'number', d.number, 'date', d.doc_date, 'due_date', d.due_date, 'party_name', d.party_name, 'party_gstin', d.party_gstin, 'billing_address', d.billing_address,
                              'shipping_address', d.shipping_address, 'place_of_supply', d.place_of_supply, 'supply_type', d.supply_type, 'reverse_charge', d.reverse_charge, 'subtotal', d.subtotal, 'discount', d.discount, 'taxable', d.taxable,
                              'cgst', d.cgst, 'sgst', d.sgst, 'igst', d.igst, 'cess', d.cess, 'roundoff', d.roundoff, 'total', d.total, 'paid', d.paid, 'status', acc_doc_status(d), 'notes', d.notes, 'terms', d.terms,
                              'payment_terms', d.payment_terms, 'cancelled', d.status = 'cancelled', 'party_phone', (select phone from acc_parties where id = d.party_id)),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('n', l.line_no, 'description', l.description, 'hsn', l.hsn, 'qty', l.qty, 'unit', l.unit, 'rate', l.rate, 'disc_amt', l.disc_amt, 'taxable', l.taxable,
                                'tax_rate', l.tax_rate, 'tax', l.cgst + l.sgst + l.igst + l.cess, 'total', l.total, 'mrp', (select mrp from acc_products where id = l.product_id)) order by l.line_no), '[]') from acc_doc_lines l where l.doc_id = d.id),
    'einvoice', (select jsonb_build_object('irn', irn, 'ack_no', ack_no, 'qr', signed_qr) from acc_einvoice where doc_id = d.id and status = 'generated'));
end $$;
