-- Public, no-login list of marketplace theme names and prices, so the website's Themes page always shows what the admin saved.
-- Rollback: drop function public_sfx_theme_prices();
create or replace function public_sfx_theme_prices() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'slug', slug, 'priceCents', price_cents) order by name), '[]'::jsonb)
  from sfx_themes where status = 'approved';
$$;
grant execute on function public_sfx_theme_prices() to app;
