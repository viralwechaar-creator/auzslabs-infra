-- AUZsFinance phase 4: GST and TDS as a memo on each entry (books are not split; this feeds a filing summary), plus a demo seed on the shared demo business.
alter table fin_txns add column if not exists tax_rate numeric(5,2);
alter table fin_txns add column if not exists tds_amt numeric(16,2);

create or replace function fin_save_txn(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; lim numeric; amt numeric := coalesce((p->>'amount')::numeric, 0); r jsonb; rate numeric := nullif(p->>'tax_rate','')::numeric; tds numeric := nullif(p->>'tds_amt','')::numeric;
begin
  tid := fin_guard('write');
  select approval_limit into lim from fin_settings where tenant_id = tid;
  if coalesce(lim, 0) > 0 and amt >= lim and coalesce(p->>'kind','') <> 'transfer' and not acc_perm('acc_approve') then
    p := p || jsonb_build_object('review', 'needs_review');
  end if;
  if rate is not null and (rate < 0 or rate > 40) then raise exception 'GST rate must be between 0 and 40'; end if;
  if tds is not null and (tds < 0 or tds > amt) then raise exception 'TDS cannot be more than the amount'; end if;
  r := fin_save_txn_core(p);
  if (rate is not null or tds is not null) and coalesce((r->>'duplicate')::boolean, false) = false then
    update fin_txns set tax_rate = nullif(rate, 0), tds_amt = nullif(tds, 0) where id = (r->>'id')::uuid and tenant_id = tid;
  end if;
  return r;
end $$;

-- GST (prices taken as including GST) and TDS, from the memo fields, for filing work
create or replace function fin_tax_summary(p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; o numeric := 0; i numeric := 0; ts numeric := 0; tp numeric := 0; tdc numeric := 0; tdw numeric := 0; byr jsonb;
begin
  tid := fin_guard('view');
  select coalesce(sum(amount * tax_rate / (100 + tax_rate)) filter (where kind in ('money_in','credit_sale')), 0),
         coalesce(sum(amount * tax_rate / (100 + tax_rate)) filter (where kind in ('expense','credit_purchase','asset_buy')), 0),
         coalesce(sum(amount - amount * tax_rate / (100 + tax_rate)) filter (where kind in ('money_in','credit_sale')), 0),
         coalesce(sum(amount - amount * tax_rate / (100 + tax_rate)) filter (where kind in ('expense','credit_purchase','asset_buy')), 0)
    into o, i, ts, tp
    from fin_txns where tenant_id = tid and status = 'posted' and tax_rate > 0 and txn_date between p_from and p_to;
  select coalesce(sum(tds_amt) filter (where kind in ('money_in','dues_in','credit_sale')), 0), coalesce(sum(tds_amt) filter (where kind in ('expense','dues_out','credit_purchase')), 0)
    into tdc, tdw from fin_txns where tenant_id = tid and status = 'posted' and tds_amt > 0 and txn_date between p_from and p_to;
  select coalesce(jsonb_agg(jsonb_build_object('rate', rate, 'out', round(ot, 2), 'in', round(it, 2)) order by rate), '[]') into byr from (
    select tax_rate rate, sum(amount * tax_rate / (100 + tax_rate)) filter (where kind in ('money_in','credit_sale')) ot,
           sum(amount * tax_rate / (100 + tax_rate)) filter (where kind in ('expense','credit_purchase','asset_buy')) it
    from fin_txns where tenant_id = tid and status = 'posted' and tax_rate > 0 and txn_date between p_from and p_to group by tax_rate) x;
  return jsonb_build_object('from', p_from, 'to', p_to, 'output_gst', round(o, 2), 'input_gst', round(i, 2), 'net_gst', round(o - i, 2),
    'taxable_sales', round(ts, 2), 'taxable_purchases', round(tp, 2), 'tds_cut_on_us', round(tdc, 2), 'tds_withheld', round(tdw, 2), 'by_rate', byr);
end $$;

-- demo business: feature on and a month of sample entries (only when it has none)
do $$
declare tid uuid; uid uuid; bank uuid; cash uuid; pt uuid; ps uuid; i int; n int; cats jsonb; ex jsonb; inc uuid; ctx jsonb;
begin
  select id into tid from tenants where slug = 'demo';
  if tid is null then return; end if;
  update tenant_settings set features = coalesce(features, '{}'::jsonb) || '{"finance":true}'::jsonb where tenant_id = tid;
  select id into uid from profiles where tenant_id = tid and role = 'owner' limit 1;
  if uid is null then return; end if;
  perform set_config('app.uid', uid::text, true);
  ctx := fin_bootstrap();
  select count(*) into n from fin_txns where tenant_id = tid;
  if n > 0 then return; end if;
  bank := (select (a->>'id')::uuid from jsonb_array_elements(ctx->'accounts') a where a->>'kind' = 'bank' limit 1);
  cash := (select (a->>'id')::uuid from jsonb_array_elements(ctx->'accounts') a where a->>'kind' = 'cash' limit 1);
  ex := ctx->'categories'->'expense'; inc := (select (c->>'id')::uuid from jsonb_array_elements(ctx->'categories'->'income') c limit 1);
  pt := (fin_save_partner(jsonb_build_object('name', 'Owner', 'kind', 'owner')))->>'id';
  perform fin_save_txn(jsonb_build_object('op', 'demo-cap', 'kind', 'capital_in', 'amount', 150000, 'account_id', bank, 'partner_id', pt, 'date', current_date - 40, 'evidence', 'have'));
  for i in 0..29 loop
    perform fin_save_txn(jsonb_build_object('op', 'demo-in-' || i, 'kind', 'money_in', 'amount', 2500 + (i * 937) % 5200, 'account_id', cash, 'category_id', inc, 'purpose', 'Sales', 'date', current_date - i, 'tax_rate', 18));
    if i % 2 = 1 then
      perform fin_save_txn(jsonb_build_object('op', 'demo-out-' || i, 'kind', 'expense', 'amount', 900 + (i * 611) % 3100, 'account_id', cash, 'category_id', (ex->(i % jsonb_array_length(ex))->>'id')::uuid, 'purpose', ex->(i % jsonb_array_length(ex))->>'name', 'date', current_date - i, 'evidence', case when i % 4 = 1 then 'have' else 'none' end));
    end if;
  end loop;
  ps := (fin_save_person(jsonb_build_object('name', 'Sample customer', 'kind', 'customer')))->>'id';
  perform fin_save_txn(jsonb_build_object('op', 'demo-credit', 'kind', 'credit_sale', 'amount', 8000, 'person_id', ps, 'date', current_date - 12, 'tax_rate', 18));
exception when others then
  raise notice 'demo finance seed skipped: %', sqlerrm;
end $$;
