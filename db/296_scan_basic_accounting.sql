-- AUZsScan alone (no AUZsLedger): also allow the essential, everyday accounting: supplier bills, expenses and money paid (acc_purchase) and reading the basic reports (acc_reports).
-- Banking, journals, assets, audit and the other admin tools stay part of AUZsLedger.
create or replace function acc_guard(k text default 'acc_view') returns uuid language plpgsql stable security definer set search_path = public as $$
declare tid uuid; f jsonb; e jsonb; full_on boolean; scan_on boolean;
begin
  if me() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  tid := (me()->>'tenant_id')::uuid;
  if tid is null then raise exception 'not a tenant member'; end if;
  select features, enabled_features into f, e from tenant_settings where tenant_id = tid;
  full_on := coalesce(f->>'accounting', 'false') = 'true' and coalesce(e->>'accounting', 'true') <> 'false';
  scan_on := coalesce(f->>'scan', 'false') = 'true' and coalesce(e->>'scan', 'true') <> 'false';
  if not full_on then
    if not scan_on then raise exception 'Accounting is not enabled for this business'; end if;
    if k not in ('acc_view', 'acc_sales', 'acc_purchase', 'acc_reports', 'acc_inventory', 'acc_import', 'acc_admin', 'acc_cancel') then
      raise exception 'This is part of AUZsLedger, which is not on this business''s plan';
    end if;
  end if;
  if not acc_perm(k) then raise exception 'Your role does not allow this action (%)', k using errcode = '42501'; end if;
  return tid;
end $$;
