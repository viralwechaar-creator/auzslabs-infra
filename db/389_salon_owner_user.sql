-- Salon Console Admin tab: the console owner gets a limited (8 h, no refresh) AUZslab session for their own business so the
-- shared Admin panes can call the account functions. This helper only finds the owner login of a SALON business.
-- It is not in the RPC list: only the salon API route calls it, after it has checked the console owner session.
create or replace function salon_owner_user(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u record;
begin
  if not exists (select 1 from tenants where id = p_tenant and niche = 'salon') then return null; end if;
  select a.id, a.email, a.app_metadata into u from profiles p join auth_users a on a.id = p.id
    where p.tenant_id = p_tenant and p.role = 'owner' and a.deleted_at is null order by a.created_at limit 1;
  if u.id is null then return null; end if;
  return jsonb_build_object('id', u.id, 'email', u.email, 'app_metadata', u.app_metadata);
end $$;
