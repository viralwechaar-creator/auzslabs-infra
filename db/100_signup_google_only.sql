-- Sign-up is Google only for now (the website no longer offers email + password sign-up).
-- This switch also makes the server refuse direct email sign-up requests. To allow them again:
--   update platform_flags set value = 'on' where key = 'password_signup';
insert into platform_flags (key, value) values ('password_signup', 'off') on conflict (key) do nothing;
