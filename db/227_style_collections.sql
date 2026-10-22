-- AUZsStyle: collections. A named group of styles ("Summer 2026", "Wedding wear") that a manager creates and fills.
-- Reachable only through the functions below (RLS on, no policies), like every other sty_* table.
create table if not exists sty_collections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null, note text,
  created_at timestamptz not null default now()
);
create unique index if not exists sty_collections_name on sty_collections(tenant_id, lower(name));
alter table sty_collections enable row level security;
create table if not exists sty_collection_styles (
  collection_id uuid not null references sty_collections(id) on delete cascade,
  style_id uuid not null references sty_styles(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (collection_id, style_id)
);
create index if not exists sty_cs_style on sty_collection_styles(style_id);
alter table sty_collection_styles enable row level security;

create or replace function sty_collections_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_view');
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'note', c.note,
      'styleIds', coalesce((select jsonb_agg(m.style_id) from sty_collection_styles m where m.collection_id = c.id), '[]'::jsonb)) order by lower(c.name))
    from sty_collections c where c.tenant_id = tid), '[]'::jsonb);
end $$;

create or replace function sty_collection_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cid uuid := nullif(p->>'id', '')::uuid; nm text := nullif(trim(coalesce(p->>'name', '')), '');
begin
  tid := sty_guard('sty_manage');
  if nm is null then raise exception 'Give the collection a name' using errcode = 'ST002'; end if;
  begin
    if cid is null then
      insert into sty_collections (tenant_id, name, note) values (tid, nm, nullif(trim(coalesce(p->>'note', '')), '')) returning id into cid;
    else
      update sty_collections set name = nm, note = case when p ? 'note' then nullif(trim(coalesce(p->>'note', '')), '') else note end where id = cid and tenant_id = tid;
      if not found then raise exception 'collection not found' using errcode = 'ST002'; end if;
    end if;
  exception when unique_violation then raise exception 'A collection with that name already exists' using errcode = 'ST002';
  end;
  perform sty_audit_log(tid, 'collection_save', cid::text, jsonb_build_object('name', nm));
  return jsonb_build_object('id', cid, 'name', nm);
end $$;

create or replace function sty_collection_delete(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_manage');
  delete from sty_collections where id = p_id and tenant_id = tid;
  if not found then raise exception 'collection not found' using errcode = 'ST002'; end if;
  perform sty_audit_log(tid, 'collection_delete', p_id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

-- add and/or remove styles in one call (styles of another business are ignored)
create or replace function sty_collection_members(p_id uuid, p_add uuid[] default null, p_remove uuid[] default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_manage');
  if not exists (select 1 from sty_collections where id = p_id and tenant_id = tid) then raise exception 'collection not found' using errcode = 'ST002'; end if;
  if p_add is not null then
    insert into sty_collection_styles (collection_id, style_id, tenant_id)
    select p_id, s.id, tid from sty_styles s where s.tenant_id = tid and s.id = any(p_add) on conflict do nothing;
  end if;
  if p_remove is not null then delete from sty_collection_styles where collection_id = p_id and tenant_id = tid and style_id = any(p_remove); end if;
  perform sty_audit_log(tid, 'collection_members', p_id::text, jsonb_build_object('add', coalesce(cardinality(p_add), 0), 'remove', coalesce(cardinality(p_remove), 0)));
  return jsonb_build_object('count', (select count(*) from sty_collection_styles where collection_id = p_id));
end $$;
