-- hub_me(): ONE call that tells the hub app what kind of person just signed in, so it can send them to the right place
-- without probing several functions that answer with HTTP 400 (admin / team / business owner or staff / customer).
create or replace function hub_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := app_uid(); em text; is_admin boolean; trole text; has_biz boolean;
begin
  if uid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select email into em from auth_users where id = uid;
  is_admin := exists (select 1 from platform_admins where id = uid);
  has_biz := exists (select 1 from profiles where id = uid);
  trole := null;
  if not is_admin then
    begin
      trole := (team_me() ->> 'role');
    exception when raise_exception then trole := null;
    end;
  end if;
  return jsonb_build_object('email', em, 'admin', is_admin, 'team', trole, 'business', has_biz);
end $$;
