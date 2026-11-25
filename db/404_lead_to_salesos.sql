-- A job application that arrives through the contact page (leads.kind = 'career') can be turned into a SalesOS login in one step:
-- it makes the SalesOS application record from the lead and approves it with the chosen post (same rules as admin_review_job_application).
-- Rollback: drop function admin_lead_make_salesos(uuid, text);
create or replace function admin_lead_make_salesos(p_lead uuid, p_post text) returns jsonb language plpgsql security definer set search_path = public as $$
declare l leads%rowtype; em text; app_id uuid; r jsonb;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select * into l from leads where id = p_lead for update;
  if not found then raise exception 'lead not found'; end if;
  if l.kind is distinct from 'career' then raise exception 'Only a job application can be turned into a SalesOS login'; end if;
  if l.status = 'converted' then raise exception 'This applicant already has a login'; end if;
  em := lower(trim(split_part(l.contact, ' · ', 1)));
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'This lead has no valid email address'; end if;
  insert into sos_applications (name, email, phone, note, status)
    values (l.name, em, nullif(l.details->>'phone', ''), left(coalesce(l.message, ''), 1000), 'pending') returning id into app_id;
  r := admin_review_job_application(app_id, 'approve', p_post, null);
  update leads set status = 'converted', updated_at = now() where id = p_lead;
  return r || jsonb_build_object('email', em);
end $$;
grant execute on function admin_lead_make_salesos(uuid, text) to app;
