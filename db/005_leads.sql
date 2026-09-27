-- =========================================================
-- Leads: "get in touch" submissions from the marketing site's
-- contact form. Anyone can submit one (submit_lead is security
-- definer, no login needed) -- only platform_admins can read or
-- manage them. Converting a lead into a real tenant is still a
-- manual step done from admin/onboard.html; this table just
-- makes sure a submission is never silently lost (the contact
-- form previously didn't send anywhere at all).
-- =========================================================

create table leads (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  business    text,
  contact     text not null,
  message     text,
  niche       text references niche_presets(niche),
  status      text not null default 'new' check (status in ('new','contacted','converted','declined')),
  created_at  timestamptz not null default now()
);
alter table leads enable row level security;
create policy admin_all on leads for all using (is_platform_admin()) with check (is_platform_admin());

create function submit_lead(p_name text, p_contact text, p_business text, p_message text, p_niche text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into leads (name, contact, business, message, niche)
  values (p_name, p_contact, nullif(p_business, ''), nullif(p_message, ''), nullif(p_niche, ''));
end;
$$;
