-- AUZsLedger: post AUZsPOS and AUZsMob sales into the books.
-- One journal per finished sale, posted once (idempotent on the sale id), reversed when the sale is voided, and a refund journal per POS refund.
-- Revenue and tax are booked; stock and cost of goods are NOT (those apps track stock on their own, not in AUZsLedger).
-- POS/shop sales tax goes to its own liability account (pos_gst) so the invoice-based GST registers and the integrity check stay true;
-- the GSTR-3B preparation view adds it back through acc_sales_sync_totals().

create table if not exists acc_sales_sync (
  tenant_id uuid not null references tenants(id) on delete cascade,
  source text not null check (source in ('pos', 'mob')),
  source_id text not null,
  ref text not null,                       -- 'sale', 'void', 'refund:<n>'
  kind text not null check (kind in ('sale', 'void', 'refund')),
  journal_id uuid references acc_journals(id),
  jdate date not null,
  net numeric(16,2) not null default 0,    -- signed revenue booked (negative for void / refund)
  tax numeric(16,2) not null default 0,    -- signed tax booked
  created_at timestamptz not null default now(),
  primary key (tenant_id, source, source_id, ref)
);
create index if not exists acc_sales_sync_d on acc_sales_sync (tenant_id, source, jdate);
alter table acc_sales_sync enable row level security;      -- no policies: only the functions below touch it

create or replace function acc_ensure_sales_accounts(tid uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into acc_accounts (tenant_id, code, name, type, grp, system_key)
  select tid, '1450', 'Sales to be settled', 'asset', 'Current assets', 'sales_clearing'
  where not exists (select 1 from acc_accounts where tenant_id = tid and system_key = 'sales_clearing') on conflict do nothing;
  insert into acc_accounts (tenant_id, code, name, type, grp, system_key)
  select tid, '2250', 'GST on POS and shop sales', 'liability', 'Duties and taxes', 'pos_gst'
  where not exists (select 1 from acc_accounts where tenant_id = tid and system_key = 'pos_gst') on conflict do nothing;
end $$;

-- the journal that carries a posted sale (or null)
create or replace function acc_sales_sync_posted(tid uuid, src text, sid text, r text) returns uuid language sql stable security definer set search_path = public as $$
  select journal_id from acc_sales_sync where tenant_id = tid and source = src and source_id = sid and ref = r
$$;

create or replace function acc_sales_sync_core(tid uuid, src text, p_from date, p_to date, lim int default 500) returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; d date; fy uuid; lines jsonb; jid uuid; n_post int := 0; n_rev int := 0; n_ref int := 0; n_skip int := 0; n_seen int := 0; errs jsonb := '[]';
  a_cash uuid; a_bank uuid; a_clr uuid; a_sales uuid; a_ret uuid; a_tax uuid; a_round uuid; lock_d date;
  tot numeric; tx numeric; rnd numeric; net numeric; cash_in numeric; bank_in numeric; clr numeric; chg numeric; p jsonb; m text; amt numeric;
  rf jsonb; idx int; rfd date; rfa numeric; rtax numeric; racct uuid; sid text;
begin
  perform pg_advisory_xact_lock(hashtext('salessync' || tid::text));
  perform acc_ensure_sales_accounts(tid);
  a_cash := acc_sys(tid, 'cash'); a_bank := acc_sys(tid, 'bank'); a_clr := acc_sys(tid, 'sales_clearing'); a_sales := acc_sys(tid, 'sales'); a_ret := acc_sys(tid, 'sales_return');
  a_tax := acc_sys(tid, 'pos_gst'); a_round := acc_sys(tid, 'round_off');
  select lock_date into lock_d from acc_org where tenant_id = tid;
  if src = 'pos' then
    for r in select rc.id, rc.data from records rc where rc.tenant_id = tid and rc.kind = 'order' and not rc.deleted and rc.data ? 'paidAt' and rc.data->>'status' in ('paid', 'void')
        and ((rc.data->>'paidAt')::timestamptz at time zone 'Asia/Kolkata')::date between p_from and p_to order by (rc.data->>'paidAt')::timestamptz limit lim loop
      n_seen := n_seen + 1; sid := r.id;
      begin
        d := ((r.data->>'paidAt')::timestamptz at time zone 'Asia/Kolkata')::date;
        jid := acc_sales_sync_posted(tid, 'pos', sid, 'sale');
        if jid is null then
          if r.data->>'status' <> 'paid' then n_skip := n_skip + 1; continue; end if;
          tot := coalesce((r.data->'t'->>'total')::numeric, 0); tx := coalesce((r.data->'t'->>'tax')::numeric, 0); rnd := coalesce((r.data->'t'->>'round')::numeric, 0);
          if tot <= 0 then n_skip := n_skip + 1; continue; end if;
          net := round(tot - tx - rnd, 2);
          cash_in := 0; bank_in := 0; chg := 0;
          for p in select * from jsonb_array_elements(coalesce(r.data->'pays', '[]')) loop
            m := lower(coalesce(p->>'m', 'cash')); amt := coalesce((p->>'amt')::numeric, 0); chg := chg + coalesce((p->>'change')::numeric, 0);
            if m = 'cash' then cash_in := cash_in + amt; elsif m = 'giftcard' then null; else bank_in := bank_in + amt; end if;
          end loop;
          cash_in := greatest(cash_in - chg, 0);
          if cash_in + bank_in > tot then cash_in := greatest(tot - bank_in, 0); bank_in := least(bank_in, tot - cash_in); end if;
          clr := round(tot - cash_in - bank_in, 2);
          fy := acc_assert_open(tid, d);
          lines := '[]'::jsonb;
          lines := acc_jl(lines, a_cash, null, cash_in); lines := acc_jl(lines, a_bank, null, bank_in); lines := acc_jl(lines, a_clr, null, clr);
          lines := acc_jl(lines, a_sales, null, -net); lines := acc_jl(lines, a_tax, null, -tx); lines := acc_jl(lines, a_round, null, -rnd);
          jid := acc_post_journal(tid, 'sales', d, fy, null, 'POS bill ' || coalesce(r.data->>'no', sid), 'pos_sale', md5(tid::text || sid)::uuid, lines);
          insert into acc_sales_sync (tenant_id, source, source_id, ref, kind, journal_id, jdate, net, tax) values (tid, 'pos', sid, 'sale', 'sale', jid, d, net + rnd, tx);
          n_post := n_post + 1;
        end if;
        -- voided after posting: reverse once
        if r.data->>'status' = 'void' and acc_sales_sync_posted(tid, 'pos', sid, 'void') is null then
          jid := acc_sales_sync_posted(tid, 'pos', sid, 'sale');
          if jid is not null then
            d := greatest(current_date, coalesce(lock_d + 1, current_date));
            insert into acc_sales_sync (tenant_id, source, source_id, ref, kind, journal_id, jdate, net, tax)
              select tid, 'pos', sid, 'void', 'void', acc_reverse_journal(tid, jid, d, 'POS bill voided'), d, -s.net, -s.tax from acc_sales_sync s where s.tenant_id = tid and s.source = 'pos' and s.source_id = sid and s.ref = 'sale';
            n_rev := n_rev + 1;
          end if;
        end if;
        -- refunds on a posted, not voided bill
        if r.data->>'status' = 'paid' and acc_sales_sync_posted(tid, 'pos', sid, 'sale') is not null and jsonb_typeof(r.data->'refunds') = 'array' then
          tot := coalesce((r.data->'t'->>'total')::numeric, 0); tx := coalesce((r.data->'t'->>'tax')::numeric, 0);
          idx := 0;
          for rf in select * from jsonb_array_elements(r.data->'refunds') loop
            idx := idx + 1;
            continue when acc_sales_sync_posted(tid, 'pos', sid, 'refund:' || idx) is not null;
            rfa := coalesce((rf->>'amt')::numeric, 0); continue when rfa <= 0;
            rfd := coalesce(((rf->>'at')::timestamptz at time zone 'Asia/Kolkata')::date, current_date);
            if lock_d is not null and rfd <= lock_d then rfd := lock_d + 1; end if;
            rtax := case when tot > 0 then round(rfa * tx / tot, 2) else 0 end;
            racct := case when lower(coalesce(rf->>'m', 'cash')) = 'cash' then a_cash else a_bank end;
            fy := acc_assert_open(tid, rfd);
            lines := '[]'::jsonb;
            lines := acc_jl(lines, a_ret, null, rfa - rtax); lines := acc_jl(lines, a_tax, null, rtax); lines := acc_jl(lines, racct, null, -rfa);
            jid := acc_post_journal(tid, 'sales', rfd, fy, null, 'POS refund on bill ' || coalesce(r.data->>'no', sid), 'pos_refund', md5(tid::text || sid || ':' || idx)::uuid, lines);
            insert into acc_sales_sync (tenant_id, source, source_id, ref, kind, journal_id, jdate, net, tax) values (tid, 'pos', sid, 'refund:' || idx, 'refund', jid, rfd, -(rfa - rtax), -rtax);
            n_ref := n_ref + 1;
          end loop;
        end if;
      exception when others then
        if jsonb_array_length(errs) < 5 then errs := errs || jsonb_build_array(jsonb_build_object('id', sid, 'error', sqlerrm)); end if;
      end;
    end loop;
  elsif src = 'mob' then
    for r in select s.id, s.bill_no, s.total, s.paid, s.balance, s.payment_mode, s.voided, s.created_at from mob_sales s where s.tenant_id = tid
        and (s.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to order by s.created_at limit lim loop
      n_seen := n_seen + 1; sid := r.id::text;
      begin
        d := (r.created_at at time zone 'Asia/Kolkata')::date;
        jid := acc_sales_sync_posted(tid, 'mob', sid, 'sale');
        if jid is null then
          if r.voided or r.total <= 0 then n_skip := n_skip + 1; continue; end if;
          cash_in := 0; bank_in := 0;
          if r.payment_mode in ('upi', 'card') then bank_in := least(r.paid, r.total); else cash_in := least(r.paid, r.total); end if;
          clr := round(r.total - cash_in - bank_in, 2);
          fy := acc_assert_open(tid, d);
          lines := '[]'::jsonb;
          lines := acc_jl(lines, a_cash, null, cash_in); lines := acc_jl(lines, a_bank, null, bank_in); lines := acc_jl(lines, a_clr, null, clr); lines := acc_jl(lines, a_sales, null, -r.total);
          jid := acc_post_journal(tid, 'sales', d, fy, null, 'Shop bill ' || coalesce(r.bill_no, sid), 'mob_sale', r.id, lines);
          insert into acc_sales_sync (tenant_id, source, source_id, ref, kind, journal_id, jdate, net, tax) values (tid, 'mob', sid, 'sale', 'sale', jid, d, r.total, 0);
          n_post := n_post + 1;
        end if;
        if r.voided and acc_sales_sync_posted(tid, 'mob', sid, 'void') is null then
          jid := acc_sales_sync_posted(tid, 'mob', sid, 'sale');
          if jid is not null then
            d := greatest(current_date, coalesce(lock_d + 1, current_date));
            insert into acc_sales_sync (tenant_id, source, source_id, ref, kind, journal_id, jdate, net, tax)
              select tid, 'mob', sid, 'void', 'void', acc_reverse_journal(tid, jid, d, 'Shop bill voided'), d, -s.net, 0 from acc_sales_sync s where s.tenant_id = tid and s.source = 'mob' and s.source_id = sid and s.ref = 'sale';
            n_rev := n_rev + 1;
          end if;
        end if;
      exception when others then
        if jsonb_array_length(errs) < 5 then errs := errs || jsonb_build_array(jsonb_build_object('id', sid, 'error', sqlerrm)); end if;
      end;
    end loop;
  else raise exception 'Unknown sales source %', src;
  end if;
  return jsonb_build_object('source', src, 'posted', n_post, 'reversed', n_rev, 'refunds', n_ref, 'skipped', n_skip, 'seen', n_seen, 'errors', errs, 'more', n_seen >= lim);
end $$;

-- what the books hold from these apps in a period (used by the GSTR-3B preparation view)
create or replace function acc_sales_sync_totals(p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_reports');
  return jsonb_build_object('from', p_from, 'to', p_to,
    'pos', (select jsonb_build_object('net', coalesce(sum(net), 0), 'tax', coalesce(sum(tax), 0), 'bills', count(*) filter (where kind = 'sale')) from acc_sales_sync where tenant_id = tid and source = 'pos' and jdate between p_from and p_to),
    'mob', (select jsonb_build_object('net', coalesce(sum(net), 0), 'tax', coalesce(sum(tax), 0), 'bills', count(*) filter (where kind = 'sale')) from acc_sales_sync where tenant_id = tid and source = 'mob' and jdate between p_from and p_to));
end $$;

-- run now (owner / people who may post): p {source: pos|mob|all, from, to}
create or replace function acc_sales_sync_run(p jsonb default '{}') returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; s text := coalesce(nullif(p->>'source', ''), 'all'); fr date; tt date; res jsonb := '{}'; feats jsonb;
begin
  tid := acc_guard('acc_post');
  tt := coalesce(nullif(p->>'to', '')::date, current_date); fr := coalesce(nullif(p->>'from', '')::date, tt - 30);
  if tt - fr > 400 then raise exception 'Choose a period of up to 400 days'; end if;
  select features into feats from tenant_settings where tenant_id = tid;
  if s in ('pos', 'all') and (s = 'pos' or coalesce((feats->>'pos')::boolean, false)) then res := res || jsonb_build_object('pos', acc_sales_sync_core(tid, 'pos', fr, tt)); end if;
  if s in ('mob', 'all') and (s = 'mob' or coalesce((feats->>'mobile')::boolean, false)) then res := res || jsonb_build_object('mob', acc_sales_sync_core(tid, 'mob', fr, tt)); end if;
  insert into acc_audit (tenant_id, actor, action, entity, entity_id, new_value) values (tid, app_uid(), 'sales_sync', 'acc_sales_sync', null, res);
  return jsonb_build_object('from', fr, 'to', tt, 'result', res);
end $$;

create or replace function acc_sales_sync_status() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; st jsonb; feats jsonb;
begin
  tid := acc_guard('acc_view');
  select features into feats from tenant_settings where tenant_id = tid;
  select coalesce(settings->'sales_sync', '{}') into st from acc_org where tenant_id = tid;
  return jsonb_build_object('settings', st, 'has_pos', coalesce((feats->>'pos')::boolean, false), 'has_mob', coalesce((feats->>'mobile')::boolean, false),
    'counts', (select coalesce(jsonb_object_agg(source, n), '{}') from (select source, count(*) filter (where kind = 'sale') n from acc_sales_sync where tenant_id = tid group by source) c),
    'last', (select max(created_at) from acc_sales_sync where tenant_id = tid));
end $$;

create or replace function acc_sales_sync_settings(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_admin');
  update acc_org set settings = jsonb_set(coalesce(settings, '{}'), '{sales_sync}', jsonb_build_object('pos', coalesce((p->>'pos')::boolean, false), 'mob', coalesce((p->>'mob')::boolean, false))) where tenant_id = tid;
  return acc_sales_sync_status();
end $$;

-- daily automation (called by the server, not an RPC): every business that switched it on, last 45 days (already-posted sales are skipped)
create or replace function acc_sales_sync_auto() returns jsonb language plpgsql security definer set search_path = public as $$
declare o record; n int := 0; fails int := 0;
begin
  for o in select ao.tenant_id, ao.settings->'sales_sync' as ss from acc_org ao join tenant_settings ts on ts.tenant_id = ao.tenant_id
      where coalesce((ts.features->>'accounting')::boolean, false) and ao.settings->'sales_sync' is not null loop
    begin
      if coalesce((o.ss->>'pos')::boolean, false) then perform acc_sales_sync_core(o.tenant_id, 'pos', current_date - 45, current_date); end if;
      if coalesce((o.ss->>'mob')::boolean, false) then perform acc_sales_sync_core(o.tenant_id, 'mob', current_date - 45, current_date); end if;
      n := n + 1;
    exception when others then fails := fails + 1;
    end;
  end loop;
  return jsonb_build_object('tenants', n, 'failed', fails);
end $$;
