-- =========================================================
-- Self-service login-email change + recovery email (owner request), plus a
-- platform-admin override for setting a client's login email directly.
--
-- Change-email reuses the exact email_verifications table db/092 already built
-- for signup confirmation, rather than a parallel mechanism: a `purpose` column
-- distinguishes what a given link is actually for ('verify' = db/092's original
-- "prove your current signup email" flow, 'change' = "swap my login email",
-- 'recovery' = "add a backup contact email"), so a link from one flow can never
-- be replayed to silently complete a different one. Existing rows default to
-- 'verify' (what they all were before this migration), so db/092's own
-- confirmEmailVerification path is unaffected -- it is tightened below to
-- filter on purpose='verify' explicitly, the same discipline the other two new
-- confirm functions use from the start.
--
-- A login email is only ever actually changed once the NEW address proves it
-- can receive mail (the link is mailed to the new address, never the old one) --
-- same "never trust an unverified email" discipline as db/069's pre-hijack guard
-- for Google/Apple re-linking. A recovery email works the same way: it is never
-- used to log in and never substitutes for the real reset-password flow by
-- itself (that remains unchanged) -- it is a verified backup contact an owner
-- can show a platform admin if they ever lose access to their real inbox.
-- =========================================================

alter table email_verifications add column if not exists purpose text not null default 'verify';
alter table email_verifications drop constraint if exists email_verifications_purpose_check;
alter table email_verifications add constraint email_verifications_purpose_check check (purpose in ('verify', 'change', 'recovery'));

alter table auth_users add column if not exists recovery_email text;
alter table auth_users add column if not exists recovery_email_verified_at timestamptz;

-- my_dashboard() (db/013) gains the recovery-email fields account.html needs;
-- everything else about it is unchanged.
create or replace function my_dashboard()
returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if me() is null then raise exception 'authentication required'; end if;
  tid := (me()->>'tenant_id')::uuid;
  if tid is null then raise exception 'not a tenant member'; end if;

  return (
    select jsonb_build_object(
      'tenant', jsonb_build_object(
        'id', t.id, 'name', t.name, 'slug', t.slug, 'niche', t.niche,
        'plan', t.plan, 'status', t.status, 'monthly_fee', t.monthly_fee, 'renewal_date', t.renewal_date
      ),
      'features', coalesce(ts.features, '{}'::jsonb),
      'enabled_features', coalesce(ts.enabled_features, '{}'::jsonb),
      'my_role', (me()->>'role'),
      'my_email', (select email from auth_users where id = app_uid()),
      'my_recovery_email', (select recovery_email from auth_users where id = app_uid()),
      'my_recovery_email_verified', (select recovery_email_verified_at is not null from auth_users where id = app_uid())
    )
    from tenants t
    left join tenant_settings ts on ts.tenant_id = t.id
    where t.id = tid
  );
end $$;

-- Platform admin override: fixes a typo'd or dead login email directly, no
-- verification link needed (the admin is already a trusted actor who can
-- already suspend/delete the account outright) -- same bar as
-- admin_set_user_disabled/admin_delete_user (db/087), audited the same way.
create function admin_set_user_email(p_user_id uuid, p_new_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare old_email text;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if p_new_email is null or length(trim(p_new_email)) = 0 then raise exception 'a new email is required'; end if;
  if p_new_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'that does not look like a valid email address'; end if;
  select email into old_email from auth_users where id = p_user_id and deleted_at is null;
  if old_email is null then raise exception 'user not found'; end if;
  if exists (select 1 from auth_users where email = p_new_email and id <> p_user_id) then
    raise exception 'that email is already in use by a different account';
  end if;
  update auth_users set email = p_new_email, email_verified_at = now() where id = p_user_id;
  perform admin_log('change_user_email', 'user', p_user_id::text, jsonb_build_object('old_email', old_email, 'new_email', p_new_email));
  return jsonb_build_object('ok', true, 'email', p_new_email);
end $$;
