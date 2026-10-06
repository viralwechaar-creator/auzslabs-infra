-- AUZsMob: tell every phone when the owner cleared all data (Backup/Clear), so each phone drops its own offline copy
-- instead of keeping (and re-uploading) rows that no longer exist. Returns the time of the last "clear" for this shop.
create or replace function mob_data_epoch() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := mob_guard('mob_view');
  return jsonb_build_object('epoch', (select max(created_at) from tenant_data_actions where tenant_id = tid and action = 'clear'));
end $$;
