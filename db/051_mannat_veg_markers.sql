-- =========================================================
-- db/049/050 never set the `veg` field on any Mannat Cafe item --
-- that marker ('veg'|'nonveg'|'egg', see index.html's VEG_COLOR/
-- isRestaurant() area) was added to this codebase after those
-- migrations were written. Every item defaults to 'veg' when the
-- field is absent (`i.veg||'veg'`), so all 6 chicken dishes were
-- silently showing under the Veg filter. Sets 'nonveg' on exactly
-- those 6; every other Mannat item (paneer/veg/bread/rice/beverage/
-- dessert) is correctly veg by that same default and is left alone.
-- =========================================================

update records set
  data = data || jsonb_build_object('veg', 'nonveg'),
  updated_at = now()
where tenant_id = (select id from tenants where slug = 'mannatcafe')
  and kind = 'item'
  and data->>'name' in ('Chicken Tikka', 'Chicken 65', 'Butter Chicken', 'Chicken Curry', 'Chicken Biryani', 'Chicken Fried Rice')
  and not deleted;
