-- Contact hub (Codex design): four audiences send one enquiry each -- business owner, developer or designer,
-- job seeker, something else. They all land in the existing admin Leads list, so no new admin screen is needed:
-- leads gets a `kind` and a small `details` object (role applied for, portfolio link, theme idea ...).
-- submit_lead (db/131) is left exactly as it is for the older callers.
alter table leads add column if not exists kind text not null default 'business';
alter table leads add column if not exists details jsonb not null default '{}'::jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leads_kind_check') then
    alter table leads add constraint leads_kind_check check (kind in ('business', 'developer', 'career', 'general'));
  end if;
end $$;

create or replace function submit_contact(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_kind text := coalesce(p->>'kind', 'general');
  v_name text := left(trim(coalesce(p->>'name', '')), 120);
  v_email text := left(trim(coalesce(p->>'email', '')), 180);
  v_phone text := left(trim(coalesce(p->>'phone', '')), 28);
  v_msg text := left(trim(coalesce(p->>'message', '')), 3000);
  v_contact text;
  v_niche text := nullif(lower(trim(coalesce(p->>'niche', ''))), '');
  v_details jsonb := '{}'::jsonb;
begin
  if coalesce(p->>'hp', '') <> '' then return; end if;      -- honeypot: bots fill the hidden box, people never see it
  if v_kind not in ('business', 'developer', 'career', 'general') then raise exception 'Please choose who you are.'; end if;
  if v_name = '' then raise exception 'Please enter your name.'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Please enter a valid email address.'; end if;
  if v_msg = '' then raise exception 'Please write a short message.'; end if;
  -- the same person cannot send more than 5 in a day (quiet no-op beyond that, nothing to tell a bot)
  if (select count(*) from leads where contact = v_email and created_at > now() - interval '1 day') >= 5 then return; end if;
  v_contact := v_email || case when v_phone <> '' then ' · ' || v_phone else '' end;
  if v_kind = 'business' then
    if v_niche is null or v_niche not in (select niche from niche_presets) then v_niche := null; end if;
  else
    v_niche := null;
  end if;
  v_details := jsonb_strip_nulls(jsonb_build_object(
    'topic', nullif(left(trim(coalesce(p->>'topic', '')), 80), ''),
    'role', nullif(left(trim(coalesce(p->>'role', '')), 120), ''),
    'link', nullif(left(trim(coalesce(p->>'link', '')), 300), ''),
    'business_type', nullif(left(trim(coalesce(p->>'business_type', '')), 80), ''),
    'phone', nullif(v_phone, '')));
  insert into leads (name, business, contact, message, niche, kind, details)
  values (v_name, nullif(left(trim(coalesce(p->>'business', '')), 120), ''), v_contact, v_msg, v_niche, v_kind, v_details);
  insert into notifications (tenant_id, type, title, body)
  values (null, 'lead', case v_kind when 'career' then 'New job application: ' when 'developer' then 'New developer enquiry: ' else 'New enquiry: ' end || v_name, left(v_msg, 200));
exception when others then
  if sqlstate in ('P0001') then raise; end if;   -- our own readable messages go back to the form; anything else is logged only
  raise;
end $$;
