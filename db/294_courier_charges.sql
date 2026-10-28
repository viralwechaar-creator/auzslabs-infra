-- Courier / transporter parties and a per-supplier GST style (itemwise or one rate on the whole bill).
alter table acc_parties add column if not exists gst_mode text not null default 'item' check (gst_mode in ('item','bill'));
alter table acc_parties add column if not exists bill_gst_rate numeric(5,2);
alter table acc_parties drop constraint if exists acc_parties_party_type_check;
alter table acc_parties add constraint acc_parties_party_type_check check (party_type in ('customer','supplier','employee','partner','other','transporter'));

create or replace function acc_save_party(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; pid uuid := nullif(p->>'id', '')::uuid; g text := nullif(upper(trim(p->>'gstin')), ''); old acc_parties; st text; dup text; k text := p->>'kind'; perm text; pt text := nullif(p->>'party_type', '');
begin
  if pt is not null and pt not in ('customer', 'supplier', 'employee', 'partner', 'other', 'transporter') then raise exception 'Unknown party type'; end if;
  if pt in ('employee', 'partner', 'other') then k := 'both'; elsif pt = 'transporter' then k := 'supplier'; elsif pt in ('customer', 'supplier') then k := pt; end if;
  perm := case when k = 'supplier' then 'acc_purchase' else 'acc_sales' end;
  tid := acc_guard(perm);
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Name is required'; end if;
  if g is not null and not acc_gstin_valid(g) then raise exception 'GSTIN % is not valid (check the characters and check-digit)', g; end if;
  st := coalesce(nullif(p->>'state_code', ''), substr(g, 1, 2));
  if g is not null and st is not null and substr(g, 1, 2) <> st then raise exception 'State code % does not match the GSTIN (which starts with %)', st, substr(g, 1, 2); end if;
  if p->>'email' is not null and p->>'email' <> '' and p->>'email' !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address'; end if;
  if g is not null then select name into dup from acc_parties where tenant_id = tid and gstin = g and id is distinct from pid limit 1; end if;
  if pid is null then
    if k not in ('customer', 'supplier', 'both') then raise exception 'Choose customer or supplier'; end if;
    insert into acc_parties (tenant_id, kind, party_type, code, name, gstin, pan, reg_type, state_code, billing_address, shipping_address, phone, email, contact_name, credit_limit, credit_days, tags, notes, category, bank_name, bank_account, bank_ifsc, upi_id, gst_mode, bill_gst_rate)
    values (tid, k, pt, nullif(p->>'code', ''), trim(p->>'name'), g, nullif(upper(trim(p->>'pan')), ''), coalesce(nullif(p->>'reg_type', ''), case when g is null then 'unregistered' else 'regular' end), st,
            p->>'billing_address', p->>'shipping_address', p->>'phone', p->>'email', p->>'contact_name', coalesce((p->>'credit_limit')::numeric, 0), coalesce((p->>'credit_days')::int, 0), p->>'tags', p->>'notes',
            nullif(trim(coalesce(p->>'category', '')), ''), p->>'bank_name', p->>'bank_account', upper(p->>'bank_ifsc'), p->>'upi_id', coalesce(nullif(p->>'gst_mode',''),'item'), nullif(p->>'bill_gst_rate','')::numeric)
    returning id into pid;
    perform acc_audit_log(tid, 'create', 'party', pid::text, null, p);
  else
    select * into old from acc_parties where id = pid and tenant_id = tid;
    if old.id is null then raise exception 'Party not found'; end if;
    if old.is_walkin and p ? 'name' and trim(p->>'name') <> old.name then raise exception 'The walk-in party cannot be renamed'; end if;
    update acc_parties set kind = coalesce(nullif(k, ''), kind), party_type = case when p ? 'party_type' then pt else party_type end,
      code = coalesce(nullif(p->>'code', ''), code), name = coalesce(nullif(trim(p->>'name'), ''), name), gstin = case when p ? 'gstin' then g else gstin end,
      pan = case when p ? 'pan' then nullif(upper(trim(p->>'pan')), '') else pan end, reg_type = coalesce(nullif(p->>'reg_type', ''), reg_type), state_code = case when p ? 'gstin' or p ? 'state_code' then st else state_code end,
      billing_address = coalesce(p->>'billing_address', billing_address), shipping_address = coalesce(p->>'shipping_address', shipping_address),
      phone = coalesce(p->>'phone', phone), email = coalesce(p->>'email', email), contact_name = coalesce(p->>'contact_name', contact_name),
      credit_limit = coalesce((p->>'credit_limit')::numeric, credit_limit), credit_days = coalesce((p->>'credit_days')::int, credit_days),
      category = case when p ? 'category' then nullif(trim(p->>'category'), '') else category end,
      bank_name = coalesce(p->>'bank_name', bank_name), bank_account = coalesce(p->>'bank_account', bank_account),
      bank_ifsc = case when p ? 'bank_ifsc' then upper(p->>'bank_ifsc') else bank_ifsc end, upi_id = coalesce(p->>'upi_id', upi_id),
      gst_mode = case when p ? 'gst_mode' then coalesce(nullif(p->>'gst_mode',''),'item') else gst_mode end, bill_gst_rate = case when p ? 'bill_gst_rate' then nullif(p->>'bill_gst_rate','')::numeric else bill_gst_rate end,
      tags = coalesce(p->>'tags', tags), notes = coalesce(p->>'notes', notes), active = coalesce((p->>'active')::boolean, active), updated_at = now()
    where id = pid;
    perform acc_audit_log(tid, 'update', 'party', pid::text, to_jsonb(old), p);
  end if;
  return jsonb_build_object('id', pid, 'duplicate_gstin_of', dup);
end $$;

create or replace function acc_list_parties(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; k text := nullif(p->>'kind', ''); q text := nullif(trim(coalesce(p->>'search', '')), ''); pt text := nullif(p->>'party_type', '');
  buy text[] := array['bill','debit_note','expense','purchase_request','purchase_order','goods_receipt'];
  sell text[] := array['invoice','credit_note','quotation','sales_order','delivery_challan'];
begin
  tid := acc_guard('acc_view');
  return jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(x) order by lower(x.name)) from (
    select pa.id, pa.kind, pa.party_type, pa.category, pa.bank_name, pa.bank_account, pa.bank_ifsc, pa.upi_id, pa.gst_mode, pa.bill_gst_rate, pa.code, pa.name, pa.gstin, pa.state_code, pa.phone, pa.email, pa.credit_limit, pa.credit_days, pa.reg_type, pa.is_walkin, pa.active, pa.billing_address, pa.shipping_address, pa.contact_name, pa.pan, pa.tags, pa.notes,
      coalesce(b.bal, 0) as balance,
      coalesce((select sum(d.total - d.paid) from acc_documents d where d.party_id = pa.id and d.status = 'posted' and d.doc_type in ('invoice', 'bill', 'expense') and d.total > d.paid and d.due_date < current_date), 0) as overdue
    from acc_parties pa
    left join (select jl.party_id, sum(jl.debit - jl.credit) bal from acc_journal_lines jl join acc_accounts a on a.id = jl.account_id
               where jl.tenant_id = tid and a.system_key in ('ar', 'ap') group by jl.party_id) b on b.party_id = pa.id
    where pa.tenant_id = tid
      and (k is null or pa.kind = k or (k <> 'both' and pa.kind = 'both')
           or (k in ('customer','supplier') and exists (select 1 from acc_documents d where d.party_id = pa.id and d.tenant_id = tid and d.status <> 'cancelled'
               and d.doc_type = any(case when k = 'supplier' then buy else sell end))))
      and (pt is null or pa.party_type = pt)
      and (pt is not null or k is null or pa.party_type is null or pa.party_type in ('customer', 'supplier'))
      and (q is null or pa.name ilike '%' || q || '%' or pa.gstin ilike '%' || q || '%' or pa.phone ilike '%' || q || '%' or pa.code ilike '%' || q || '%')
      and (coalesce((p->>'include_inactive')::boolean, false) or pa.active)
    order by lower(pa.name) limit least(coalesce((p->>'limit')::int, 1000), 5000)) x), '[]'));
end $$;
