-- Order screen, from the Shopify reference: internal comments on the timeline, order tags, archive.
--  * A comment is a timeline entry marked kind=comment with the writer's name. Customers never see the timeline.
--  * Tags are short words on an order (up to 10, 30 characters each) used to find orders.
--  * Archive hides finished orders from the default list; it never cancels or deletes anything.
-- Rollback: drop functions sfx_order_comment, sfx_order_tags_set, sfx_order_archive; drop function sfx_order_json(sfx_orders, boolean);
--   alter function sfx_order_json_pre435(sfx_orders, boolean) rename to sfx_order_json; alter table sfx_orders drop column tags, drop column archived_at.
alter table sfx_orders add column if not exists tags text[] not null default '{}';
alter table sfx_orders add column if not exists archived_at timestamptz;

alter function sfx_order_json(sfx_orders, boolean) rename to sfx_order_json_pre435;
create function sfx_order_json(o sfx_orders, detail boolean default false) returns jsonb language sql stable security definer set search_path = public as $$
  select sfx_order_json_pre435(o, detail) || jsonb_build_object('tags', to_jsonb(o.tags), 'archived', o.archived_at is not null)
$$;

create function sfx_order_comment(p_order uuid, p_text text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_require('sfx_orders'); o sfx_orders; t text := trim(coalesce(p_text, '')); who text;
begin
  if t = '' then raise exception 'Write a comment first' using errcode = 'SF002'; end if;
  if length(t) > 1000 then raise exception 'Comments can be up to 1000 characters' using errcode = 'SF002'; end if;
  select * into o from sfx_orders where id = p_order and tenant_id = tid for update;
  if not found then raise exception 'Order not found' using errcode = 'SF003'; end if;
  select coalesce(nullif(u.user_metadata->>'name', ''), split_part(u.email, '@', 1), 'Staff') into who from auth_users u where u.id = app_uid();
  update sfx_orders set timeline = coalesce(timeline, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('label', t, 'at', now(), 'kind', 'comment', 'by', coalesce(who, 'Staff'))), updated_at = now()
    where id = p_order returning * into o;
  return sfx_order_json(o, true);
end $$;

create function sfx_order_tags_set(p_order uuid, p_tags text[]) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_require('sfx_orders'); o sfx_orders; t text[];
begin
  select coalesce(array_agg(distinct lower(left(trim(x), 30))), '{}') into t from unnest(coalesce(p_tags, '{}')) x where trim(x) <> '';
  if cardinality(t) > 10 then raise exception 'An order can have up to 10 tags' using errcode = 'SF002'; end if;
  update sfx_orders set tags = t, updated_at = now() where id = p_order and tenant_id = tid returning * into o;
  if not found then raise exception 'Order not found' using errcode = 'SF003'; end if;
  return sfx_order_json(o, true);
end $$;

create function sfx_order_archive(p_order uuid, p_on boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_require('sfx_orders'); o sfx_orders;
begin
  select * into o from sfx_orders where id = p_order and tenant_id = tid for update;
  if not found then raise exception 'Order not found' using errcode = 'SF003'; end if;
  if coalesce(p_on, true) and o.status not in ('fulfilled', 'cancelled', 'returned') then raise exception 'Only finished orders can be archived: fulfilled, cancelled or returned' using errcode = 'SF002'; end if;
  update sfx_orders set archived_at = case when coalesce(p_on, true) then now() else null end,
    timeline = sfx_order_timeline_add(o, case when coalesce(p_on, true) then 'Archived' else 'Restored from the archive' end), updated_at = now()
    where id = p_order returning * into o;
  return sfx_order_json(o, true);
end $$;
grant execute on function sfx_order_comment(uuid, text), sfx_order_tags_set(uuid, text[]), sfx_order_archive(uuid, boolean) to app;
