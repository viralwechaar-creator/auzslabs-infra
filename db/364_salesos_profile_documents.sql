-- AUZslab SalesOS: self-service profile editing + multiple personal documents (ID proof, resume,
-- certificates, ...). Reuses the existing profiles.name/profiles.phone columns (db/013) rather
-- than a parallel table. Documents are a separate per-staffer table with private storage,
-- following the exact pattern already used for job-application resumes (db/351) and expense
-- receipts (db/358): a row is created first (pending), the file is uploaded through an
-- authenticated storage route, then marked uploaded.
create table sos_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  staff_id uuid not null references auth_users(id) on delete cascade,
  label text not null,
  filename text,
  uploaded_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_sos_documents_staff on sos_documents (tenant_id, staff_id, created_at desc);
alter table sos_documents enable row level security;

create function sos_my_profile() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard(); row profiles%rowtype;
begin
  select * into row from profiles where id = app_uid() and tenant_id = tid;
  return jsonb_build_object('name', row.name, 'phone', row.phone, 'email', row.email, 'role', row.role);
end $$;

create function sos_profile_update(p_name text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard();
begin
  if nullif(btrim(p_name), '') is null then raise exception 'Enter your name'; end if;
  if p_phone is not null and nullif(btrim(p_phone), '') is not null and btrim(p_phone) !~ '^[0-9+() .-]{6,20}$' then raise exception 'Enter a valid phone number'; end if;
  update profiles set name = btrim(p_name), phone = nullif(btrim(coalesce(p_phone, '')), '') where id = app_uid() and tenant_id = tid;
  perform sos_log('update', 'profile', app_uid(), null);
  return sos_my_profile();
end $$;

create function sos_document_create(p_label text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard(); row sos_documents%rowtype;
begin
  if nullif(btrim(p_label), '') is null then raise exception 'Name the document first'; end if;
  insert into sos_documents (tenant_id, staff_id, label) values (tid, app_uid(), btrim(p_label)) returning * into row;
  return to_jsonb(row);
end $$;

-- called by the storage route right after the bytes land, never directly by the client.
create function sos_document_mark_uploaded(p_id uuid, p_filename text) returns boolean
language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard();
begin
  update sos_documents set filename = p_filename, uploaded_at = now() where id = p_id and tenant_id = tid and staff_id = app_uid();
  return found;
end $$;

create function sos_my_documents() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard();
begin
  return coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at desc) from sos_documents d where d.tenant_id = tid and d.staff_id = app_uid()), '[]'::jsonb);
end $$;

-- manager/admin: every staffer's documents, for HR purposes (ID proof on file, etc).
create function sos_all_documents() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_manage');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'staffName', coalesce(p.name, u.email),
      'uploaded', d.filename is not null, 'createdAt', d.created_at) order by d.created_at desc)
    from sos_documents d join auth_users u on u.id = d.staff_id left join profiles p on p.id = d.staff_id
    where d.tenant_id = tid), '[]'::jsonb);
end $$;

create function sos_document_delete(p_id uuid) returns boolean language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard();
begin
  delete from sos_documents where id = p_id and tenant_id = tid and (staff_id = app_uid() or sos_perm('sos_manage'));
  return found;
end $$;

-- authorizes a file read: the owner, or a manager. Used by the storage route (GET).
create function sos_document_file(p_id uuid) returns text language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard(); d sos_documents%rowtype;
begin
  select * into d from sos_documents where id = p_id and tenant_id = tid;
  if not found then raise exception 'document not found'; end if;
  if not (d.staff_id = app_uid() or sos_perm('sos_manage')) then raise exception 'not authorized'; end if;
  return d.filename;
end $$;

grant select, insert, update, delete on sos_documents to app;
grant execute on function sos_my_profile() to app;
grant execute on function sos_profile_update(text, text) to app;
grant execute on function sos_document_create(text) to app;
grant execute on function sos_document_mark_uploaded(uuid, text) to app;
grant execute on function sos_my_documents() to app;
grant execute on function sos_all_documents() to app;
grant execute on function sos_document_delete(uuid) to app;
grant execute on function sos_document_file(uuid) to app;
