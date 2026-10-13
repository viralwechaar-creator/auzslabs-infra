-- team_probe(): "am I on the AUZslab team?" that answers {member:false} instead of raising.
-- team_me() raises 'not a team member' for everyone else, which shows up as an HTTP 400 in the browser
-- every time an ordinary customer signs in on the website or the hub. Same rules as team_me()
-- (including turning an approved "Join our team" application into a seat on the first call).
create or replace function team_probe() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return jsonb_build_object('member', true) || team_me();
exception when raise_exception then
  return jsonb_build_object('member', false);
end $$;
