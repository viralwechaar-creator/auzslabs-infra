-- Theme editor, step 13: a newsletter signup section. A visitor types an email; it becomes (or updates) a customer of the store with
-- marketing consent recorded (what, when, where from = 'newsletter'). Nothing is sent by this; it only collects people who said yes.
-- The answer never says whether the address was already known. A store accepts at most 200 new signups an hour.
-- Rollback: drop function public_sfx_newsletter_subscribe(text, text); delete from sfx_section_types where type = 'newsletter';

insert into sfx_section_types (type, label, description, position, settings, block_types, max_blocks, layout) values
('newsletter', 'Newsletter signup', 'An email box so visitors can join your list.', 130,
  '[{"id":"heading","type":"text","label":"Heading"},{"id":"text","type":"textarea","label":"Text under the heading"},{"id":"button","type":"text","label":"Button text"},{"id":"thanks","type":"text","label":"Message after signing up"}]',
  '[]', 1, true)
on conflict (type) do nothing;

create or replace function public_sfx_newsletter_subscribe(p_slug text, p_email text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_public_tenant(p_slug); e text := lower(trim(coalesce(p_email, ''))); c sfx_customers;
begin
  if tid is null then return jsonb_build_object('ok', false); end if;
  if length(e) > 160 or e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('ok', false, 'error', 'Please enter a valid email address.'); end if;
  if (select count(*) from sfx_customers where tenant_id = tid and consent_source = 'newsletter' and consent_at > now() - interval '1 hour') >= 200 then
    return jsonb_build_object('ok', false, 'error', 'Please try again a little later.');
  end if;
  select * into c from sfx_customers where tenant_id = tid and lower(email) = e order by created_at limit 1;
  if found then
    if not c.accepts_marketing then
      update sfx_customers set accepts_marketing = true, consent_at = now(), consent_source = 'newsletter', updated_at = now() where id = c.id;
    end if;
  else
    insert into sfx_customers (tenant_id, name, email, source, accepts_marketing, consent_at, consent_source)
    values (tid, 'Subscriber', e, 'newsletter', true, now(), 'newsletter');
  end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public_sfx_newsletter_subscribe(text, text) to app;
