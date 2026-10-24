-- Offline capability metadata for the module catalogue (Phase 1A, follows db/263 and db/264). Additive; safe to run again (see the seed and rollback notes).
-- Purpose: let the builder tell a client honestly which modules keep working with no internet. It only DESCRIBES what the
-- code and tests show; it changes no sync behaviour, customer setting, guard or price.
--
-- offline (jsonb) shape:
--   level          full | partial | online_only | unknown
--   verified       boolean   true only when the claim is covered by a browser test in this repository (never "a real phone")
--   basis          browser_tested | code_inspected | documentation_only | none   how the claim was checked
--   summary        plain-language sentence shown to the client
--   works_offline  list of workflows that keep working offline
--   needs_connection list of things that need internet
--   writes_queued  yes | no | unknown        (a string on purpose: unknown must not look like false)
--   retry_safety   op_id | record_id | none | unknown   how a retry is kept from duplicating work
--   conflicts      what happens when the same record changed elsewhere (or "Not checked.")
--   evidence       repository files that support the assessment
-- Rules (enforced by the check below; an incomplete or wrongly typed object is REJECTED, never waved through):
--   * every key above must be present with the right type and an allowed value;
--   * full needs verified = true; verified = true needs basis = browser_tested; level unknown cannot be verified;
--   * a new row, or one that is not given any metadata, is "unknown, unverified" (the column default).
-- "browser_tested" means a test in this repository drives the behaviour in a headless test browser. It does NOT mean it was
-- tried on a real phone or tablet; that has not been done for any module.

create or replace function module_offline_ok(o jsonb) returns boolean
language plpgsql immutable as $$
declare lv text; vf jsonb; bs text; k text;
begin
  -- plpgsql with early returns, so a missing key can never turn the check into NULL (a CHECK accepts NULL)
  if o is null or jsonb_typeof(o) <> 'object' then return false; end if;
  foreach k in array array['level','verified','basis','summary','works_offline','needs_connection','writes_queued','retry_safety','conflicts','evidence'] loop
    if not (o ? k) then return false; end if;
  end loop;
  lv := o->>'level'; vf := o->'verified'; bs := o->>'basis';
  if jsonb_typeof(o->'level') <> 'string' or lv not in ('full', 'partial', 'online_only', 'unknown') then return false; end if;
  if jsonb_typeof(vf) <> 'boolean' then return false; end if;
  if jsonb_typeof(o->'basis') <> 'string' or bs not in ('browser_tested', 'code_inspected', 'documentation_only', 'none') then return false; end if;
  if jsonb_typeof(o->'summary') <> 'string' or jsonb_typeof(o->'conflicts') <> 'string' then return false; end if;
  if jsonb_typeof(o->'works_offline') <> 'array' or jsonb_typeof(o->'needs_connection') <> 'array' or jsonb_typeof(o->'evidence') <> 'array' then return false; end if;
  if exists (select 1 from jsonb_array_elements(o->'works_offline') e where jsonb_typeof(e) <> 'string')
     or exists (select 1 from jsonb_array_elements(o->'needs_connection') e where jsonb_typeof(e) <> 'string')
     or exists (select 1 from jsonb_array_elements(o->'evidence') e where jsonb_typeof(e) <> 'string') then return false; end if;
  if jsonb_typeof(o->'writes_queued') <> 'string' or o->>'writes_queued' not in ('yes', 'no', 'unknown') then return false; end if;
  if jsonb_typeof(o->'retry_safety') <> 'string' or o->>'retry_safety' not in ('op_id', 'record_id', 'none', 'unknown') then return false; end if;
  if lv = 'full' and vf <> 'true'::jsonb then return false; end if;
  if vf = 'true'::jsonb and bs <> 'browser_tested' then return false; end if;
  if lv = 'unknown' and vf = 'true'::jsonb then return false; end if;
  return true;
end $$;

alter table module_catalogue add column if not exists offline jsonb not null
  default '{"level":"unknown","verified":false,"basis":"none","summary":"Not checked yet.","works_offline":[],"needs_connection":[],"writes_queued":"unknown","retry_safety":"unknown","conflicts":"Not checked yet.","evidence":[]}'::jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'module_catalogue_offline_ok') then
    alter table module_catalogue add constraint module_catalogue_offline_ok check (module_offline_ok(offline));
  end if;
end $$;

-- Seed (evidence-based; see each entry's evidence list). GUARDED: a module only receives its seed value while its metadata is
-- still the untouched column default, so running this file again never overwrites metadata that was edited afterwards.
-- Limits: (1) a module deliberately set back to exactly the default would be seeded again; (2) a later correction to a seed
-- value needs its own new migration or a manual edit, because this file will not replace an already-set value.
do $seed$
declare v_def jsonb := '{"level":"unknown","verified":false,"basis":"none","summary":"Not checked yet.","works_offline":[],"needs_connection":[],"writes_queued":"unknown","retry_safety":"unknown","conflicts":"Not checked yet.","evidence":[]}'::jsonb; r record;
begin
  for r in select * from (values
    ('pos', '{"level": "full", "verified": true, "basis": "browser_tested", "summary": "Billing, orders, tables and stock keep working with no internet. Changes wait on the device and send themselves when the connection returns.", "works_offline": ["Selling and billing", "Saving orders", "Browsing the menu and stock from the local copy"], "needs_connection": ["Manager approval by another person''s PIN", "Gift card use", "First sign-in on a device", "Live updates between devices", "QR guest orders arriving"], "writes_queued": "yes", "retry_safety": "record_id", "conflicts": "If the same order changed elsewhere, the server detects the stale copy; the app reloads the server copy or re-sends. A server refusal rolls the change back and tells the user.", "evidence": ["LOCAL-FIRST-IMPLEMENTATION.md", "app/public/pos/core.js", "app/public/pos/ui.js", "app/public/pos/pay.js", "tests/suites/local/offline.mjs"]}'::jsonb),
    ('kitchen', '{"level": "partial", "verified": false, "basis": "code_inspected", "summary": "The kitchen screen reads the same local copy as the POS, so it opens offline. Updates reach other screens only when there is a connection.", "works_offline": ["Opening the kitchen screen from the local copy", "Marking tickets as preparing or ready on this device"], "needs_connection": ["Seeing new tickets from other devices", "Syncing status changes"], "writes_queued": "yes", "retry_safety": "record_id", "conflicts": "Uses the POS order records and their conflict rules. Not tested separately.", "evidence": ["app/public/pos/kitchen.js", "app/public/pos/shell.js"]}'::jsonb),
    ('self_order', '{"level": "online_only", "verified": false, "basis": "code_inspected", "summary": "Guests order from their own phone through the website, which needs internet. No offline path exists.", "works_offline": [], "needs_connection": ["Placing a QR order", "Calling a waiter"], "writes_queued": "no", "retry_safety": "none", "conflicts": "Not applicable: no offline writes.", "evidence": ["app/public/site.html"]}'::jsonb),
    ('scan', '{"level": "full", "verified": true, "basis": "browser_tested", "summary": "Selling and receiving stock by scanning keep working with no internet. Sales wait on the device with a provisional number and are sent later.", "works_offline": ["Scanning and billing", "Adding a new product", "Receiving stock"], "needs_connection": ["Changing saved product prices", "Import and bulk edit", "The final invoice number and public bill link", "First sign-in on a device"], "writes_queued": "yes", "retry_safety": "op_id", "conflicts": "Each queued item carries a unique operation id, so a retry cannot create a second bill. A sale that already happened is never refused for stock; stock can go below zero until counted. Refused items stay listed with Retry or Discard.", "evidence": ["app/public/accounts/scan-sync.js", "db/154_scan_offline_first.sql", "tests/suites/local/scan.mjs"]}'::jsonb),
    ('accounting', '{"level": "partial", "verified": true, "basis": "browser_tested", "summary": "Accounting is server-authoritative on purpose. Offline you can write a bill as a draft; nothing is posted until you are online.", "works_offline": ["Starting the app from the saved copy", "Writing a bill or expense as a draft"], "needs_connection": ["Posting", "Invoice numbers", "Stock and ledger changes", "Reports", "Bank and GST work"], "writes_queued": "yes", "retry_safety": "op_id", "conflicts": "Drafts carry a unique id and arrive once; posting is always a separate online step.", "evidence": ["app/public/accounts/offline.js", "db/123_acc_offline_draft.sql", "tests/suites/local/accoffline.mjs"]}'::jsonb),
    ('payroll', '{"level": "partial", "verified": false, "basis": "code_inspected", "summary": "Only staff clock in and out is kept on the phone. Everything else needs internet. The phone queue has not been tested in a real browser.", "works_offline": ["Clock in and clock out (queued with the real time)"], "needs_connection": ["Everything except clock in and out", "Payroll runs", "Leave and approvals"], "writes_queued": "yes", "retry_safety": "op_id", "conflicts": "Each punch has a unique operation id; the server decides in or out and refuses times that are in the future or too old. Browser behaviour is not verified.", "evidence": ["app/public/payroll/p-me.js", "db/120_pay_offline_punch.sql"]}'::jsonb),
    ('mobile', '{"level": "full", "verified": true, "basis": "browser_tested", "summary": "Sales, purchases, repairs and stock keep working with no internet. Changes wait on the phone and send themselves later.", "works_offline": ["Selling", "Purchases", "Repair job cards", "Stock and reports from the local copy"], "needs_connection": ["First sign-in on a device", "Sharing the styled receipt link", "Clearing all data"], "writes_queued": "yes", "retry_safety": "op_id", "conflicts": "Every write has a phone-made id, so a retry never doubles it. A temporary failure keeps the write; a real refusal rolls it back and shows a message.", "evidence": ["app/public/mob/sync.js", "LOCAL-FIRST-IMPLEMENTATION.md", "tests/suites/local/offline.mjs"]}'::jsonb),
    ('style', '{"level": "partial", "verified": false, "basis": "code_inspected", "summary": "Sales, stock receiving and returns are kept on the device when the shop is offline and sent later. Other changes need internet. Not tested offline.", "works_offline": ["Selling", "Receiving stock", "Returns"], "needs_connection": ["Editing styles and prices", "Analytics", "Online store", "Anything not listed as working offline"], "writes_queued": "yes", "retry_safety": "op_id", "conflicts": "Sales carry a phone-made id. A refused item is dropped with a message. Whether the cached stock is corrected after a refusal has not been verified.", "evidence": ["app/public/style/data.js"]}'::jsonb),
    ('finance', '{"level": "online_only", "verified": false, "basis": "code_inspected", "summary": "AUZsFinance needs internet. When offline it shows an error and saves nothing. It is also not stored for cold start.", "works_offline": [], "needs_connection": ["Every entry and report"], "writes_queued": "no", "retry_safety": "none", "conflicts": "Not applicable: no offline writes.", "evidence": ["app/public/finance/data.js", "app/public/sw.js"]}'::jsonb),
    ('website_builder', '{"level": "unknown", "verified": false, "basis": "code_inspected", "summary": "The editor keeps a local copy and a send queue like the POS, but its behaviour offline has not been checked and publishing needs internet. Not yet verified.", "works_offline": [], "needs_connection": ["Publishing", "Visitors seeing the live website"], "writes_queued": "unknown", "retry_safety": "unknown", "conflicts": "Not checked.", "evidence": ["app/public/builder.html"]}'::jsonb),
    ('salon', '{"level": "online_only", "verified": false, "basis": "code_inspected", "summary": "The salon console and booking pages need internet. No offline queue was found.", "works_offline": [], "needs_connection": ["Everything"], "writes_queued": "no", "retry_safety": "none", "conflicts": "Not applicable: no offline writes.", "evidence": ["server/src/salon/router.js", "app/public/salon/"]}'::jsonb),
    ('hub', '{"level": "online_only", "verified": false, "basis": "code_inspected", "summary": "Sign-in and the app launcher need internet.", "works_offline": [], "needs_connection": ["Signing in", "Opening apps"], "writes_queued": "no", "retry_safety": "none", "conflicts": "Not applicable.", "evidence": ["app/public/start.js"]}'::jsonb)
  ) as t(k, j) loop
    update module_catalogue set offline = r.j where key = r.k and offline = v_def;
  end loop;
end $seed$;

-- same output as db/263 plus the offline metadata
create or replace function public_module_catalogue() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label, 'description', description, 'family', family,
    'niches', to_jsonb(niches), 'requires', to_jsonb(requires), 'conflicts', to_jsonb(conflicts), 'features', to_jsonb(features),
    'status', status, 'templates', to_jsonb(templates), 'screens', screens, 'offline', offline) order by sort, key), '[]'::jsonb)
  from module_catalogue where active
$$;

-- ROLLBACK (manual, in exactly this order; migrations 263 and 264 are NOT rolled back and keep working):
--   1. Put the previous public_module_catalogue() back (the definition from db/263_module_catalogue.sql, i.e. without 'offline'):
--        create or replace function public_module_catalogue() returns jsonb
--        language sql stable security definer set search_path = public as $q$
--          select coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label, 'description', description, 'family', family,
--            'niches', to_jsonb(niches), 'requires', to_jsonb(requires), 'conflicts', to_jsonb(conflicts), 'features', to_jsonb(features),
--            'status', status, 'templates', to_jsonb(templates), 'screens', screens) order by sort, key), '[]'::jsonb)
--          from module_catalogue where active
--        $q$;
--   2. alter table module_catalogue drop constraint if exists module_catalogue_offline_ok;
--   3. alter table module_catalogue drop column if exists offline;
--   4. drop function if exists module_offline_ok(jsonb);
-- Step 1 must come first, otherwise the public catalogue function would still name the column you are about to drop.
-- A browser running the new builder against a rolled-back database simply shows "Not yet checked".
