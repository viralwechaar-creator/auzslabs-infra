-- Demo business (demo.auzslab.in): its public store now runs on the storefront, so fill the storefront from the AUZsStyle demo
-- (products with pictures and sizes, collections with their pictures, store details, our-stores list) and keep the two linked.
-- Safe to re-run. Rollback: update sfx_stores set style_linked = false where tenant_id = (select id from tenants where slug = 'demo');
do $$
declare tid uuid; sc jsonb; st sty_store; theme_ text; dir_ jsonb; n int := 0; s record; c record;
begin
  select id into tid from tenants where slug = 'demo';
  if tid is null then return; end if;
  update tenant_settings set features = features || '{"storefront": true, "style": true}'::jsonb where tenant_id = tid;
  select * into st from sty_store where tenant_id = tid; sc := coalesce(st.config, '{}'::jsonb);
  theme_ := case sc->>'template' when 'minimal' then 'minimal' when 'studs' then 'studs' else 'classic' end;
  insert into sfx_stores (tenant_id, published, theme, plan_status, trial_ends_at) values (tid, true, theme_, 'active', now() + interval '10 years')
    on conflict (tenant_id) do update set published = true, theme = excluded.theme, plan_status = 'active', trial_ends_at = excluded.trial_ends_at;
  -- store details: AUZsStyle's wording wins, secrets and switches are not copied
  update sfx_stores set config = coalesce(config, '{}'::jsonb) || (sc - 'on' - 'payOnline' - 'rzpKey' - 'template' - 'stores') where tenant_id = tid;
  dir_ := case when jsonb_typeof(sc->'stores') = 'array' then sc->'stores' end;
  if dir_ is not null and jsonb_array_length(dir_) > 0 then
    begin
      update sfx_stores set config = config || jsonb_build_object('directory', sfx_stores_clean(dir_)) where tenant_id = tid;
    exception when others then raise notice 'demo stores list skipped: %', sqlerrm; end;
  end if;
  -- turn the link on and copy everything across
  update sfx_stores set style_linked = true where tenant_id = tid;
  for s in select id from sty_styles where tenant_id = tid order by created_at loop perform sfx_link_push_style(s.id); n := n + 1; end loop;
  perform sfx_link_sync_collections(tid, true);
  for c in select name, image from sty_collections where tenant_id = tid and coalesce(image, '') <> '' loop
    update sfx_collections set image = c.image where tenant_id = tid and lower(name) = lower(c.name) and coalesce(image, '') = '';
  end loop;
  raise notice 'demo storefront filled from AUZsStyle: % styles', n;
exception when others then
  raise notice 'demo storefront fill skipped: %', sqlerrm;
end $$;
