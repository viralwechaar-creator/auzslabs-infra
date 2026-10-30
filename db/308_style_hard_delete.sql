-- AUZsStyle: deleting a style from Stock now removes it completely (the style, its sizes/colours and their stock, purchase and
-- transfer entries). Old bills and returns are kept: their lines keep the name, size, colour and price they were sold at,
-- and just stop pointing at the deleted item. Before this, a style with any history was only hidden.
do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass::text as tbl, c.conname, case when c.conrelid::regclass::text in ('sty_sale_lines', 'sty_return_lines') then 'set null' else 'cascade' end as act
    from pg_constraint c
    where c.contype = 'f' and c.confrelid = 'sty_variants'::regclass
      and c.conrelid::regclass::text in ('sty_stock_moves', 'sty_purchase_lines', 'sty_transfer_lines', 'sty_sale_lines', 'sty_return_lines')
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format('alter table %s add constraint %I foreign key (variant_id) references sty_variants(id) on delete %s', r.tbl, r.conname, r.act);
  end loop;
end $$;
alter table sty_sale_lines alter column variant_id drop not null;
alter table sty_return_lines alter column variant_id drop not null;

create or replace function sty_delete_styles(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; sid uuid; ids uuid[]; gone int := 0; nm text;
begin
  tid := sty_guard('sty_manage');
  select coalesce(array_agg(x::uuid), '{}') into ids from jsonb_array_elements_text(coalesce(p->'ids', '[]'::jsonb)) x;
  if coalesce(array_length(ids, 1), 0) = 0 then raise exception 'Choose at least one style' using errcode = 'ST002'; end if;
  if array_length(ids, 1) > 2000 then raise exception 'Choose at most 2000 styles at a time' using errcode = 'ST002'; end if;
  foreach sid in array ids loop
    select name into nm from sty_styles where id = sid and tenant_id = tid;
    if not found then continue; end if;
    delete from sty_variants where style_id = sid and tenant_id = tid;
    delete from sty_styles where id = sid and tenant_id = tid;
    gone := gone + 1;
    perform sty_audit_log(tid, 'style_delete', sid::text, jsonb_build_object('name', nm));
  end loop;
  return jsonb_build_object('deleted', gone, 'hidden', 0);
end $$;
-- The books health check skips bill lines of a deleted item (they no longer have a stock entry to match).
create or replace function sty_integrity_check() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; bad jsonb := '[]'::jsonb; n int;
begin
  tid := sty_guard('sty_manage');
  select count(*) into n from sty_sales s where s.tenant_id = tid and abs(s.total - (select coalesce(sum(net), 0) from sty_sale_lines where sale_id = s.id) - s.rounding) > 0.05;
  if n > 0 then bad := bad || jsonb_build_object('check', 'bill totals equal their lines', 'count', n); end if;
  select count(*) into n from sty_sale_lines l join sty_sales s on s.id = l.sale_id where s.tenant_id = tid and s.status <> 'void' and l.variant_id is not null
    and (select coalesce(-sum(qty), 0) from sty_stock_moves m where m.ref_id = s.id and m.variant_id = l.variant_id and m.kind in ('sale', 'void')) <> l.qty;
  if n > 0 then bad := bad || jsonb_build_object('check', 'every bill line has its stock move', 'count', n); end if;
  select count(*) into n from sty_variants v where v.tenant_id = tid and not (select allow_negative_stock from sty_settings where tenant_id = tid)
    and exists (select 1 from sty_stock_moves m where m.variant_id = v.id group by m.branch_id having sum(m.qty) < 0);
  if n > 0 then bad := bad || jsonb_build_object('check', 'no negative stock', 'count', n); end if;
  select count(*) into n from sty_sale_lines l join sty_sales s on s.id = l.sale_id where s.tenant_id = tid and l.returned > l.qty;
  if n > 0 then bad := bad || jsonb_build_object('check', 'returns not above quantity sold', 'count', n); end if;
  return jsonb_build_object('ok', jsonb_array_length(bad) = 0, 'problems', bad);
end $$;
-- Rollback: recreate sty_integrity_check from db/217 and sty_delete_styles from db/239 (hides a style that has history). The foreign keys can stay as they are.
