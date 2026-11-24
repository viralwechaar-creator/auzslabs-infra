-- Theme library actions: your own named themes (new from a starter, duplicate, rename, delete) and validated package import.
alter table sfx_theme_installs add column if not exists name text;
alter table sfx_theme_installs add column if not exists custom boolean not null default false;
alter table sfx_theme_installs drop constraint if exists sfx_theme_installs_tenant_id_theme_id_key;
create unique index if not exists idx_sfx_theme_installs_market on sfx_theme_installs (tenant_id, theme_id) where not custom;

create or replace function sfx_theme_install_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', i.id, 'themeId', i.theme_id, 'themeName', coalesce(i.name, th.name), 'isBuiltin', th.is_builtin, 'custom', i.custom,
    'draftContent', i.draft_content, 'publishedContent', i.published_content,
    'published', i.published_content is not null, 'active', st.active_install_id = i.id, 'installedAt', i.installed_at
  ) order by i.installed_at desc) from sfx_theme_installs i join sfx_themes th on th.id = i.theme_id
    left join sfx_stores st on st.tenant_id = tid where i.tenant_id = tid), '[]'::jsonb);
end $$;

-- Checks a theme's content and returns a cleaned copy. Only known section types and fields survive; links must be https or a site path.
create or replace function sfx_theme_clean_content(p jsonb) returns jsonb language plpgsql immutable set search_path = public as $$
declare out_ jsonb := '{}'::jsonb; secs jsonb := '[]'::jsonb; s jsonb; t text; props jsonb; clean jsonb; k text; keys text[]; n int := 0; v text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'The theme content must be an object' using errcode = 'SF002'; end if;
  if p ? 'accent' then
    if coalesce(p->>'accent', '') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'accent must be a colour like #800020' using errcode = 'SF002'; end if;
    out_ := out_ || jsonb_build_object('accent', p->>'accent');
  end if;
  if jsonb_typeof(coalesce(p->'sections', '[]'::jsonb)) <> 'array' then raise exception 'sections must be a list' using errcode = 'SF002'; end if;
  if jsonb_array_length(coalesce(p->'sections', '[]'::jsonb)) > 30 then raise exception 'A theme can have up to 30 sections' using errcode = 'SF002'; end if;
  for s in select * from jsonb_array_elements(coalesce(p->'sections', '[]'::jsonb)) loop
    n := n + 1; t := s->>'type';
    keys := case t when 'hero' then array['heading', 'sub', 'cta', 'href'] when 'text' then array['heading', 'body'] when 'image' then array['url', 'caption']
      when 'button' then array['text', 'href'] when 'announcement' then array['text'] when 'booking' then array['heading', 'note'] else null end;
    if keys is null then raise exception 'Section % has an unknown type', n using errcode = 'SF002'; end if;
    props := coalesce(s->'props', '{}'::jsonb);
    if jsonb_typeof(props) <> 'object' then raise exception 'Section % props must be an object', n using errcode = 'SF002'; end if;
    clean := '{}'::jsonb;
    foreach k in array keys loop
      if props ? k then
        if jsonb_typeof(props->k) <> 'string' then raise exception 'Section %: % must be text', n, k using errcode = 'SF002'; end if;
        v := props->>k;
        if length(v) > 4000 then raise exception 'Section %: % is too long', n, k using errcode = 'SF002'; end if;
        if k in ('href', 'url') and v <> '' and v !~* '^(https://|/)' then raise exception 'Section %: links must start with https:// or /', n using errcode = 'SF002'; end if;
        clean := clean || jsonb_build_object(k, v);
      end if;
    end loop;
    secs := secs || jsonb_build_array(jsonb_build_object('id', left(coalesce(nullif(regexp_replace(coalesce(s->>'id', ''), '[^-_a-zA-Z0-9]', '', 'g'), ''), 's' || n || substr(md5(random()::text), 1, 4)), 40), 'type', t, 'props', clean));
  end loop;
  return out_ || jsonb_build_object('sections', secs);
end $$;

create or replace function sfx_theme_install_rename(p_install_id uuid, p_name text) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); n text := trim(coalesce(p_name, ''));
begin
  if length(n) < 1 or length(n) > 80 then raise exception 'Enter a name up to 80 characters' using errcode = 'SF002'; end if;
  update sfx_theme_installs set name = n where id = p_install_id and tenant_id = tid;
  if not found then raise exception 'Theme not found' using errcode = 'SF003'; end if;
end $$;

create or replace function sfx_theme_install_duplicate(p_install_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); i sfx_theme_installs; nm text; new_ sfx_theme_installs;
begin
  select * into i from sfx_theme_installs where id = p_install_id and tenant_id = tid;
  if i.id is null then raise exception 'Theme not found' using errcode = 'SF003'; end if;
  if (select count(*) from sfx_theme_installs where tenant_id = tid) >= 40 then raise exception 'You have reached the limit of 40 themes. Delete one first.' using errcode = 'SF002'; end if;
  nm := left('Copy of ' || coalesce(i.name, (select name from sfx_themes where id = i.theme_id)), 80);
  insert into sfx_theme_installs (tenant_id, theme_id, source_version_id, draft_content, published_content, name, custom)
    values (tid, i.theme_id, i.source_version_id, coalesce(i.draft_content, '{}'::jsonb), null, nm, true) returning * into new_;
  return jsonb_build_object('installId', new_.id);
end $$;

-- p = { name, starter: 'blank' | 'shop' | 'landing', base: 'minimal' | 'classic' }
create or replace function sfx_theme_install_create(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); nm text := trim(coalesce(p->>'name', '')); st text := coalesce(nullif(p->>'starter', ''), 'blank'); base text := coalesce(nullif(p->>'base', ''), 'minimal');
  th sfx_themes; content jsonb; new_ sfx_theme_installs;
begin
  if length(nm) < 1 or length(nm) > 80 then raise exception 'Enter a name up to 80 characters' using errcode = 'SF002'; end if;
  select * into th from sfx_themes where slug = base and is_builtin and status = 'approved';
  if th.id is null then raise exception 'Choose Minimal or Classic as the base' using errcode = 'SF002'; end if;
  if (select count(*) from sfx_theme_installs where tenant_id = tid) >= 40 then raise exception 'You have reached the limit of 40 themes. Delete one first.' using errcode = 'SF002'; end if;
  content := case st
    when 'blank' then '{"sections":[{"id":"hero1","type":"hero","props":{"heading":"Welcome","sub":"Tell customers what makes your store special.","cta":"Shop now","href":"/"}}]}'
    when 'shop' then '{"sections":[{"id":"ann1","type":"announcement","props":{"text":"Free shipping on your first order"}},{"id":"hero1","type":"hero","props":{"heading":"New arrivals","sub":"Fresh pieces, added every week.","cta":"Shop the collection","href":"/"}},{"id":"txt1","type":"text","props":{"heading":"Made with care","body":"Write a short note about your products and how they are made."}}]}'
    when 'landing' then '{"sections":[{"id":"hero1","type":"hero","props":{"heading":"Your headline","sub":"One clear sentence about what you offer.","cta":"Get in touch","href":"/"}},{"id":"img1","type":"image","props":{"url":"","caption":"Add a picture"}},{"id":"btn1","type":"button","props":{"text":"Contact us","href":"/"}}]}'
    else null end::jsonb;
  if content is null then raise exception 'Choose a starter: blank, shop or landing' using errcode = 'SF002'; end if;
  insert into sfx_theme_installs (tenant_id, theme_id, draft_content, published_content, name, custom) values (tid, th.id, content, null, nm, true) returning * into new_;
  return jsonb_build_object('installId', new_.id);
end $$;

-- p = the parsed auzslab-theme.json: { version: 1, name, base, accent?, sections: [...] }. Checked and cleaned here; nothing in it can run code.
create or replace function sfx_theme_import(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); nm text; base text; th sfx_themes; new_ sfx_theme_installs; c jsonb;
begin
  if jsonb_typeof(p) <> 'object' or coalesce(p->>'version', '') <> '1' then raise exception 'Use an AUZslab version 1 theme package' using errcode = 'SF002'; end if;
  nm := trim(coalesce(p->>'name', '')); base := coalesce(nullif(p->>'base', ''), 'minimal');
  if length(nm) < 1 or length(nm) > 80 then raise exception 'The package needs a name up to 80 characters' using errcode = 'SF002'; end if;
  select * into th from sfx_themes where slug = base and is_builtin and status = 'approved';
  if th.id is null then raise exception 'base must be minimal or classic' using errcode = 'SF002'; end if;
  if (select count(*) from sfx_theme_installs where tenant_id = tid) >= 40 then raise exception 'You have reached the limit of 40 themes. Delete one first.' using errcode = 'SF002'; end if;
  c := jsonb_build_object('sections', coalesce(p->'sections', '[]'::jsonb));
  if p ? 'accent' then c := c || jsonb_build_object('accent', p->'accent'); end if;
  insert into sfx_theme_installs (tenant_id, theme_id, draft_content, published_content, name, custom)
    values (tid, th.id, sfx_theme_clean_content(c), null, left(nm, 80), true) returning * into new_;
  return jsonb_build_object('installId', new_.id);
end $$;

create or replace function sfx_theme_install_delete(p_install_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); i sfx_theme_installs;
begin
  select * into i from sfx_theme_installs where id = p_install_id and tenant_id = tid;
  if i.id is null then raise exception 'Theme not found' using errcode = 'SF003'; end if;
  if not i.custom then raise exception 'Only your own themes can be deleted. Marketplace themes stay installed.' using errcode = 'SF002'; end if;
  if exists (select 1 from sfx_stores where tenant_id = tid and active_install_id = i.id) then raise exception 'This theme is live on your store. Make another theme active first.' using errcode = 'SF002'; end if;
  delete from sfx_theme_installs where id = i.id;
end $$;

-- Marketplace install ignores your own copies so installing Minimal or Classic still works after you made a copy of one.
create or replace function sfx_theme_install(p_theme_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); th sfx_themes; existing sfx_theme_installs; purchase sfx_theme_purchases;
  dev_share int; plat_share int;
begin
  select * into th from sfx_themes where id = p_theme_id and status = 'approved';
  if th.id is null then raise exception 'This theme is not available in the marketplace' using errcode = 'SF106'; end if;
  select * into existing from sfx_theme_installs where tenant_id = tid and theme_id = p_theme_id and not custom;
  if existing.id is not null then return jsonb_build_object('installId', existing.id, 'alreadyInstalled', true); end if;
  if th.price_cents > 0 then
    raise exception 'Paid themes are coming soon -- platform billing for theme sales is not live yet' using errcode = 'SF107';
  end if;
  insert into sfx_theme_purchases (tenant_id, theme_id, version_id, price_cents) values (tid, p_theme_id, th.approved_version_id, th.price_cents) returning * into purchase;
  if th.price_cents > 0 and th.developer_tenant_id is not null then
    dev_share := floor(th.price_cents * 0.64)::int;
    plat_share := th.price_cents - dev_share;
    insert into sfx_dev_commission_ledger (developer_tenant_id, theme_id, purchase_id, sale_amount_cents, developer_share_cents, platform_share_cents)
      values (th.developer_tenant_id, th.id, purchase.id, th.price_cents, dev_share, plat_share);
  end if;
  insert into sfx_theme_installs (tenant_id, theme_id, source_version_id, draft_content, published_content)
    values (tid, p_theme_id, th.approved_version_id, coalesce((select content from sfx_theme_versions where id = th.approved_version_id), '{}'::jsonb), null)
    returning * into existing;
  return jsonb_build_object('installId', existing.id, 'alreadyInstalled', false);
end $$;
