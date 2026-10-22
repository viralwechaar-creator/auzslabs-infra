-- AUZsStyle store: owner-edited Blogs / News, Media (press, collaborations, events) and Careers pages live in the store config.
-- Only the allow-list of keys changes (blogs, media, jobs, hiring); everything else is as in db/232. Idempotent.
create or replace function sty_store_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cur jsonb; k text; ok_keys text[] := array['on', 'tagline', 'announce', 'heroImages', 'heroTitle', 'heroCta', 'about', 'founders',
    'stores', 'faqs', 'policies', 'shipping', 'pay', 'social', 'email', 'phone', 'brandName', 'showSale', 'sizeGuide', 'waOrder', 'abandonWa',
    'blogs', 'media', 'jobs', 'hiring'];
begin
  tid := sty_guard('sty_manage');
  if jsonb_typeof(p) <> 'object' then raise exception 'store settings must be an object' using errcode = 'ST002'; end if;
  if length(p::text) > 240000 then raise exception 'store settings are too large' using errcode = 'ST002'; end if;
  select config into cur from sty_store where tenant_id = tid;
  cur := coalesce(cur, '{}'::jsonb);
  for k in select jsonb_object_keys(p) loop
    if k = any(ok_keys) then cur := cur || jsonb_build_object(k, p->k); end if;
  end loop;
  insert into sty_store (tenant_id, config) values (tid, cur)
    on conflict (tenant_id) do update set config = excluded.config, updated_at = now();
  perform sty_audit_log(tid, 'store.save', null, null);
  return sty_store_get();
end $$;
