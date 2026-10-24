-- Plan limit: 'multi_pictures' = false allows only ONE picture per AUZsStyle style
-- (main picture; no extra pictures, no per-colour pictures). Absent = unlimited.
create or replace function admin_set_tenant_caps(p_tenant_id uuid, p_caps jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_slug text; v_clean jsonb := '{}'::jsonb; k text;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  for k in select jsonb_object_keys(coalesce(p_caps, '{}'::jsonb)) loop
    if k in ('online_store', 'images', 'whatsapp', 'multi_pictures') then v_clean := v_clean || jsonb_build_object(k, (p_caps ->> k) = 'true'); end if;
  end loop;
  update tenant_settings set caps = v_clean where tenant_id = p_tenant_id;
  if not found then raise exception 'tenant not found'; end if;
  select slug into v_slug from tenants where id = p_tenant_id;
  perform admin_log('set_tenant_caps', 'tenant', p_tenant_id::text, jsonb_build_object('slug', v_slug, 'caps', v_clean));
end $$;

create or replace function sty_pic_count(p_photo_url text, p_photos jsonb, p_colour jsonb) returns int
language sql immutable as $$
  select (case when coalesce(p_photo_url, '') <> '' then 1 else 0 end)
       + coalesce(jsonb_array_length(case when jsonb_typeof(p_photos) = 'array' then p_photos else '[]'::jsonb end), 0)
       + coalesce((select sum(jsonb_array_length(v)) from jsonb_each(case when jsonb_typeof(p_colour) = 'object' then p_colour else '{}'::jsonb end) e(k, v) where jsonb_typeof(v) = 'array'), 0)::int
$$;

create or replace function sty_pic_cap_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tenant_cap(new.tenant_id, 'multi_pictures') then return new; end if;
  if sty_pic_count(new.photo_url, new.photos, new.colour_photos) > 1
     and (tg_op = 'INSERT' or sty_pic_count(new.photo_url, new.photos, new.colour_photos) > sty_pic_count(old.photo_url, old.photos, old.colour_photos)) then
    raise exception 'Your plan allows one picture per style. Ask AUZslab to upgrade for more.' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists sty_pic_cap on sty_styles;
create trigger sty_pic_cap before insert or update on sty_styles for each row execute function sty_pic_cap_guard();
