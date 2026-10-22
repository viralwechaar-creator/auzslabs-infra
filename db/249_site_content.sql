-- Marketing-site editable content (text + picture addresses), edited from Admin -> Website.
create table if not exists site_content (
  key text primary key check (key ~ '^[a-z0-9._-]{1,60}$'),
  value text not null check (length(value) <= 2000),
  updated_at timestamptz not null default now()
);
alter table site_content enable row level security;

create or replace function public_site_content() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from site_content;
$$;

create or replace function admin_site_content_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k text; v text; n int := 0;
begin
  if not is_platform_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  for k, v in select key, value from jsonb_each_text(coalesce(p, '{}'::jsonb)) loop
    if k !~ '^[a-z0-9._-]{1,60}$' then raise exception 'bad key %', k; end if;
    if coalesce(v, '') = '' then delete from site_content where key = k;
    else
      insert into site_content (key, value) values (k, left(v, 2000))
      on conflict (key) do update set value = excluded.value, updated_at = now();
    end if;
    n := n + 1;
  end loop;
  return jsonb_build_object('saved', n);
end $$;
