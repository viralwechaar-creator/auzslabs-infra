-- WhatsApp: an automatic "we got it" confirmation the INSTANT either a client or a team candidate submits
-- -- no admin action first. wa_client_order_msg() (db/184) only ever fired `after update of status`, so a
-- brand-new request got silence until an admin moved it along; this makes it also fire once on INSERT, with
-- its own template. A team application gets a different message, on its own new trigger. Every existing
-- status-change message (verifying/confirmed/rejected/link_sent/paid) is UNCHANGED -- this only adds the
-- insert-time ones. wa_enqueue()/wa_templates are db/184; still dormant until real WA credentials exist.

insert into wa_templates (key, name, audience, title, body, params) values
  ('request_received', 'auzslab_request_received', 'platform', 'Request received',
   'Hi {{1}}, thank you for reaching out to AUZslab about {{2}}. We have received your request and our team will contact you shortly.', '{customer,topic}'),
  ('team_application_received', 'auzslab_team_application_received', 'platform', 'Team application received',
   'Hi {{1}}, thank you for your interest in joining the AUZslab team. We have received your application and will be in touch soon.', '{name}')
on conflict (key) do update set name = excluded.name, audience = excluded.audience, title = excluded.title, body = excluded.body, params = excluded.params;

-- wa_client_order_msg (db/184) redefined: handles TG_OP = 'INSERT' (new, idempotent on id || '-received') as
-- well as the pre-existing `update of status` logic (OLD is never referenced on the INSERT branch -- it is
-- unassigned in an INSERT trigger and referencing it there is a plpgsql error, not merely wrong).
create or replace function wa_client_order_msg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.phone is null then return new; end if;
    if tg_op = 'INSERT' then
      perform wa_enqueue(null, new.phone, 'request_received',
        jsonb_build_array(coalesce(new.contact_name, 'there'), coalesce(nullif(new.business_name, ''), 'your request')), new.id || '-received');
      return new;
    end if;
    if new.status is not distinct from old.status then return new; end if;
    if new.status = 'link_sent' then
      perform wa_enqueue(null, new.phone, 'quote_payment_link', jsonb_build_array(coalesce(new.contact_name, 'there'), wa_site_url() || '/pay.html?t=' || new.token), new.id || '-quote');
    elsif new.status = 'paid' and new.invoice_no is not null then
      perform wa_enqueue(null, new.phone, 'bill_paid', jsonb_build_array(coalesce(new.contact_name, 'there'), new.invoice_no, wa_site_url() || '/inv.html?t=' || new.token), new.id || '-paid');
    elsif new.status in ('verifying', 'confirmed', 'rejected') then
      perform wa_enqueue(null, new.phone, 'request_update', jsonb_build_array(coalesce(new.contact_name, 'there'),
        case new.status when 'verifying' then 'we are checking your request and will be in touch shortly'
                        when 'confirmed' then 'your request is confirmed and your payment link will follow'
                        else 'we could not take this request forward, please call us on +91 9251250829' end), new.id || '-' || new.status);
    end if;
  exception when others then null; -- a message must never block the admin's action
  end;
  return new;
end $$;
drop trigger if exists client_orders_wa on client_orders;
create trigger client_orders_wa after insert or update of status on client_orders for each row execute function wa_client_order_msg();

-- A team application: its own, different confirmation, fired once on INSERT only (never on a later edit/
-- resubmit -- submit_my_team_application's `on conflict ... do update` takes the UPDATE path there, which
-- this AFTER INSERT trigger does not fire for, so a resubmission can never double-send).
create or replace function wa_team_application_msg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.phone is not null then
      perform wa_enqueue(null, new.phone, 'team_application_received', jsonb_build_array(coalesce(new.name, 'there')), new.id || '-received');
    end if;
  exception when others then null;
  end;
  return new;
end $$;
drop trigger if exists team_applications_wa on team_applications;
create trigger team_applications_wa after insert on team_applications for each row execute function wa_team_application_msg();
