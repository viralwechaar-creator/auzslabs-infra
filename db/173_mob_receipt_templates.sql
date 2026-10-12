-- =========================================================
-- AUZsMob: receipt visual templates + a real shareable receipt link.
--
-- AUZsMob never had a styled, viewable/printable receipt at all -- sale receipts were only ever shared as
-- plain WhatsApp text (waShareSale in p-sell.js). This adds:
--   1. features.receiptStyle (mob_settings.features, validated here, same pattern as db/105's 'nav' and
--      db/109's 'profitSharePct'): 'thermal' | 'modern' | 'bold' | 'classic' | 'stamped'. Empty/absent = the
--      automatic default ('thermal'), same "owner never touched it" convention as every other feature key.
--   2. mob_share_sale(p_sale_id): gives (or returns the existing) unguessable share_token for one of this
--      shop's own sales, the same shape as AUZsLedger/AUZsScan's acc_share_document (db/167's 32-hex-char
--      token length). AUZsMob has no document "post/open/converted" status concept -- any of this shop's own,
--      non-voided sales can be shared.
--   3. public_mob_sale(p_token): the public, token-only read (mirrors public_acc_document), returning the
--      shop's own display settings (name/address/phone/logo/footer/receiptStyle) plus the one sale's data.
--      No GST fields anywhere (AUZsMob is GST-exempt, db/159) -- this is a plain receipt, not a tax invoice.
-- =========================================================

alter table mob_sales add column if not exists share_token text unique;

-- mob_save_settings (based on db/109, the latest definition): adds the 'receiptStyle' feature key.
create or replace function mob_save_settings(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; fk text; fv jsonb; old_features jsonb;
begin
  tid := mob_guard('mob_manage');
  if p ? 'features' then
    if (me()->>'role') <> 'owner' then raise exception 'Only the owner can change features' using errcode = '42501'; end if;
    if jsonb_typeof(p->'features') <> 'object' then raise exception 'features must be an object' using errcode = 'MB005'; end if;
    for fk, fv in select * from jsonb_each(p->'features') loop
      if fk = 'repairs' then
        if fv #>> '{}' not in ('off', 'simple', 'full') then raise exception 'repairs must be off, simple or full' using errcode = 'MB005'; end if;
      elsif fk = 'profitSharePct' then
        -- % of each staffer's profit that goes to the shop owner; 0 = off
        if jsonb_typeof(fv) <> 'number' or (fv #>> '{}')::numeric < 0 or (fv #>> '{}')::numeric > 100 then
          raise exception 'profitSharePct must be a number from 0 to 100' using errcode = 'MB005';
        end if;
      elsif fk = 'nav' then
        -- Owner-chosen menu buttons, in order. Only a list of known section ids (plus 'more'); no duplicates.
        if jsonb_typeof(fv) <> 'array' or jsonb_array_length(fv) > 8
           or exists (select 1 from jsonb_array_elements_text(fv) e where e not in ('home','sell','repairs','stock','reports','dues','settings','more'))
           or (select count(*) <> count(distinct e) from jsonb_array_elements_text(fv) e) then
          raise exception 'nav must be a short list of menu sections' using errcode = 'MB005';
        end if;
      elsif fk = 'receiptStyle' then
        -- Owner-chosen receipt visual template, shown on the shared/printed receipt page. Empty string clears
        -- it back to the automatic default ('thermal'), same convention as 'nav' clearing to the automatic menu.
        if fv #>> '{}' not in ('', 'thermal', 'modern', 'bold', 'classic', 'stamped') then
          raise exception 'receiptStyle must be thermal, modern, bold, classic or stamped' using errcode = 'MB005';
        end if;
      elsif fk in ('sell', 'purchase', 'stock', 'serials', 'customers', 'vendors', 'dayclose') then
        if jsonb_typeof(fv) <> 'boolean' then raise exception '% must be on or off', fk using errcode = 'MB005'; end if;
      else
        raise exception 'unknown feature %', fk using errcode = 'MB005';
      end if;
    end loop;
    old_features := mob_features(tid);
    update mob_settings set features = old_features || (p->'features'), updated_at = now() where tenant_id = tid;
    perform mob_audit_log(tid, 'mob_settings', tid, 'features', old_features, mob_features(tid));
  end if;
  update mob_settings set
    shop_name = coalesce(p->>'shopName', shop_name), address = coalesce(p->>'address', address),
    phone = coalesce(p->>'phone', phone), logo_url = coalesce(p->>'logoUrl', logo_url),
    bill_footer = coalesce(p->>'billFooter', bill_footer), bill_prefix = coalesce(p->>'billPrefix', bill_prefix),
    language = coalesce(p->>'language', language),
    staff_see_purchase_rates = coalesce((p->>'staffSeePurchaseRates')::boolean, staff_see_purchase_rates),
    day_close_date = case when p ? 'dayCloseDate' then nullif(p->>'dayCloseDate', '')::date else day_close_date end,
    updated_at = now()
  where tenant_id = tid;
  return mob_context();
end $$;

-- Gives (or returns the already-issued) unguessable token for one of this shop's own sales. Any signed-in
-- staffer who could already see the sale (mob_sell; mob_sync_pull's own staff-isolation rule -- a plain
-- staffer only ever has their own sales loaded client-side to call this on in the first place) can share it;
-- a voided sale cannot be (nothing to show a customer). Revoking is p_enable=false, same shape as
-- acc_share_document.
create or replace function mob_share_sale(p_sale_id uuid, p_enable boolean default true) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; tok text; row_tid uuid; row_staff uuid; row_voided boolean;
begin
  tid := mob_guard('mob_sell');
  select tenant_id, staff_id, voided into row_tid, row_staff, row_voided from mob_sales where id = p_sale_id;
  if row_tid is distinct from tid then raise exception 'sale not found' using errcode = 'MB004'; end if;
  if not (mob_perm('mob_reports') or row_staff = app_uid()) then raise exception 'Your role does not allow this' using errcode = '42501'; end if;
  if p_enable then
    if row_voided then raise exception 'A voided sale cannot be shared' using errcode = 'MB005'; end if;
    update mob_sales set share_token = coalesce(share_token, replace(gen_random_uuid()::text, '-', ''))
      where id = p_sale_id and tenant_id = tid returning share_token into tok;
  else
    update mob_sales set share_token = null where id = p_sale_id and tenant_id = tid;
  end if;
  return jsonb_build_object('token', tok);
end $$;

-- Public, token-only read for the shared/printed receipt page (mobbill.html?t=<token>). Mirrors
-- public_acc_document's shape and token-length guard (db/167). No GST fields anywhere: AUZsMob is GST-exempt
-- (db/159), this is a plain receipt.
create or replace function public_mob_sale(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s mob_sales; st mob_settings;
begin
  if p_token is null or length(p_token) < 30 then return null; end if;
  select * into s from mob_sales where share_token = p_token;
  if s.id is null then return null; end if;
  select * into st from mob_settings where tenant_id = s.tenant_id;
  return jsonb_build_object(
    'shop', jsonb_build_object('name', st.shop_name, 'address', st.address, 'phone', st.phone, 'logoUrl', st.logo_url,
                                'footer', st.bill_footer, 'receiptStyle', coalesce(mob_features(s.tenant_id)->>'receiptStyle', 'thermal')),
    'sale', jsonb_build_object('billNo', s.bill_no, 'date', s.created_at, 'items', s.items, 'subtotal', s.subtotal,
                                'discount', s.discount, 'total', s.total, 'paid', s.paid, 'balance', s.balance,
                                'paymentMode', s.payment_mode, 'customerName', s.customer_name, 'customerPhone', s.customer_phone,
                                'voided', s.voided));
end $$;
