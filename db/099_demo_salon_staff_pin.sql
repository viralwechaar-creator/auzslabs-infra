-- Demo salon staff sign-in is now username + PIN like every other staff login (the salon console no longer shows phone + password).
-- Login: priya.demo-salon / PIN 1234. Safe to re-run.
do $$
declare tid uuid; uid uuid;
begin
  select id into tid from tenants where slug = 'demo-salon';
  if tid is null then return; end if;
  select id into uid from auth_users where lower(username) = 'priya.demo-salon' and deleted_at is null;
  if uid is null then
    insert into auth_users (email, password_hash, username, pin_hash, pin_fp, app_metadata, user_metadata)
    values ('priya.demo-salon@staff.auzslab.in', null, 'priya.demo-salon', crypt('1234', gen_salt('bf', 10)),
            encode(digest(tid::text || ':1234', 'sha256'), 'hex'),
            jsonb_build_object('tenant_id', tid, 'role', 'cashier', 'name', 'Priya', 'email_verified', true),
            jsonb_build_object('full_name', 'Priya'))
    returning id into uid;
  end if;
  update profiles set username = 'priya.demo-salon', pin_len = 4, login_off = false where id = uid;
end $$;
