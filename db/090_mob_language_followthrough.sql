-- =========================================================
-- AUZsMob: let the language picked at the (pre-login) sign-in screen actually carry into the app.
--
-- Owner report: "I want the whole app in Hindi/English, not just the login page." The login screen's
-- EN/HI toggle (shell.js) only ever set a local, pre-auth choice -- there's no account yet to save it
-- against. Once signed in, boot() unconditionally overwrote S_LANG with the server-saved preference
-- (mob_context().my_language), which defaults to English until someone explicitly opens Settings and
-- picks a language there. So switching languages at login looked like it worked (the login screen itself
-- changed), then silently reverted the moment you signed in -- every other screen was already wired
-- through the same t()/S_LANG mechanism and would have shown Hindi fine, it just never got the chance.
--
-- To let the client carry the local pre-login pick forward (without ever clobbering a real, deliberate
-- choice), mob_context() needs to say whether 'my_language' is a real preference or just a fallback.
-- mob_settings.language was `not null default 'en'` though, so s.language was never actually null -- a
-- shop that never touched Settings looked identical to one that explicitly chose English. Dropping that
-- default so NULL genuinely means "never set" is what makes the new flag mean anything.
-- =========================================================
alter table mob_settings alter column language drop default;
alter table mob_settings alter column language drop not null;

create or replace function mob_context() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; s mob_settings; lang text; demo boolean; seeded timestamptz; caller_uid text;
begin
  tid := (me()->>'tenant_id')::uuid;
  if tid is not null then
    select is_demo into demo from tenants where id = tid;
    if demo and coalesce((select features->>'mobile' from tenant_settings where tenant_id = tid), 'false') = 'true' then
      select demo_seeded_at into seeded from mob_settings where tenant_id = tid;
      if (seeded is null or now() - seeded > interval '12 hours') and pg_try_advisory_xact_lock(hashtext('mob_demo_reset')) then
        caller_uid := current_setting('app.uid', true);
        perform mob_demo_seed(tid);
        perform set_config('app.uid', caller_uid, true);
      end if;
    end if;
  end if;

  tid := mob_tenant();
  select * into s from mob_settings where tenant_id = tid;
  if s.tenant_id is null then
    -- first visit: create a default settings row so every later read/write has one to update
    insert into mob_settings (tenant_id) values (tid) on conflict (tenant_id) do nothing returning * into s;
    if s.tenant_id is null then select * into s from mob_settings where tenant_id = tid; end if;
  end if;
  select language into lang from mob_staff_prefs where tenant_id = tid and user_id = app_uid();
  return jsonb_build_object(
    'perms', mob_perms(),
    'can_see_rates', (me()->>'role') in ('owner', 'manager') or coalesce(s.staff_see_purchase_rates, false),
    'settings', jsonb_build_object(
      'shopName', s.shop_name, 'address', s.address, 'phone', s.phone, 'logoUrl', s.logo_url,
      'billFooter', s.bill_footer, 'billPrefix', s.bill_prefix, 'language', s.language,
      'staffSeePurchaseRates', s.staff_see_purchase_rates, 'dayCloseDate', s.day_close_date
    ),
    'my_language', coalesce(lang, s.language, 'en'),
    'my_language_set', lang is not null or s.language is not null
  );
end $$;

-- mob_save_settings left `language` out of its coalesce-from-null-means-keep contract no changes needed --
-- `coalesce(p->>'language', language)` already only touches the column when the caller actually sends one.
