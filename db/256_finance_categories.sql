-- AUZsFinance: a business can add its own expense / income categories (they are ledger accounts, like the ready-made ones).
create or replace function fin_save_category(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; nm text := btrim(coalesce(p->>'name','')); typ text := case when p->>'kind' = 'income' then 'income' else 'expense' end; r acc_accounts;
begin
  tid := fin_guard('write');
  if nm = '' then raise exception 'Give the category a name'; end if;
  if length(nm) > 60 then raise exception 'Keep the name under 60 letters'; end if;
  select * into r from acc_accounts where tenant_id = tid and type = typ and active and lower(name) = lower(nm) and coalesce(system_key,'') not in ('cogs','purchases','purchase_return','stock_adjust','dep_expense','sales_return','round_off','disposal_gl');
  if r.id is null then
    insert into acc_accounts (tenant_id, code, name, type, grp) select tid, 'FN' || lpad((coalesce(max(substring(code from 3)::int), 0) + 1)::text, 4, '0'), nm, typ, case when typ = 'income' then 'Other income' else 'Operating expenses' end
      from acc_accounts where tenant_id = tid and code ~ '^FN[0-9]+$' returning * into r;
    perform acc_audit_log(tid, 'create', 'fin_category', r.id::text, null, jsonb_build_object('name', nm, 'type', typ));
  end if;
  return jsonb_build_object('id', r.id, 'name', r.name, 'kind', typ);
end $$;
