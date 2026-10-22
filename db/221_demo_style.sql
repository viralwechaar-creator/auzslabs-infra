-- AUZsStyle on the shared demo business (demo.auzslab.in): feature on, a starter catalogue, and a week of sample bills so the
-- live demo page has something to show. Safe to re-run: styles are added only when missing, sample bills only once.
do $$
declare tid uuid; uid uuid; b uuid; r record; n int := 0; i int := 0; sid uuid;
begin
  select id into tid from tenants where slug = 'demo';
  if tid is null then return; end if;
  update tenant_settings set features = coalesce(features, '{}'::jsonb) || '{"style":true}'::jsonb where tenant_id = tid;
  select id into uid from profiles where tenant_id = tid and role = 'owner' limit 1;
  if uid is null then return; end if;
  perform set_config('app.uid', uid::text, true);
  perform sty_load_sample();
  select count(*) into n from sty_sales where tenant_id = tid;
  if n = 0 then
    for r in select v.id as vid, s.price as price, s.name from sty_variants v join sty_styles s on s.id = v.style_id
             where v.tenant_id = tid and v.active order by s.name, v.colour, v.size loop
      i := i + 1;
      exit when i > 26;
      if i % 3 = 0 then
        perform sty_sell(jsonb_build_object('id', gen_random_uuid(), 'offline', true, 'at', (now() - ((i % 7) || ' days')::interval - ((i % 5) || ' hours')::interval),
          'lines', jsonb_build_array(jsonb_build_object('variantId', r.vid, 'qty', 1 + (i % 2))),
          'payments', jsonb_build_array(jsonb_build_object('mode', case when i % 2 = 0 then 'upi' else 'cash' end, 'amount', r.price * (1 + (i % 2))))));
      end if;
    end loop;
  end if;
exception when others then
  raise notice 'demo style seed skipped: %', sqlerrm;
end $$;
