-- Insights cards: with nothing chosen, show every card (so nobody loses a panel they already had).
-- Rollback: re-run sfx_dashboard_layout_get from db/426.
create or replace function sfx_dashboard_layout_get() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); c jsonb;
begin
  select config->'dashboardLayout' into c from sfx_stores where tenant_id = tid;
  return coalesce(c, '["sales","orders","funnel","profit","inventory","customers","cohorts"]'::jsonb);
end $$;
