-- Subscriptions (db/304) only ever renewed when someone clicked "Renew now" -- the owner wanted renewal invoices to
-- raise themselves automatically on the renewal date, posted as real invoices, same discipline recurring documents
-- (db/065's acc_run_recurring) already use: no background worker exists in this stack, so "automatic" means caught
-- up the next time anyone opens Accounting, not a server-side cron. acc_renew_subscription (db/304) already does the
-- actual work (raise + post one period, advance renewal_date) -- this just loops it per subscription, catching up
-- every period that's gone by (capped at 36, same guard as acc_run_recurring) if nobody opened the app for a while,
-- and never blocks one subscriber's renewal failing (e.g. a closed period) from the rest.
create function acc_run_due_subscriptions(p_upto date default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; upto date := coalesce(p_upto, current_date); s record; made int := 0; failed int := 0; res jsonb := '[]'; out jsonb; guard int; rd date;
begin
  tid := acc_guard('acc_view');
  if not acc_perm('acc_sales') then return jsonb_build_object('created', 0, 'failed', 0, 'items', '[]'::jsonb); end if;
  for s in select id, party_id from acc_subscriptions where tenant_id = tid and status = 'active' and renewal_date <= upto order by renewal_date loop
    guard := 0;
    select renewal_date into rd from acc_subscriptions where id = s.id;
    while rd <= upto and guard < 36 loop
      guard := guard + 1;
      begin
        out := acc_renew_subscription(s.id, acc_perm('acc_post'));
        made := made + 1;
        res := res || jsonb_build_array(jsonb_build_object('party', (select name from acc_parties where id = s.party_id), 'number', out->>'number'));
      exception when others then
        failed := failed + 1; exit;
      end;
      select renewal_date into rd from acc_subscriptions where id = s.id;
    end loop;
  end loop;
  if made + failed > 0 then perform acc_audit_log(tid, 'run_recurring', 'subscription', null, null, jsonb_build_object('created', made, 'failed', failed)); end if;
  return jsonb_build_object('created', made, 'failed', failed, 'items', res);
end $$;
