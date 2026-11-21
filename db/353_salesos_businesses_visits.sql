-- AUZslab SalesOS: business database + visit workflow.
create table sos_businesses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  category text,
  owner_name text,
  contact_name text,
  contact_phone text,
  address text,
  city text,
  created_by uuid references auth_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_sos_businesses_city on sos_businesses (tenant_id, city);
alter table sos_businesses enable row level security;

create table sos_visits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  business_id uuid not null references sos_businesses(id) on delete cascade,
  staff_id uuid not null references auth_users(id) on delete cascade,
  status text not null default 'scheduled' check (status in ('scheduled', 'checked_in', 'completed', 'cancelled')),
  visit_type text,
  scheduled_at timestamptz,
  check_in_at timestamptz,
  check_in_lat double precision,
  check_in_lng double precision,
  check_out_at timestamptz,
  products_discussed text,
  current_software text,
  interest_level text check (interest_level in ('low', 'medium', 'high') or interest_level is null),
  outcome text,
  notes text,
  next_action text,
  follow_up_date date,
  created_at timestamptz not null default now()
);
create index idx_sos_visits_business on sos_visits (business_id, created_at desc);
create index idx_sos_visits_staff on sos_visits (tenant_id, staff_id, created_at desc);
alter table sos_visits enable row level security;

create function sos_business_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_field'); v_id uuid := nullif(p->>'id', '')::uuid; v_row sos_businesses%rowtype;
begin
  if nullif(btrim(p->>'name'), '') is null then raise exception 'Enter the business name'; end if;
  if v_id is null then
    insert into sos_businesses (tenant_id, name, category, owner_name, contact_name, contact_phone, address, city, created_by)
    values (tid, btrim(p->>'name'), nullif(p->>'category', ''), nullif(p->>'ownerName', ''), nullif(p->>'contactName', ''),
            nullif(p->>'contactPhone', ''), nullif(p->>'address', ''), nullif(p->>'city', ''), app_uid())
    returning * into v_row;
  else
    update sos_businesses set name = btrim(p->>'name'), category = nullif(p->>'category', ''), owner_name = nullif(p->>'ownerName', ''),
      contact_name = nullif(p->>'contactName', ''), contact_phone = nullif(p->>'contactPhone', ''), address = nullif(p->>'address', ''),
      city = nullif(p->>'city', ''), updated_at = now()
    where id = v_id and tenant_id = tid
    returning * into v_row;
    if not found then raise exception 'business not found'; end if;
  end if;
  return to_jsonb(v_row);
end $$;

create function sos_businesses_search(p_q text default '') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_field'); q text := nullif(btrim(p_q), '');
begin
  return coalesce((select jsonb_agg(to_jsonb(b) order by b.name) from sos_businesses b
    where b.tenant_id = tid and (q is null or b.name ilike '%' || q || '%' or b.city ilike '%' || q || '%')
    limit 50), '[]'::jsonb);
end $$;

create function sos_visit_start(p_business uuid, p_type text default null, p_lat double precision default null, p_lng double precision default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_field'); vid uuid;
begin
  if not exists (select 1 from sos_businesses where id = p_business and tenant_id = tid) then raise exception 'business not found'; end if;
  insert into sos_visits (tenant_id, business_id, staff_id, status, visit_type, check_in_at, check_in_lat, check_in_lng)
  values (tid, p_business, app_uid(), 'checked_in', p_type, now(), p_lat, p_lng)
  returning id into vid;
  return jsonb_build_object('id', vid);
end $$;

create function sos_visit_complete(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_field'); row sos_visits%rowtype;
begin
  update sos_visits set status = 'completed', check_out_at = now(),
    products_discussed = nullif(p->>'productsDiscussed', ''), current_software = nullif(p->>'currentSoftware', ''),
    interest_level = nullif(p->>'interestLevel', ''), outcome = nullif(p->>'outcome', ''), notes = nullif(p->>'notes', ''),
    next_action = nullif(p->>'nextAction', ''), follow_up_date = nullif(p->>'followUpDate', '')::date
  where id = p_id and tenant_id = tid and staff_id = app_uid() and status = 'checked_in'
  returning * into row;
  if not found then raise exception 'visit not found, not yours, or already completed'; end if;
  return to_jsonb(row);
end $$;

create function sos_my_visits(p_status text default 'all') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_field');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'status', v.status, 'businessId', v.business_id,
      'businessName', b.name, 'scheduledAt', v.scheduled_at, 'checkInAt', v.check_in_at, 'checkOutAt', v.check_out_at,
      'followUpDate', v.follow_up_date, 'outcome', v.outcome) order by coalesce(v.check_in_at, v.scheduled_at, v.created_at) desc)
    from sos_visits v join sos_businesses b on b.id = v.business_id
    where v.tenant_id = tid and v.staff_id = app_uid() and (p_status = 'all' or v.status = p_status)), '[]'::jsonb);
end $$;

create function sos_all_visits() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_manage');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'status', v.status, 'businessName', b.name,
      'staffName', coalesce(p.name, u.email), 'checkInAt', v.check_in_at, 'checkOutAt', v.check_out_at, 'outcome', v.outcome)
      order by coalesce(v.check_in_at, v.scheduled_at, v.created_at) desc)
    from sos_visits v join sos_businesses b on b.id = v.business_id join auth_users u on u.id = v.staff_id
    left join profiles p on p.id = v.staff_id where v.tenant_id = tid), '[]'::jsonb);
end $$;

grant select, insert, update on sos_businesses to app;
grant select, insert, update on sos_visits to app;
grant execute on function sos_business_save(jsonb) to app;
grant execute on function sos_businesses_search(text) to app;
grant execute on function sos_visit_start(uuid, text, double precision, double precision) to app;
grant execute on function sos_visit_complete(uuid, jsonb) to app;
grant execute on function sos_my_visits(text) to app;
grant execute on function sos_all_visits() to app;
