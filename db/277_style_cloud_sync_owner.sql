-- AUZsStyle Cloud Sync, Stage 2 (part 1): give the auto-provisioned cloud tenant an owner login, so someone can
-- actually sign into it. Stage 1's sty_cloud_sync_ensure_tenant makes the tenant row + settings but nobody could
-- ever sign in -- there was no auth_users/profiles row at all. The owner sets this up once, from Settings on the
-- Windows PC (Settings -> Remote access), typing the email/password they want to use remotely; the plain password
-- is hashed server-side (bcrypt, in the /cloud/sync/register route) and never stored or logged in the clear.

create or replace function sty_cloud_sync_set_owner(p_lineage text, p_shop text, p_email text, p_password_hash text, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; uid_ uuid; slug_ text; email_ text := lower(btrim(coalesce(p_email, '')));
begin
  if email_ = '' or email_ !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address' using errcode = 'ST002'; end if;
  if coalesce(p_password_hash, '') = '' then raise exception 'A password is required' using errcode = 'ST002'; end if;
  tid := sty_cloud_sync_ensure_tenant(p_lineage, p_shop);
  select slug into slug_ from tenants where id = tid;
  if exists (select 1 from profiles where tenant_id = tid and role = 'owner') then
    return jsonb_build_object('tenantId', tid, 'slug', slug_, 'created', false, 'already', true);
  end if;
  select id into uid_ from auth_users where email = email_;
  if uid_ is not null then
    -- an auth_users row can exist with no profile (e.g. a self-signup that never finished provisioning a tenant) --
    -- that one can be linked here; a login that already belongs to a different real business cannot be reused.
    if exists (select 1 from profiles where id = uid_) then
      raise exception 'This email already has an AUZslab account for a different business. Use a different email for remote access.' using errcode = 'ST002';
    end if;
    update auth_users set app_metadata = app_metadata || jsonb_build_object('tenant_id', tid, 'role', 'owner') where id = uid_;
    insert into profiles (id, tenant_id, email, role) values (uid_, tid, email_, 'owner');
  else
    -- the insert alone is enough -- on_signup()'s trigger (db/013) reads app_metadata.tenant_id/role off the new
    -- row and creates the matching profiles row itself; inserting one here too would just collide with it.
    insert into auth_users (email, password_hash, app_metadata, user_metadata, email_verified_at)
    values (email_, p_password_hash, jsonb_build_object('tenant_id', tid, 'role', 'owner'), jsonb_build_object('name', coalesce(nullif(btrim(p_name), ''), 'Owner')), now());
  end if;
  return jsonb_build_object('tenantId', tid, 'slug', slug_, 'created', true, 'already', false);
end $$;
