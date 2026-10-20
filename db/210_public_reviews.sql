-- Public customer reviews for the QR ordering website (Kiln design, social proof).
-- Reads the real post-order ratings customers already leave (kind='feedback',
-- db/020). Anon-callable like public_menu; returns only the average, the count
-- and up to 6 recent 4-5 star comments with the customer's FIRST name (taken
-- from the order, if known). Nothing is written or invented here.
create or replace function public_reviews(tenant_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid; res jsonb;
begin
  select id into tid from tenants where slug = tenant_slug;
  if tid is null then return jsonb_build_object('count', 0, 'avg', 0, 'reviews', '[]'::jsonb); end if;
  select jsonb_build_object(
    'count', count(*),
    'avg', coalesce(round(avg((f.data->>'rating')::numeric), 1), 0),
    'reviews', coalesce((
      select jsonb_agg(x order by x.at desc) from (
        select (r.data->>'rating')::int as rating,
               left(r.data->>'comment', 280) as comment,
               r.data->>'at' as at,
               nullif(split_part(coalesce((
                 select o.data->'cust'->>'name' from records o
                 where o.tenant_id = tid and o.kind = 'order' and not o.deleted and o.data->>'tok' = r.data->>'orderTok'
                 limit 1), ''), ' ', 1), '') as name
        from records r
        where r.tenant_id = tid and r.kind = 'feedback' and not r.deleted
          and (r.data->>'rating')::int >= 4 and length(trim(coalesce(r.data->>'comment', ''))) >= 8
        order by r.data->>'at' desc limit 6) x), '[]'::jsonb))
  into res
  from records f
  where f.tenant_id = tid and f.kind = 'feedback' and not f.deleted and (f.data->>'rating') ~ '^[1-5]$';
  return res;
end $$;
