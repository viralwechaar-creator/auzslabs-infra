create table sty_supplier_notes (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  supplier_id uuid not null references sty_suppliers(id),
  purchase_id uuid references sty_purchases(id),
  kind text not null check (kind in ('credit', 'debit')),
  reference text not null check (length(reference) between 1 and 120),
  amount numeric(14,2) not null check (amount > 0),
  reason text not null check (length(reason) between 1 and 2000),
  issued_on date not null,
  created_at timestamptz not null default now()
);
alter table sty_supplier_notes enable row level security;
create index sty_supplier_notes_lookup on sty_supplier_notes(tenant_id, supplier_id, issued_on);

create function sty_save_supplier_note(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  tid uuid := sty_guard('sty_purchase');
  sid uuid := (p->>'supplierId')::uuid;
  pid uuid := nullif(p->>'purchaseId', '')::uuid;
  nid uuid := (p->>'id')::uuid;
begin
  if not exists (select 1 from sty_suppliers where tenant_id = tid and id = sid) then
    raise exception 'Supplier not found';
  end if;
  if pid is not null and not exists (
    select 1 from sty_purchases where tenant_id = tid and supplier_id = sid and id = pid
  ) then
    raise exception 'Purchase does not belong to this supplier';
  end if;
  insert into sty_supplier_notes(id, tenant_id, supplier_id, purchase_id, kind, reference, amount, reason, issued_on)
  values (nid, tid, sid, pid, p->>'kind', btrim(p->>'reference'), (p->>'amount')::numeric,
    btrim(p->>'reason'), (p->>'issuedOn')::date)
  on conflict (id) do nothing;
  if not exists (select 1 from sty_supplier_notes where id = nid and tenant_id = tid and supplier_id = sid) then
    raise exception 'Could not record supplier note';
  end if;
  return nid;
end $$;

create function sty_supplier_account(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sty_guard('sty_purchase');
begin
  if not exists (select 1 from sty_suppliers where id = p_id and tenant_id = tid) then
    raise exception 'Supplier not found';
  end if;
  return (
    with invoices as (
      select pu.id, pu.invoice_no as reference, pu.at, pu.total, pu.paid, pu.status,
        coalesce((select sum(l.qty) from sty_purchase_lines l where l.purchase_id = pu.id and l.tenant_id = tid), 0) as units
      from sty_purchases pu where pu.tenant_id = tid and pu.supplier_id = p_id
    ), payments as (
      select sp.id, sp.purchase_id, sp.at, sp.amount, sp.mode, sp.note, i.reference
      from sty_supplier_payments sp left join invoices i on i.id = sp.purchase_id
      where sp.tenant_id = tid and sp.supplier_id = p_id
    ), notes as (
      select n.id, n.purchase_id, n.kind, n.reference, n.amount, n.reason, n.issued_on, i.reference as invoice_reference
      from sty_supplier_notes n left join invoices i on i.id = n.purchase_id
      where n.tenant_id = tid and n.supplier_id = p_id
    )
    select jsonb_build_object(
      'invoices', coalesce((select jsonb_agg(i order by i.at desc, i.id) from invoices i), '[]'::jsonb),
      'payments', coalesce((select jsonb_agg(p order by p.at desc, p.id) from payments p), '[]'::jsonb),
      'notes', coalesce((select jsonb_agg(n order by n.issued_on desc, n.id) from notes n), '[]'::jsonb),
      'bought', coalesce((select sum(total) from invoices), 0),
      'paid', coalesce((select sum(amount) from payments), 0),
      'creditNotes', coalesce((select sum(amount) from notes where kind = 'credit'), 0),
      'debitNotes', coalesce((select sum(amount) from notes where kind = 'debit'), 0)
    )
  );
end $$;
revoke execute on function sty_supplier_account(uuid), sty_save_supplier_note(jsonb) from public;
grant execute on function sty_supplier_account(uuid), sty_save_supplier_note(jsonb) to app;
