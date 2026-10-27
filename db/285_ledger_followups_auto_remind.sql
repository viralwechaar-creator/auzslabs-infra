-- AUZsLedger: follow-up notes (date + who follows up) and automatic overdue reminders.
create table if not exists acc_followups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  party_id uuid not null references acc_parties(id),
  note text not null, due_on date,
  assigned_to uuid, status text not null default 'open' check (status in ('open','done')),
  created_by uuid, created_at timestamptz not null default now(), done_at timestamptz
);
create index if not exists acc_followups_t on acc_followups (tenant_id, status, due_on);
alter table acc_followups enable row level security;

-- p: {id?, party_id, note, due_on?, assigned_to?}
create or replace function acc_followup_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; fid uuid := nullif(p->>'id', '')::uuid; asg uuid := nullif(p->>'assigned_to', '')::uuid;
begin
  tid := acc_guard('acc_sales');
  if coalesce(btrim(p->>'note'), '') = '' then raise exception 'Write what to follow up'; end if;
  if not exists (select 1 from acc_parties where id = (p->>'party_id')::uuid and tenant_id = tid) then raise exception 'Unknown party'; end if;
  if asg is not null and not exists (select 1 from profiles where id = asg and tenant_id = tid) then raise exception 'That person is not on your team'; end if;
  if fid is null then
    insert into acc_followups (tenant_id, party_id, note, due_on, assigned_to, created_by)
    values (tid, (p->>'party_id')::uuid, btrim(p->>'note'), nullif(p->>'due_on', '')::date, coalesce(asg, app_uid()), app_uid()) returning id into fid;
  else
    update acc_followups set note = btrim(p->>'note'), due_on = nullif(p->>'due_on', '')::date, assigned_to = coalesce(asg, assigned_to)
     where id = fid and tenant_id = tid;
    if not found then raise exception 'Follow-up not found'; end if;
  end if;
  return jsonb_build_object('id', fid);
end $$;

-- p: {party_id?, status? (open|done|all), mine?}
create or replace function acc_followup_list(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; st text := coalesce(nullif(p->>'status', ''), 'open');
begin
  tid := acc_guard('acc_view');
  return jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.due_on nulls last, x.created_at) from (
    select f.id, f.party_id, pa.name as party_name, pa.phone, f.note, f.due_on, f.status, f.assigned_to, pr.name as assignee, f.created_at, f.done_at,
           coalesce((select sum(d.total - d.paid) from acc_documents d where d.party_id = pa.id and d.status = 'posted' and d.doc_type = 'invoice' and d.total > d.paid), 0) as owed,
           f.due_on is not null and f.due_on < current_date and f.status = 'open' as late
      from acc_followups f join acc_parties pa on pa.id = f.party_id left join profiles pr on pr.id = f.assigned_to
     where f.tenant_id = tid and (st = 'all' or f.status = st)
       and (nullif(p->>'party_id', '') is null or f.party_id = (p->>'party_id')::uuid)
       and (not coalesce((p->>'mine')::boolean, false) or f.assigned_to = app_uid())
     order by f.due_on nulls last limit 500) x), '[]'));
end $$;

create or replace function acc_followup_done(p_id uuid, p_done boolean default true) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_sales');
  update acc_followups set status = case when p_done then 'done' else 'open' end, done_at = case when p_done then now() end where id = p_id and tenant_id = tid;
  if not found then raise exception 'Follow-up not found'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- Automatic reminders: acc_org.settings.auto_remind = {on, min_days (first reminder after this many days overdue), repeat_days}
create or replace function acc_auto_remind_get() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_view');
  return coalesce((select settings->'auto_remind' from acc_org where tenant_id = tid), '{}'::jsonb) || jsonb_build_object('wa_ready', coalesce((select enabled from wa_tenant_settings where tenant_id = tid), false));
end $$;

create or replace function acc_auto_remind_set(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; mn int := greatest(0, least(coalesce((p->>'min_days')::int, 1), 90)); rp int := greatest(2, least(coalesce((p->>'repeat_days')::int, 7), 60));
begin
  tid := acc_guard('acc_admin');
  update acc_org set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{auto_remind}', jsonb_build_object('on', coalesce((p->>'on')::boolean, false), 'min_days', mn, 'repeat_days', rp)) where tenant_id = tid;
  perform acc_audit_log(tid, 'update', 'auto_remind', tid::text, null, p);
  return acc_auto_remind_get();
end $$;

-- Daily job (server only, not an RPC): for every shop with it on, remind customers whose overdue is old enough.
-- One reminder per customer per repeat window (wa_outbox ref), so a rerun the same day sends nothing twice.
create or replace function acc_auto_remind_run() returns jsonb language plpgsql security definer set search_path = public as $$
declare o record; r record; sent int := 0; res jsonb; rp int; mn int;
begin
  for o in select tenant_id, settings->'auto_remind' as ar from acc_org where coalesce((settings->'auto_remind'->>'on')::boolean, false) loop
    begin
      mn := coalesce((o.ar->>'min_days')::int, 1); rp := greatest(2, coalesce((o.ar->>'repeat_days')::int, 7));
      for r in select pa.id, pa.name, pa.phone, sum(d.total - d.paid) as amt
                 from acc_documents d join acc_parties pa on pa.id = d.party_id
                where d.tenant_id = o.tenant_id and d.doc_type = 'invoice' and d.status = 'posted' and d.total > d.paid
                  and d.due_date is not null and d.due_date <= current_date - mn and coalesce(pa.phone, '') <> '' and pa.active
                group by pa.id, pa.name, pa.phone loop
        res := wa_due_send(o.tenant_id, r.phone, r.name, r.amt, 'auto-' || r.id || '-' || (current_date - date '2020-01-01') / rp);
        if (res->>'sent')::boolean then
          sent := sent + 1;
          insert into acc_comms (tenant_id, channel, kind, party_id, recipient, subject, body, status)
          values (o.tenant_id, 'whatsapp', 'payment_reminder', r.id, r.phone, 'Payment reminder', 'Sent automatically: overdue ' || wa_money(r.amt), 'sent');
        end if;
      end loop;
    exception when others then null;
    end;
  end loop;
  return jsonb_build_object('sent', sent);
end $$;

-- people of this business a follow-up can be given to
create or replace function acc_team_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_view');
  return jsonb_build_object('rows', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', coalesce(nullif(name, ''), email, 'Team member'), 'role', role) order by coalesce(name, email))
    from profiles where tenant_id = tid and coalesce(login_off, false) = false), '[]'));
end $$;
