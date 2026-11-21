-- AUZslab SalesOS: CRM lead pipeline. A lead is tied to a business; stage moves through the
-- funnel in the brief's own order. One active (non-lost/won) lead per business+product, unless
-- explicitly allowed, per the brief's duplicate-opportunity rule.
create table sos_leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  business_id uuid not null references sos_businesses(id) on delete cascade,
  product text,
  stage text not null default 'new_prospect' check (stage in
    ('new_prospect', 'contacted', 'qualified', 'interested', 'demo_scheduled', 'demo_completed',
     'trial_activated', 'negotiation', 'won', 'lost')),
  owner_id uuid references auth_users(id) on delete set null,
  deal_value numeric,
  follow_up_date date,
  lost_reason text,
  created_by uuid references auth_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_sos_leads_owner on sos_leads (tenant_id, owner_id);
create unique index idx_sos_leads_one_active on sos_leads (business_id, coalesce(product, ''))
  where stage not in ('won', 'lost');
alter table sos_leads enable row level security;

create table sos_lead_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references sos_leads(id) on delete cascade,
  author uuid references auth_users(id) on delete set null,
  kind text not null default 'note' check (kind in ('note', 'stage', 'assign', 'created')),
  body text,
  created_at timestamptz not null default now()
);
create index idx_sos_lead_notes_lead on sos_lead_notes (lead_id, created_at desc);
alter table sos_lead_notes enable row level security;

create function sos_lead_json(l sos_leads) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', l.id, 'businessId', l.business_id, 'businessName', b.name, 'product', l.product,
    'stage', l.stage, 'ownerId', l.owner_id, 'ownerName', coalesce(p.name, u.email), 'dealValue', l.deal_value,
    'followUpDate', l.follow_up_date, 'lostReason', l.lost_reason, 'createdAt', l.created_at, 'updatedAt', l.updated_at)
  from sos_businesses b left join auth_users u on u.id = l.owner_id left join profiles p on p.id = l.owner_id
  where b.id = l.business_id
$$;

create function sos_lead_create(p_business uuid, p_product text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_field'); row sos_leads%rowtype;
begin
  if not exists (select 1 from sos_businesses where id = p_business and tenant_id = tid) then raise exception 'business not found'; end if;
  insert into sos_leads (tenant_id, business_id, product, owner_id, created_by) values (tid, p_business, p_product, app_uid(), app_uid())
  returning * into row;
  insert into sos_lead_notes (lead_id, author, kind, body) values (row.id, app_uid(), 'created', 'Lead created');
  return sos_lead_json(row);
end $$;

create function sos_lead_update(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; l sos_leads%rowtype; v_stage text; v_note text;
begin
  tid := sos_guard('sos_field');
  select * into l from sos_leads where id = p_id and tenant_id = tid for update;
  if not found then raise exception 'lead not found'; end if;
  if not (l.owner_id = app_uid() or l.created_by = app_uid() or sos_perm('sos_manage')) then raise exception 'this lead is not yours'; end if;

  v_stage := nullif(p->>'stage', '');
  if v_stage is not null and v_stage <> l.stage then
    update sos_leads set stage = v_stage, lost_reason = case when v_stage = 'lost' then nullif(p->>'lostReason', '') else lost_reason end, updated_at = now()
    where id = p_id;
    insert into sos_lead_notes (lead_id, author, kind, body) values (p_id, app_uid(), 'stage', l.stage || ' -> ' || v_stage);
  end if;
  if p ? 'followUpDate' then
    update sos_leads set follow_up_date = nullif(p->>'followUpDate', '')::date, updated_at = now() where id = p_id;
  end if;
  if p ? 'dealValue' then
    update sos_leads set deal_value = nullif(p->>'dealValue', '')::numeric, updated_at = now() where id = p_id;
  end if;
  v_note := nullif(btrim(coalesce(p->>'note', '')), '');
  if v_note is not null then
    insert into sos_lead_notes (lead_id, author, kind, body) values (p_id, app_uid(), 'note', v_note);
  end if;
  select * into l from sos_leads where id = p_id;
  return sos_lead_json(l);
end $$;

create function sos_lead_assign(p_id uuid, p_owner uuid) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_manage');
begin
  if p_owner is not null and not exists (select 1 from profiles where id = p_owner and tenant_id = tid) then
    raise exception 'that person is not on this team';
  end if;
  update sos_leads set owner_id = p_owner, updated_at = now() where id = p_id and tenant_id = tid;
  if not found then raise exception 'lead not found'; end if;
  insert into sos_lead_notes (lead_id, author, kind, body) values (p_id, app_uid(), 'assign', 'Reassigned');
end $$;

create function sos_my_leads() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_field');
begin
  return coalesce((select jsonb_agg(sos_lead_json(l) order by (l.follow_up_date is null), l.follow_up_date, l.updated_at desc)
    from sos_leads l where l.tenant_id = tid and (l.owner_id = app_uid() or l.created_by = app_uid())), '[]'::jsonb);
end $$;

create function sos_all_leads() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_manage');
begin
  return coalesce((select jsonb_agg(sos_lead_json(l) order by l.updated_at desc) from sos_leads l where l.tenant_id = tid), '[]'::jsonb);
end $$;

create function sos_lead_notes(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_field'); l sos_leads%rowtype;
begin
  select * into l from sos_leads where id = p_id and tenant_id = tid;
  if not found then raise exception 'lead not found'; end if;
  if not (l.owner_id = app_uid() or l.created_by = app_uid() or sos_perm('sos_manage')) then raise exception 'this lead is not yours'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'body', body, 'createdAt', created_at) order by created_at desc)
    from sos_lead_notes where lead_id = p_id), '[]'::jsonb);
end $$;

grant select, insert, update on sos_leads to app;
grant select, insert on sos_lead_notes to app;
grant execute on function sos_lead_create(uuid, text) to app;
grant execute on function sos_lead_update(uuid, jsonb) to app;
grant execute on function sos_lead_assign(uuid, uuid) to app;
grant execute on function sos_my_leads() to app;
grant execute on function sos_all_leads() to app;
grant execute on function sos_lead_notes(uuid) to app;
