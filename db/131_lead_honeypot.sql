-- The marketing site's contact form (submit_lead, db/005) is a public, unauthenticated RPC with
-- no spam defense beyond the generic public-RPC rate limit (300 requests / 5 min per IP, sized for
-- QR self-ordering on shared WiFi -- far too loose for a "get in touch" form). Adds a honeypot:
-- a field real visitors never see or fill (hidden off-screen in the form), that a bot's generic
-- form-filler often fills anyway. A filled honeypot is treated as success client-side (never tips
-- the bot off) but the lead is silently dropped, not inserted.
create or replace function submit_lead(p_name text, p_contact text, p_business text, p_message text, p_niche text, p_hp text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_hp, '') <> '' then
    return; -- honeypot tripped -- pretend success, drop silently
  end if;
  insert into leads (name, contact, business, message, niche)
  values (p_name, p_contact, nullif(p_business, ''), nullif(p_message, ''), nullif(p_niche, ''));
end;
$$;
