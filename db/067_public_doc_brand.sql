-- Business identity (logo, signature, stamp, UPI, registrations, bank) travels with the shared invoice link.
create or replace function public_acc_document(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d acc_documents; o acc_org;
begin
  if p_token is null or length(p_token) < 40 then return null; end if;
  select * into d from acc_documents where share_token = p_token;
  if d.id is null then return null; end if;
  select * into o from acc_org where tenant_id = d.tenant_id;
  return jsonb_build_object(
    'org', jsonb_build_object('name', coalesce(o.trade_name, o.legal_name), 'legal_name', o.legal_name, 'gstin', o.gstin, 'pan', o.pan, 'address', o.address, 'city', o.city, 'pincode', o.pincode, 'phone', o.phone, 'email', o.email,
                              'bank_details', o.bank_details, 'footer', o.invoice_footer, 'state_code', o.state_code, 'brand', coalesce(o.settings->'brand', '{}'::jsonb)),
    'doc', jsonb_build_object('type', d.doc_type, 'number', d.number, 'date', d.doc_date, 'due_date', d.due_date, 'party_name', d.party_name, 'party_gstin', d.party_gstin, 'billing_address', d.billing_address,
                              'shipping_address', d.shipping_address, 'place_of_supply', d.place_of_supply, 'supply_type', d.supply_type, 'reverse_charge', d.reverse_charge, 'subtotal', d.subtotal, 'discount', d.discount, 'taxable', d.taxable,
                              'cgst', d.cgst, 'sgst', d.sgst, 'igst', d.igst, 'cess', d.cess, 'roundoff', d.roundoff, 'total', d.total, 'paid', d.paid, 'status', acc_doc_status(d), 'notes', d.notes, 'terms', d.terms,
                              'payment_terms', d.payment_terms, 'cancelled', d.status = 'cancelled'),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('n', l.line_no, 'description', l.description, 'hsn', l.hsn, 'qty', l.qty, 'unit', l.unit, 'rate', l.rate, 'disc_amt', l.disc_amt, 'taxable', l.taxable,
                                'tax_rate', l.tax_rate, 'tax', l.cgst + l.sgst + l.igst + l.cess, 'total', l.total) order by l.line_no), '[]') from acc_doc_lines l where l.doc_id = d.id),
    'einvoice', (select jsonb_build_object('irn', irn, 'ack_no', ack_no, 'qr', signed_qr) from acc_einvoice where doc_id = d.id and status = 'generated'));
end $$;

