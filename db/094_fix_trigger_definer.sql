-- Payroll would not open ("permission denied for table pay_journal_lines") and finalising a payroll failed.
-- Cause: the deferred trigger function pay_check_balanced() reads pay_journal_lines but was not SECURITY DEFINER.
-- A deferred constraint trigger fires at COMMIT as the connecting role (`app`), which has no rights on pay_* tables
-- by design (db/073), so the check itself was refused. Make every pay_/mob_/acc_ trigger function run as its owner,
-- like the rest of those modules. Safe to run more than once.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prorettype = 'pg_catalog.trigger'::regtype and not p.prosecdef
      and (p.proname like 'pay\_%' or p.proname like 'mob\_%' or p.proname like 'acc\_%')
  loop
    execute format('alter function %s security definer set search_path = public', f.sig);
  end loop;
end $$;
