-- =========================================================
-- Wire the `invoice_link` WhatsApp template (seeded in db/184, never used until now) to every real
-- sale/invoice-completion point in the platform: POS orders, AUZsLedger/AUZsScan (shared acc_* books),
-- and AUZsMob sales. The Salon piece is a direct JS call (see server/src/salon/router.js /
-- server/src/whatsapp.js enqueueWa) since Showoff's bills are JSON blobs, not rows a trigger can watch.
--
-- Every trigger here follows db/184's own established discipline exactly:
--  * wa_enqueue(tenant, phone, template, params[], ref) is the one entry point; it already checks
--    wa_tenant_settings.enabled (the owner's on/off switch) and is idempotent per (tenant, template, ref)
--    via wa_outbox's own unique index -- nothing here duplicates or bypasses that gate.
--  * the whole trigger body is wrapped in `begin ... exception when others then null; end;` so a
--    messaging failure can never block the real sale/posting.
--  * a trigger that can fire on INSERT must never reference OLD outside of a short-circuited
--    `tg_op = 'UPDATE' and old...` guard (db/189's own documented gotcha: OLD is not a safely-null
--    record on an INSERT firing -- referencing it unguarded is a plpgsql error).
-- =========================================================

-- Plain "123.45" formatting for a WhatsApp message amount (the templates already say "Rs {{n}}").
create or replace function wa_money(x numeric) returns text language sql immutable as $$
  select trim(to_char(coalesce(x, 0), 'FM999999999990.00'))
$$;

-- "<tenant's own subdomain>" + path, built from the same public_site_url base wa_site_url() (db/184)
-- already uses for AUZslab's own links -- https://auzslab.in -> https://<slug>.auzslab.in<path>.
create or replace function wa_tenant_link(p_tenant uuid, p_path text) returns text
language plpgsql stable security definer set search_path = public as $$
declare slug text;
begin
  select t.slug into slug from tenants t where t.id = p_tenant;
  if slug is null then return null; end if;
  return regexp_replace(wa_site_url(), '^(https?://)', '\1' || slug || '.') || p_path;
end $$;

-- ---------- 1. POS (records, kind='order'): a bill just became paid ----------
create or replace function wa_pos_bill_msg() returns trigger language plpgsql security definer set search_path = public as $$
declare shop text; phone text; link text;
begin
  begin
    if coalesce(new.data->>'status', '') <> 'paid' then return new; end if;
    if tg_op = 'UPDATE' and old.data->>'status' = 'paid' then return new; end if; -- only a genuine new transition to paid
    phone := new.data->'cust'->>'phone';
    if phone is null or phone = '' then return new; end if;
    select name into shop from tenants where id = new.tenant_id;
    link := wa_tenant_link(new.tenant_id, '/i.html?o=' || coalesce(new.data->>'tok', new.data->>'no'));
    if link is null then return new; end if;
    perform wa_enqueue(new.tenant_id, phone, 'invoice_link',
      jsonb_build_array(coalesce(new.data->'cust'->>'name', 'there'), coalesce(shop, 'us'),
                        coalesce(new.data->>'no', ''), wa_money((new.data->'t'->>'total')::numeric), link),
      new.id || '-bill');
  exception when others then null;
  end;
  return new;
end $$;
drop trigger if exists records_order_wa on records;
create trigger records_order_wa after insert or update on records for each row
  when (new.kind = 'order') execute function wa_pos_bill_msg();

-- ---------- 2. AUZsLedger / AUZsScan (acc_documents, doc_type='invoice'): just posted ----------
create or replace function wa_acc_invoice_msg() returns trigger language plpgsql security definer set search_path = public as $$
declare shop text; p_phone text; p_name text; tok text; link text;
begin
  begin
    if new.doc_type <> 'invoice' or new.status <> 'posted' then return new; end if;
    if old.status = 'posted' then return new; end if; -- only a genuine new posting, never a reprint/correction query
    select phone, name into p_phone, p_name from acc_parties where id = new.party_id;
    if p_phone is null or p_phone = '' then return new; end if;
    select t.name into shop from tenants t where t.id = new.tenant_id;
    update acc_documents set share_token = coalesce(share_token, replace(gen_random_uuid()::text, '-', ''))
      where id = new.id returning share_token into tok;
    link := wa_tenant_link(new.tenant_id, '/bill.html?t=' || tok);
    if link is null then return new; end if;
    perform wa_enqueue(new.tenant_id, p_phone, 'invoice_link',
      jsonb_build_array(coalesce(p_name, 'there'), coalesce(shop, 'us'), coalesce(new.number, ''), wa_money(new.total), link),
      new.id || '-bill');
  exception when others then null;
  end;
  return new;
end $$;
drop trigger if exists acc_documents_wa on acc_documents;
create trigger acc_documents_wa after update of status on acc_documents for each row execute function wa_acc_invoice_msg();

-- ---------- 3. AUZsMob (mob_sales): a sale with a customer attached was posted ----------
-- mob_push_sale (db/107) already refuses to insert a second row for the same id (checked and returned
-- before the insert), so this AFTER INSERT fires at most once per real sale -- the wa_outbox ref is kept
-- anyway as the same belt-and-suspenders idempotency every other trigger here relies on.
create or replace function wa_mob_sale_msg() returns trigger language plpgsql security definer set search_path = public as $$
declare shop text; tok text; link text;
begin
  begin
    if new.customer_phone is null or new.customer_phone = '' or new.voided then return new; end if;
    select name into shop from tenants where id = new.tenant_id;
    update mob_sales set share_token = coalesce(share_token, replace(gen_random_uuid()::text, '-', ''))
      where id = new.id returning share_token into tok;
    link := wa_tenant_link(new.tenant_id, '/mobbill.html?t=' || tok);
    if link is null then return new; end if;
    perform wa_enqueue(new.tenant_id, new.customer_phone, 'invoice_link',
      jsonb_build_array(coalesce(new.customer_name, 'there'), coalesce(shop, 'us'), coalesce(new.bill_no, ''), wa_money(new.total), link),
      new.id || '-bill');
  exception when others then null;
  end;
  return new;
end $$;
drop trigger if exists mob_sales_wa on mob_sales;
create trigger mob_sales_wa after insert on mob_sales for each row execute function wa_mob_sale_msg();
