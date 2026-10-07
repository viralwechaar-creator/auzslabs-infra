-- DPDP Act 2023 support: a record of what each person agreed to, their rights requests (access, correction, erasure,
-- withdraw consent, nominee, grievance), a way to download their personal data, and an admin queue to answer them.
-- Both tables: RLS on with no policies; only the SECURITY DEFINER functions below read or write them.
insert into platform_flags (key, value) values ('privacy_version', '2026-10') on conflict (key) do nothing;

create table if not exists user_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth_users(id) on delete cascade,
  notice_version text not null,
  purposes jsonb not null default '{"service":true}'::jsonb,   -- {service:true, updates:false}
  source text,                                                  -- signup | account | app
  accepted_at timestamptz not null default now(),
  withdrawn_at timestamptz
);
create index if not exists user_consents_user_idx on user_consents (user_id, accepted_at desc);
alter table user_consents enable row level security;

create table if not exists data_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth_users(id) on delete cascade,
  kind text not null check (kind in ('access','correction','erasure','withdraw','nominee','grievance','other')),
  message text not null default '',
  status text not null default 'open' check (status in ('open','in_progress','done','rejected')),
  response text,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,                                  -- first time an admin touched it (target: 48 h)
  due_at timestamptz not null default now() + interval '30 days',
  closed_at timestamptz,
  handled_by uuid
);
create index if not exists data_requests_status_idx on data_requests (status, created_at);
alter table data_requests enable row level security;

create or replace function privacy_current_version() returns text
language sql security definer stable set search_path = public as $$
  select coalesce((select value from platform_flags where key = 'privacy_version'), '2026-10')
$$;

-- Record that the caller read the notice and agreed (service = needed to run the account; updates = optional emails).
-- Called right after sign-in from the sign-up page, or from the account page. Same version twice = no new row.
create or replace function record_my_consent(p_purposes jsonb default '{"service":true}'::jsonb, p_source text default 'account') returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := app_uid(); v text := privacy_current_version(); pur jsonb; cur user_consents;
begin
  if uid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  pur := jsonb_build_object('service', true, 'updates', coalesce((p_purposes->>'updates')::boolean, false));
  select * into cur from user_consents where user_id = uid and notice_version = v and withdrawn_at is null order by accepted_at desc limit 1;
  if cur.id is not null then
    if cur.purposes is distinct from pur then update user_consents set purposes = pur where id = cur.id; end if;
  else
    insert into user_consents (user_id, notice_version, purposes, source) values (uid, v, pur, left(coalesce(p_source, 'account'), 20));
  end if;
  return my_consents();
end $$;

create or replace function my_consents() returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare uid uuid := app_uid(); v text := privacy_current_version(); cur user_consents;
begin
  if uid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select * into cur from user_consents where user_id = uid and withdrawn_at is null order by accepted_at desc limit 1;
  return jsonb_build_object('current_version', v,
    'accepted_version', cur.notice_version, 'accepted_at', cur.accepted_at,
    'up_to_date', cur.id is not null and cur.notice_version = v,
    'purposes', coalesce(cur.purposes, '{}'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('version', notice_version, 'purposes', purposes, 'source', source, 'accepted_at', accepted_at, 'withdrawn_at', withdrawn_at) order by accepted_at desc)
                         from user_consents where user_id = uid), '[]'::jsonb));
end $$;

-- Withdraw the optional consent (updates emails) right away. Withdrawing the main one means the account cannot be run:
-- that opens an erasure request and tells the person how to delete the account themselves.
create or replace function withdraw_my_consent(p_purpose text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := app_uid(); cur user_consents; note text;
begin
  if uid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select * into cur from user_consents where user_id = uid and withdrawn_at is null order by accepted_at desc limit 1;
  if p_purpose = 'updates' then
    if cur.id is not null then update user_consents set purposes = purposes || '{"updates":false}'::jsonb where id = cur.id; end if;
    note := 'You will not get product update emails any more.';
  elsif p_purpose = 'service' then
    insert into data_requests (user_id, kind, message) values (uid, 'withdraw', 'Withdrew consent to process data for running the account.');
    note := 'We cannot run an account without this. We have logged your request. To delete your account right now use "Delete your account".';
  else
    raise exception 'unknown purpose';
  end if;
  return jsonb_build_object('ok', true, 'note', note, 'consents', my_consents());
end $$;

create or replace function submit_data_request(p_kind text, p_message text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := app_uid(); r data_requests;
begin
  if uid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_kind not in ('access','correction','erasure','nominee','grievance','other') then raise exception 'Choose what you want to ask for.'; end if;
  if (select count(*) from data_requests where user_id = uid and status in ('open','in_progress')) >= 5 then
    raise exception 'You already have several open requests. We will reply to them first.';
  end if;
  if p_kind in ('correction','nominee','grievance','other') and length(trim(coalesce(p_message, ''))) < 5 then raise exception 'Please describe your request in a few words.'; end if;
  insert into data_requests (user_id, kind, message) values (uid, p_kind, left(trim(coalesce(p_message, '')), 2000)) returning * into r;
  return jsonb_build_object('id', r.id, 'status', r.status, 'due_at', r.due_at);
end $$;

create or replace function my_data_requests() returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare uid uuid := app_uid();
begin
  if uid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'message', message, 'status', status, 'response', response,
      'created_at', created_at, 'acknowledged_at', acknowledged_at, 'due_at', due_at, 'closed_at', closed_at) order by created_at desc)
    from data_requests where user_id = uid), '[]'::jsonb);
end $$;

-- Everything personal we hold about the caller as a person (never password/PIN hashes, tokens or secrets).
-- Business data (orders, bills, staff records of a shop) belongs to the business: owners download that with "Backup".
create or replace function my_personal_data() returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare uid uuid := app_uid();
begin
  if uid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  return jsonb_build_object(
    'generated_at', now(),
    'note', 'Personal data AUZslab holds about you. Business records you entered for your shop are in your business backup (Settings, Backup).',
    'account', (select jsonb_build_object('login_email', email, 'username', username, 'created_at', created_at, 'email_verified_at', email_verified_at,
                  'recovery_email', recovery_email, 'has_password', password_hash is not null, 'disabled', disabled_at is not null)
                from auth_users where id = uid),
    'sign_in_methods', coalesce((select jsonb_agg(jsonb_build_object('provider', provider, 'email', email, 'added_at', created_at)) from auth_identities where user_id = uid), '[]'::jsonb),
    'businesses', coalesce((select jsonb_agg(jsonb_build_object('business', t.name, 'address', t.slug, 'role', p.role)) from profiles p left join tenants t on t.id = p.tenant_id where p.id = uid), '[]'::jsonb),
    'profile', (select to_jsonb(up) - 'user_id' from user_profiles up where up.user_id = uid),
    'devices_signed_in', coalesce((select jsonb_agg(jsonb_build_object('device', device_label, 'ip', ip, 'signed_in_at', created_at, 'last_seen_at', last_seen_at, 'signed_out_at', revoked_at) order by created_at desc)
                                   from (select * from auth_sessions where user_id = uid order by created_at desc limit 50) s), '[]'::jsonb),
    'consents', (select my_consents()->'history'),
    'requests', (select my_data_requests()));
end $$;

-- Platform admin: the queue, oldest open first, with how overdue each one is.
create or replace function admin_list_data_requests(p_status text default 'active') returns jsonb
language plpgsql security definer stable set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('id', r.id, 'kind', r.kind, 'message', r.message, 'status', r.status, 'response', r.response, 'created_at', r.created_at,
      'acknowledged_at', r.acknowledged_at, 'due_at', r.due_at, 'closed_at', r.closed_at, 'login_email', au.email,
      'name', up.name, 'phone', up.phone, 'business', (select string_agg(t.name, ', ') from profiles p join tenants t on t.id = p.tenant_id where p.id = r.user_id),
      'ack_overdue', r.acknowledged_at is null and r.status = 'open' and r.created_at < now() - interval '48 hours',
      'overdue', r.closed_at is null and r.due_at < now()) as x
    from data_requests r join auth_users au on au.id = r.user_id left join user_profiles up on up.user_id = r.user_id
    where case p_status when 'all' then true when 'active' then r.status in ('open','in_progress') else r.status = p_status end
    order by (r.closed_at is not null), r.created_at limit 300
  ) q), '[]'::jsonb);
end $$;

create or replace function admin_update_data_request(p_id uuid, p_status text, p_response text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r data_requests;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if p_status not in ('open','in_progress','done','rejected') then raise exception 'bad status'; end if;
  if p_status in ('done','rejected') and length(trim(coalesce(p_response, ''))) < 3 then raise exception 'Write a short reply for the person before closing the request.'; end if;
  update data_requests set status = p_status, response = coalesce(nullif(trim(p_response), ''), response), acknowledged_at = coalesce(acknowledged_at, now()),
    closed_at = case when p_status in ('done','rejected') then now() else null end, handled_by = app_uid()
    where id = p_id returning * into r;
  if r.id is null then raise exception 'request not found'; end if;
  perform admin_log('data_request_' || p_status, 'data_request', p_id::text, jsonb_build_object('kind', r.kind));
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_open_data_request_count() returns int
language plpgsql security definer stable set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return (select count(*) from data_requests where status in ('open','in_progress'))::int;
end $$;
