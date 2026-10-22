-- AUZsStyle: bulk edit and bulk delete of styles (needs sty_manage). A style that was ever sold, received or moved cannot be erased
-- (its history must stay correct), so it is switched off (hidden) instead and the answer says how many of each.
create or replace function sty_bulk_edit(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; ids uuid[]; st jsonb; adj jsonb; n int := 0; mode text; val numeric;
begin
  tid := sty_guard('sty_manage');
  select coalesce(array_agg(x::uuid), '{}') into ids from jsonb_array_elements_text(coalesce(p->'ids', '[]'::jsonb)) x;
  if coalesce(array_length(ids, 1), 0) = 0 then raise exception 'Choose at least one style' using errcode = 'ST002'; end if;
  if array_length(ids, 1) > 2000 then raise exception 'Choose at most 2000 styles at a time' using errcode = 'ST002'; end if;
  st := coalesce(p->'set', '{}'::jsonb); adj := p->'priceAdjust';
  update sty_styles s set
    category = case when coalesce(st->>'category', '') <> '' then st->>'category' else category end,
    brand = case when coalesce(st->>'brand', '') <> '' then st->>'brand' else brand end,
    gender = case when coalesce(st->>'gender', '') <> '' then st->>'gender' else gender end,
    season = case when coalesce(st->>'season', '') <> '' then st->>'season' else season end,
    collection = case when coalesce(st->>'collection', '') <> '' then st->>'collection' else collection end,
    hsn = case when coalesce(st->>'hsn', '') <> '' then st->>'hsn' else hsn end,
    tax_pct = case when coalesce(st->>'taxPct', '') <> '' then (st->>'taxPct')::numeric else tax_pct end,
    badge = case when st->>'badge' = 'normal' then null when st->>'badge' in ('limited', 'soldout') then st->>'badge' else badge end,
    active = case when st ? 'active' and st->>'active' <> '' then (st->>'active')::boolean else active end,
    updated_at = now()
  where s.tenant_id = tid and s.id = any(ids);
  get diagnostics n = row_count;
  if adj is not null and coalesce(adj->>'mode', '') in ('pct', 'amt') and coalesce(adj->>'value', '') <> '' then
    mode := adj->>'mode'; val := (adj->>'value')::numeric;
    update sty_styles s set
      price = greatest(0, round(case when mode = 'pct' then price * (1 + val / 100) else price + val end)),
      mrp = case when mrp > 0 then greatest(0, round(case when mode = 'pct' then mrp * (1 + val / 100) else mrp + val end)) else mrp end,
      updated_at = now()
    where s.tenant_id = tid and s.id = any(ids);
  end if;
  perform sty_audit_log(tid, 'style_bulk_edit', null, jsonb_build_object('count', n, 'set', st, 'priceAdjust', adj));
  return jsonb_build_object('changed', n);
end $$;

create or replace function sty_delete_styles(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; sid uuid; ids uuid[]; gone int := 0; hid int := 0;
begin
  tid := sty_guard('sty_manage');
  select coalesce(array_agg(x::uuid), '{}') into ids from jsonb_array_elements_text(coalesce(p->'ids', '[]'::jsonb)) x;
  if coalesce(array_length(ids, 1), 0) = 0 then raise exception 'Choose at least one style' using errcode = 'ST002'; end if;
  if array_length(ids, 1) > 2000 then raise exception 'Choose at most 2000 styles at a time' using errcode = 'ST002'; end if;
  foreach sid in array ids loop
    if not exists (select 1 from sty_styles where id = sid and tenant_id = tid) then continue; end if;
    begin
      delete from sty_variants where style_id = sid and tenant_id = tid;
      delete from sty_styles where id = sid and tenant_id = tid;
      gone := gone + 1;
    exception when foreign_key_violation or raise_exception or integrity_constraint_violation then
      update sty_styles set active = false, updated_at = now() where id = sid and tenant_id = tid;
      hid := hid + 1;
    end;
  end loop;
  perform sty_audit_log(tid, 'style_bulk_delete', null, jsonb_build_object('deleted', gone, 'hidden', hid));
  return jsonb_build_object('deleted', gone, 'hidden', hid);
end $$;
