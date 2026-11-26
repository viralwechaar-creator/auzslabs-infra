-- Storefront round G: redirects, blog, SEO fields, theme revisions, custom data (metafields and metaobjects).
--  * Changing a product or collection handle leaves a redirect from the old address, and older redirects are re-pointed so chains stay one hop.
--  * Store settings are snapshotted before every save (last 30 kept) and can be restored; restoring itself takes a snapshot first.
--  * Custom data: definitions (what a field is) and values (what it holds), checked against the definition's type.

-- ---------- redirects ----------
create table sfx_redirects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  from_path text not null, to_path text not null, auto boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index idx_sfx_redirect_from on sfx_redirects (tenant_id, lower(from_path));
alter table sfx_redirects enable row level security;

create function sfx_redirect_add(p_tenant uuid, p_from text, p_to text, p_auto boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_from = p_to then return; end if;
  delete from sfx_redirects where tenant_id = p_tenant and lower(from_path) = lower(p_to);        -- the new address is live again, so it must not redirect away
  update sfx_redirects set to_path = p_to where tenant_id = p_tenant and lower(to_path) = lower(p_from);  -- keep chains to one hop
  insert into sfx_redirects (tenant_id, from_path, to_path, auto) values (p_tenant, p_from, p_to, p_auto)
    on conflict (tenant_id, lower(from_path)) do update set to_path = excluded.to_path;
end $$;

create function sfx_handle_redirect() returns trigger language plpgsql security definer set search_path = public as $$
declare kind text := tg_argv[0];
begin
  if old.handle is not null and new.handle is not null and old.handle <> new.handle then
    perform sfx_redirect_add(new.tenant_id, '/' || kind || '/' || old.handle, '/' || kind || '/' || new.handle, true);
  end if;
  return new;
end $$;
create trigger sfx_products_handle_redirect after update of handle on sfx_products for each row execute function sfx_handle_redirect('products');
create trigger sfx_collections_handle_redirect after update of handle on sfx_collections for each row execute function sfx_handle_redirect('collections');

create function sfx_redirect_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'from', r.from_path, 'to', r.to_path, 'auto', r.auto, 'createdAt', r.created_at) order by r.created_at desc) from sfx_redirects r where r.tenant_id = tid), '[]'::jsonb);
end $$;
create function sfx_redirect_save(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); f text := trim(coalesce(p->>'from', '')); t text := trim(coalesce(p->>'to', '')); r sfx_redirects;
begin
  if f !~ '^/[A-Za-z0-9/_.~%-]*$' or length(f) > 200 or f = '/' then raise exception 'The old address must start with / (for example /old-page)' using errcode = 'SF002'; end if;
  if t !~ '^(/[A-Za-z0-9/_.~%?=&-]*|https://[^ ]{4,})$' or length(t) > 300 then raise exception 'The new address must start with / or https://' using errcode = 'SF002'; end if;
  if lower(f) = lower(t) then raise exception 'The old and new address are the same' using errcode = 'SF002'; end if;
  if exists (select 1 from sfx_redirects where tenant_id = tid and lower(from_path) = lower(t)) then raise exception 'That would make a loop: the new address already redirects somewhere' using errcode = 'SF002'; end if;
  if p_id is null and (select count(*) from sfx_redirects where tenant_id = tid) >= 500 then raise exception 'Up to 500 redirects' using errcode = 'SF002'; end if;
  begin
    if p_id is null then insert into sfx_redirects (tenant_id, from_path, to_path) values (tid, f, t) returning * into r;
    else update sfx_redirects set from_path = f, to_path = t, auto = false where id = p_id and tenant_id = tid returning * into r;
      if not found then raise exception 'Redirect not found' using errcode = 'SF003'; end if; end if;
  exception when unique_violation then raise exception 'There is already a redirect from that address' using errcode = 'SF002';
  end;
  return jsonb_build_object('id', r.id, 'from', r.from_path, 'to', r.to_path, 'auto', r.auto);
end $$;
create function sfx_redirect_delete(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage');
begin delete from sfx_redirects where id = p_id and tenant_id = tid; end $$;
create function public_sfx_redirect(p_slug text, p_path text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_public_tenant(p_slug); cur text := coalesce(p_path, ''); nxt text; i int := 0;
begin
  if tid is null then return null; end if;
  loop
    select to_path into nxt from sfx_redirects where tenant_id = tid and lower(from_path) = lower(cur);
    exit when nxt is null or i >= 5;
    cur := nxt; i := i + 1;
  end loop;
  if i = 0 then return null; end if;
  return jsonb_build_object('to', cur);
end $$;

-- ---------- blog ----------
create table sfx_blog_posts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  title text not null, handle text not null, excerpt text, body text not null default '', image text, author text,
  tags text[] not null default '{}', status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz, seo_title text, seo_description text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index idx_sfx_blog_handle on sfx_blog_posts (tenant_id, handle);
alter table sfx_blog_posts enable row level security;
create trigger sfx_blog_handle_redirect after update of handle on sfx_blog_posts for each row execute function sfx_handle_redirect('blog');

create function sfx_blog_json(b sfx_blog_posts) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', b.id, 'title', b.title, 'handle', b.handle, 'excerpt', b.excerpt, 'body', b.body, 'image', b.image, 'author', b.author, 'tags', to_jsonb(b.tags),
    'status', b.status, 'publishedAt', b.published_at, 'seoTitle', b.seo_title, 'seoDescription', b.seo_description, 'updatedAt', b.updated_at)
$$;
create function sfx_blog_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin return coalesce((select jsonb_agg(sfx_blog_json(b) - 'body' order by b.created_at desc) from sfx_blog_posts b where b.tenant_id = tid), '[]'::jsonb); end $$;
create function sfx_blog_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); b sfx_blog_posts;
begin select * into b from sfx_blog_posts where id = p_id and tenant_id = tid; if not found then raise exception 'Post not found' using errcode = 'SF003'; end if; return sfx_blog_json(b); end $$;
create function sfx_blog_save(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); ti text := trim(coalesce(p->>'title', '')); h text; st text := coalesce(nullif(p->>'status', ''), 'draft'); b sfx_blog_posts; tg text[];
begin
  if length(ti) < 2 or length(ti) > 150 then raise exception 'Give the post a title (up to 150 characters)' using errcode = 'SF002'; end if;
  if st not in ('draft', 'published') then raise exception 'Choose draft or published' using errcode = 'SF002'; end if;
  if length(coalesce(p->>'body', '')) > 100000 then raise exception 'That post is too long' using errcode = 'SF002'; end if;
  h := trim(both '-' from regexp_replace(lower(coalesce(nullif(p->>'handle', ''), ti)), '[^a-z0-9]+', '-', 'g'));
  if h = '' then raise exception 'Use letters or numbers in the title' using errcode = 'SF002'; end if;
  if jsonb_typeof(p->'tags') = 'array' then select coalesce(array_agg(distinct left(lower(trim(x)), 30)), '{}') into tg from jsonb_array_elements_text(p->'tags') x where trim(x) <> ''; else tg := '{}'; end if;
  if array_length(tg, 1) > 20 then raise exception 'Up to 20 tags' using errcode = 'SF002'; end if;
  begin
    if p_id is null then
      insert into sfx_blog_posts (tenant_id, title, handle, excerpt, body, image, author, tags, status, published_at, seo_title, seo_description)
      values (tid, ti, h, left(p->>'excerpt', 400), coalesce(p->>'body', ''), nullif(p->>'image', ''), left(p->>'author', 80), tg, st, case when st = 'published' then now() end, left(p->>'seoTitle', 70), left(p->>'seoDescription', 320)) returning * into b;
    else
      update sfx_blog_posts set title = ti, handle = h, excerpt = left(p->>'excerpt', 400), body = coalesce(p->>'body', ''), image = nullif(p->>'image', ''), author = left(p->>'author', 80), tags = tg, status = st,
        published_at = case when st = 'published' then coalesce(published_at, now()) else null end, seo_title = left(p->>'seoTitle', 70), seo_description = left(p->>'seoDescription', 320), updated_at = now()
      where id = p_id and tenant_id = tid returning * into b;
      if not found then raise exception 'Post not found' using errcode = 'SF003'; end if;
    end if;
  exception when unique_violation then raise exception 'Another post already uses that address' using errcode = 'SF002';
  end;
  return sfx_blog_json(b);
end $$;
create function sfx_blog_delete(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage');
begin delete from sfx_blog_posts where id = p_id and tenant_id = tid; end $$;
create function public_sfx_blog_list(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_public_tenant(p_slug);
begin
  if tid is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('title', b.title, 'handle', b.handle, 'excerpt', b.excerpt, 'image', b.image, 'author', b.author, 'tags', to_jsonb(b.tags), 'publishedAt', b.published_at) order by b.published_at desc)
    from sfx_blog_posts b where b.tenant_id = tid and b.status = 'published'), '[]'::jsonb);
end $$;
create function public_sfx_blog_post(p_slug text, p_handle text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_public_tenant(p_slug); b sfx_blog_posts;
begin
  if tid is null then return null; end if;
  select * into b from sfx_blog_posts where tenant_id = tid and handle = lower(coalesce(p_handle, '')) and status = 'published';
  if not found then return null; end if;
  return jsonb_build_object('title', b.title, 'handle', b.handle, 'excerpt', b.excerpt, 'body', b.body, 'image', b.image, 'author', b.author, 'tags', to_jsonb(b.tags), 'publishedAt', b.published_at,
    'seoTitle', coalesce(b.seo_title, b.title), 'seoDescription', coalesce(b.seo_description, b.excerpt));
end $$;

-- ---------- SEO fields on products and collections ----------
alter table sfx_products add column if not exists seo_title text;
alter table sfx_products add column if not exists seo_description text;
alter table sfx_collections add column if not exists seo_title text;
alter table sfx_collections add column if not exists seo_description text;
create function sfx_seo_save(p_kind text, p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); t text := nullif(trim(coalesce(p->>'title', '')), ''); d text := nullif(trim(coalesce(p->>'description', '')), '');
begin
  if length(coalesce(t, '')) > 70 then raise exception 'The page title can be up to 70 characters' using errcode = 'SF002'; end if;
  if length(coalesce(d, '')) > 320 then raise exception 'The description can be up to 320 characters' using errcode = 'SF002'; end if;
  if p_kind = 'product' then update sfx_products set seo_title = t, seo_description = d, updated_at = now() where id = p_id and tenant_id = tid;
  elsif p_kind = 'collection' then update sfx_collections set seo_title = t, seo_description = d, updated_at = now() where id = p_id and tenant_id = tid;
  else raise exception 'Choose product or collection' using errcode = 'SF002'; end if;
  if not found then raise exception 'Not found' using errcode = 'SF003'; end if;
  return jsonb_build_object('title', t, 'description', d);
end $$;
create function sfx_seo_get(p_kind text, p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); r jsonb;
begin
  if p_kind = 'product' then select jsonb_build_object('name', name, 'handle', handle, 'title', seo_title, 'description', seo_description) into r from sfx_products where id = p_id and tenant_id = tid;
  else select jsonb_build_object('name', name, 'handle', handle, 'title', seo_title, 'description', seo_description) into r from sfx_collections where id = p_id and tenant_id = tid; end if;
  if r is null then raise exception 'Not found' using errcode = 'SF003'; end if;
  return r;
end $$;
create function public_sfx_seo(p_slug text, p_kind text, p_handle text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_public_tenant(p_slug); r jsonb; brand text;
begin
  if tid is null then return null; end if;
  select config->>'brandName' into brand from sfx_stores where tenant_id = tid;
  if p_kind = 'product' then select jsonb_build_object('title', coalesce(seo_title, name), 'description', coalesce(seo_description, left(description, 160))) into r from sfx_products where tenant_id = tid and handle = lower(p_handle) and status = 'active';
  else select jsonb_build_object('title', coalesce(seo_title, name), 'description', coalesce(seo_description, left(description, 160))) into r from sfx_collections where tenant_id = tid and handle = lower(p_handle); end if;
  return r || jsonb_build_object('siteName', brand);
end $$;

-- ---------- theme / store settings revisions ----------
create table sfx_store_revisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  theme text not null, config jsonb not null, digest text not null, note text,
  created_by uuid, created_at timestamptz not null default now()
);
create index idx_sfx_revisions on sfx_store_revisions (tenant_id, created_at desc);
alter table sfx_store_revisions enable row level security;

create function sfx_store_snapshot(p_tenant uuid, p_note text) returns uuid language plpgsql security definer set search_path = public as $$
declare s sfx_stores; d text; last_d text; rid uuid;
begin
  select * into s from sfx_stores where tenant_id = p_tenant; if not found then return null; end if;
  d := md5(s.theme || s.config::text);
  select digest into last_d from sfx_store_revisions where tenant_id = p_tenant order by created_at desc limit 1;
  if last_d = d then return null; end if;
  insert into sfx_store_revisions (tenant_id, theme, config, digest, note, created_by) values (p_tenant, s.theme, s.config, d, left(p_note, 100), app_uid()) returning id into rid;
  delete from sfx_store_revisions where tenant_id = p_tenant and id not in (select id from sfx_store_revisions where tenant_id = p_tenant order by created_at desc limit 30);
  return rid;
end $$;

alter function sfx_store_save(jsonb) rename to sfx_store_save_pre425;
create function sfx_store_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage');
begin
  perform sfx_store_snapshot(tid, 'Before a change');
  return sfx_store_save_pre425(p);
end $$;
create function sfx_revision_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'theme', r.theme, 'note', r.note, 'createdAt', r.created_at) order by r.created_at desc) from sfx_store_revisions r where r.tenant_id = tid), '[]'::jsonb); end $$;
create function sfx_revision_save(p_note text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); rid uuid;
begin
  rid := sfx_store_snapshot(tid, coalesce(nullif(trim(p_note), ''), 'Saved version'));
  return jsonb_build_object('id', rid, 'unchanged', rid is null);
end $$;
create function sfx_revision_restore(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); r sfx_store_revisions;
begin
  select * into r from sfx_store_revisions where id = p_id and tenant_id = tid;
  if not found then raise exception 'That version was not found' using errcode = 'SF003'; end if;
  perform sfx_store_snapshot(tid, 'Before restoring a version');
  update sfx_stores set theme = r.theme, config = r.config, updated_at = now() where tenant_id = tid;
  return sfx_context();
end $$;

-- ---------- custom data ----------
create table sfx_metafield_defs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  owner_type text not null check (owner_type in ('product', 'collection', 'customer', 'order', 'store')),
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'), label text not null,
  value_type text not null check (value_type in ('text', 'number', 'boolean', 'url', 'date')),
  storefront boolean not null default false, created_at timestamptz not null default now()
);
create unique index idx_sfx_mf_def on sfx_metafield_defs (tenant_id, owner_type, key);
alter table sfx_metafield_defs enable row level security;
create table sfx_metafields (
  tenant_id uuid not null references tenants(id) on delete cascade,
  owner_type text not null, owner_id uuid not null, key text not null, value text not null, updated_at timestamptz not null default now(),
  primary key (tenant_id, owner_type, owner_id, key)
);
alter table sfx_metafields enable row level security;

create function sfx_metafield_def_save(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); d sfx_metafield_defs;
begin
  if p_id is null and (select count(*) from sfx_metafield_defs where tenant_id = tid) >= 100 then raise exception 'Up to 100 custom fields' using errcode = 'SF002'; end if;
  begin
    if p_id is null then insert into sfx_metafield_defs (tenant_id, owner_type, key, label, value_type, storefront)
      values (tid, p->>'ownerType', lower(coalesce(p->>'key', '')), left(trim(coalesce(p->>'label', '')), 80), coalesce(p->>'valueType', 'text'), coalesce((p->>'storefront')::boolean, false)) returning * into d;
    else update sfx_metafield_defs set label = left(trim(coalesce(p->>'label', label)), 80), storefront = coalesce((p->>'storefront')::boolean, storefront) where id = p_id and tenant_id = tid returning * into d;
      if not found then raise exception 'Field not found' using errcode = 'SF003'; end if; end if;
  exception when unique_violation then raise exception 'That field already exists' using errcode = 'SF002';
           when check_violation then raise exception 'Use a lowercase key (letters, numbers, _) and choose where it applies and its type' using errcode = 'SF002';
  end;
  return jsonb_build_object('id', d.id, 'ownerType', d.owner_type, 'key', d.key, 'label', d.label, 'valueType', d.value_type, 'storefront', d.storefront);
end $$;
create function sfx_metafield_def_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'ownerType', d.owner_type, 'key', d.key, 'label', d.label, 'valueType', d.value_type, 'storefront', d.storefront) order by d.owner_type, d.key) from sfx_metafield_defs d where d.tenant_id = tid), '[]'::jsonb); end $$;
create function sfx_metafield_def_delete(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); d sfx_metafield_defs;
begin
  select * into d from sfx_metafield_defs where id = p_id and tenant_id = tid; if not found then return; end if;
  delete from sfx_metafields where tenant_id = tid and owner_type = d.owner_type and key = d.key;
  delete from sfx_metafield_defs where id = p_id;
end $$;

create function sfx_metafield_owner_ok(p_tenant uuid, p_type text, p_owner uuid) returns boolean language sql stable security definer set search_path = public as $$
  select case p_type when 'product' then exists (select 1 from sfx_products where id = p_owner and tenant_id = p_tenant)
    when 'collection' then exists (select 1 from sfx_collections where id = p_owner and tenant_id = p_tenant)
    when 'customer' then exists (select 1 from sfx_customers where id = p_owner and tenant_id = p_tenant)
    when 'order' then exists (select 1 from sfx_orders where id = p_owner and tenant_id = p_tenant)
    when 'store' then p_owner = p_tenant else false end
$$;
-- values: p = { key: value, ... }; an empty value removes the field. Each value must fit the type of its definition.
create function sfx_metafield_set(p_type text, p_owner uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); k text; v text; d sfx_metafield_defs;
begin
  if not sfx_metafield_owner_ok(tid, p_type, p_owner) then raise exception 'That item was not found' using errcode = 'SF003'; end if;
  for k in select jsonb_object_keys(p) loop
    select * into d from sfx_metafield_defs where tenant_id = tid and owner_type = p_type and key = k;
    if not found then raise exception 'There is no custom field called %', k using errcode = 'SF002'; end if;
    v := trim(coalesce(p->>k, ''));
    if v = '' then delete from sfx_metafields where tenant_id = tid and owner_type = p_type and owner_id = p_owner and key = k; continue; end if;
    if length(v) > 2000 then raise exception '% is too long', d.label using errcode = 'SF002'; end if;
    if d.value_type = 'number' and v !~ '^-?[0-9]+(\.[0-9]+)?$' then raise exception '% must be a number', d.label using errcode = 'SF002'; end if;
    if d.value_type = 'boolean' and lower(v) not in ('true', 'false') then raise exception '% must be yes or no', d.label using errcode = 'SF002'; end if;
    if d.value_type = 'url' and v !~ '^https://[^ ]{4,}$' then raise exception '% must be a web address starting with https://', d.label using errcode = 'SF002'; end if;
    if d.value_type = 'date' and v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception '% must be a date like 2026-12-31', d.label using errcode = 'SF002'; end if;
    insert into sfx_metafields (tenant_id, owner_type, owner_id, key, value) values (tid, p_type, p_owner, k, case when d.value_type = 'boolean' then lower(v) else v end)
      on conflict (tenant_id, owner_type, owner_id, key) do update set value = excluded.value, updated_at = now();
  end loop;
  return sfx_metafield_get(p_type, p_owner);
end $$;
create function sfx_metafield_get(p_type text, p_owner uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  if not sfx_metafield_owner_ok(tid, p_type, p_owner) then raise exception 'That item was not found' using errcode = 'SF003'; end if;
  return coalesce((select jsonb_object_agg(m.key, m.value) from sfx_metafields m where m.tenant_id = tid and m.owner_type = p_type and m.owner_id = p_owner), '{}'::jsonb);
end $$;
-- only fields marked "show on the storefront" leave the building
create function public_sfx_metafields(p_slug text, p_type text, p_owner uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_public_tenant(p_slug);
begin
  if tid is null or p_type not in ('product', 'collection', 'store') or not sfx_metafield_owner_ok(tid, p_type, p_owner) then return '{}'::jsonb; end if;
  return coalesce((select jsonb_object_agg(m.key, jsonb_build_object('label', d.label, 'value', m.value)) from sfx_metafields m join sfx_metafield_defs d on d.tenant_id = m.tenant_id and d.owner_type = m.owner_type and d.key = m.key
    where m.tenant_id = tid and m.owner_type = p_type and m.owner_id = p_owner and d.storefront), '{}'::jsonb);
end $$;

-- metaobjects: a named kind of record with typed fields (for example "Size guide" or "Team member")
create table sfx_metaobject_defs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  type text not null check (type ~ '^[a-z][a-z0-9_]{1,40}$'), label text not null, fields jsonb not null default '[]'::jsonb, created_at timestamptz not null default now()
);
create unique index idx_sfx_mo_def on sfx_metaobject_defs (tenant_id, type);
alter table sfx_metaobject_defs enable row level security;
create table sfx_metaobjects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  type text not null, handle text not null, data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index idx_sfx_mo on sfx_metaobjects (tenant_id, type, handle);
alter table sfx_metaobjects enable row level security;

create function sfx_metaobject_def_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); f jsonb; out jsonb := '[]'::jsonb; k text; vt text;
begin
  if jsonb_typeof(p->'fields') <> 'array' or jsonb_array_length(p->'fields') not between 1 and 20 then raise exception 'Add 1 to 20 fields' using errcode = 'SF002'; end if;
  for f in select * from jsonb_array_elements(p->'fields') loop
    k := lower(coalesce(f->>'key', '')); vt := coalesce(f->>'valueType', 'text');
    if k !~ '^[a-z][a-z0-9_]{1,40}$' or vt not in ('text', 'number', 'boolean', 'url', 'date') then raise exception 'Check each field key and type' using errcode = 'SF002'; end if;
    out := out || jsonb_build_array(jsonb_build_object('key', k, 'label', left(coalesce(nullif(trim(f->>'label'), ''), k), 80), 'valueType', vt));
  end loop;
  begin
    insert into sfx_metaobject_defs (tenant_id, type, label, fields) values (tid, lower(coalesce(p->>'type', '')), left(trim(coalesce(p->>'label', '')), 80), out)
      on conflict (tenant_id, type) do update set label = excluded.label, fields = excluded.fields;
  exception when check_violation then raise exception 'Use a lowercase type name (letters, numbers, _)' using errcode = 'SF002'; end;
  return jsonb_build_object('type', lower(p->>'type'), 'fields', out);
end $$;
create function sfx_metaobject_def_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin return coalesce((select jsonb_agg(jsonb_build_object('type', d.type, 'label', d.label, 'fields', d.fields, 'count', (select count(*) from sfx_metaobjects o where o.tenant_id = tid and o.type = d.type)) order by d.type) from sfx_metaobject_defs d where d.tenant_id = tid), '[]'::jsonb); end $$;
create function sfx_metaobject_save(p_type text, p_handle text, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); d sfx_metaobject_defs; f jsonb; v text; clean jsonb := '{}'::jsonb; h text := trim(both '-' from regexp_replace(lower(coalesce(p_handle, '')), '[^a-z0-9]+', '-', 'g'));
begin
  select * into d from sfx_metaobject_defs where tenant_id = tid and type = p_type;
  if not found then raise exception 'That kind of record does not exist yet' using errcode = 'SF003'; end if;
  if h = '' then raise exception 'Give the record a name for its address' using errcode = 'SF002'; end if;
  if (select count(*) from sfx_metaobjects where tenant_id = tid and type = p_type) >= 500 and not exists (select 1 from sfx_metaobjects where tenant_id = tid and type = p_type and handle = h) then raise exception 'Up to 500 records of one kind' using errcode = 'SF002'; end if;
  for f in select * from jsonb_array_elements(d.fields) loop
    v := trim(coalesce(p->>(f->>'key'), ''));
    if v = '' then continue; end if;
    if length(v) > 4000 then raise exception '% is too long', f->>'label' using errcode = 'SF002'; end if;
    if f->>'valueType' = 'number' and v !~ '^-?[0-9]+(\.[0-9]+)?$' then raise exception '% must be a number', f->>'label' using errcode = 'SF002'; end if;
    if f->>'valueType' = 'boolean' and lower(v) not in ('true', 'false') then raise exception '% must be yes or no', f->>'label' using errcode = 'SF002'; end if;
    if f->>'valueType' = 'url' and v !~ '^https://[^ ]{4,}$' then raise exception '% must start with https://', f->>'label' using errcode = 'SF002'; end if;
    if f->>'valueType' = 'date' and v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception '% must be a date like 2026-12-31', f->>'label' using errcode = 'SF002'; end if;
    clean := clean || jsonb_build_object(f->>'key', v);
  end loop;
  insert into sfx_metaobjects (tenant_id, type, handle, data) values (tid, p_type, h, clean) on conflict (tenant_id, type, handle) do update set data = excluded.data, updated_at = now();
  return jsonb_build_object('type', p_type, 'handle', h, 'data', clean);
end $$;
create function sfx_metaobject_list(p_type text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin return coalesce((select jsonb_agg(jsonb_build_object('handle', o.handle, 'data', o.data, 'updatedAt', o.updated_at) order by o.handle) from sfx_metaobjects o where o.tenant_id = tid and o.type = p_type), '[]'::jsonb); end $$;
create function sfx_metaobject_delete(p_type text, p_handle text) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage');
begin delete from sfx_metaobjects where tenant_id = tid and type = p_type and handle = p_handle; end $$;

grant select, insert, update, delete on sfx_redirects, sfx_blog_posts, sfx_store_revisions, sfx_metafield_defs, sfx_metafields, sfx_metaobject_defs, sfx_metaobjects to app;
grant execute on function sfx_redirect_list(), sfx_redirect_save(uuid, jsonb), sfx_redirect_delete(uuid), public_sfx_redirect(text, text), sfx_blog_list(), sfx_blog_get(uuid), sfx_blog_save(uuid, jsonb), sfx_blog_delete(uuid),
  public_sfx_blog_list(text), public_sfx_blog_post(text, text), sfx_seo_save(text, uuid, jsonb), sfx_seo_get(text, uuid), public_sfx_seo(text, text, text), sfx_store_save(jsonb), sfx_revision_list(), sfx_revision_save(text),
  sfx_revision_restore(uuid), sfx_metafield_def_save(uuid, jsonb), sfx_metafield_def_list(), sfx_metafield_def_delete(uuid), sfx_metafield_set(text, uuid, jsonb), sfx_metafield_get(text, uuid),
  public_sfx_metafields(text, text, uuid), sfx_metaobject_def_save(jsonb), sfx_metaobject_def_list(), sfx_metaobject_save(text, text, jsonb), sfx_metaobject_list(text), sfx_metaobject_delete(text, text) to app;

-- Rollback: drop the triggers sfx_products_handle_redirect, sfx_collections_handle_redirect, sfx_blog_handle_redirect; drop every function created here; for sfx_store_save drop the new one
-- and rename sfx_store_save_pre425 back; drop tables sfx_redirects, sfx_blog_posts, sfx_store_revisions, sfx_metafield_defs, sfx_metafields, sfx_metaobject_defs, sfx_metaobjects; drop the seo columns.
