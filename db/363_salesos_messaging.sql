-- AUZslab SalesOS: internal messaging. Direct messages between any two internal staff, plus a
-- manager/admin "team announcement" broadcast. Both feed the existing sos_notifications inbox
-- (db/360) rather than inventing a second delivery mechanism.
create table sos_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  sender_id uuid not null references auth_users(id) on delete cascade,
  recipient_id uuid references auth_users(id) on delete cascade, -- null = team-wide broadcast
  body text not null,
  created_at timestamptz not null default now()
);
create index idx_sos_messages_dm on sos_messages (tenant_id, sender_id, recipient_id, created_at);
create index idx_sos_messages_broadcast on sos_messages (tenant_id, created_at desc) where recipient_id is null;
alter table sos_messages enable row level security;

-- every internal staffer, for picking who to message.
create function sos_team_directory() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', coalesce(pr.name, u.email), 'role', pr.role) order by pr.role, coalesce(pr.name, u.email))
    from profiles pr join auth_users u on u.id = pr.id where pr.tenant_id = tid and pr.id <> app_uid()), '[]'::jsonb);
end $$;

create function sos_message_send(p_recipient uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard(); row sos_messages%rowtype; v_recipient_id uuid;
begin
  if nullif(btrim(p_body), '') is null then raise exception 'Write a message first'; end if;
  if length(p_body) > 2000 then raise exception 'Keep a message under 2000 characters'; end if;
  if p_recipient is not null then
    if not exists (select 1 from profiles where id = p_recipient and tenant_id = tid) then raise exception 'that person is not on this team'; end if;
  elsif not sos_perm('sos_manage') then
    raise exception 'Only a manager can send a team-wide announcement';
  end if;
  insert into sos_messages (tenant_id, sender_id, recipient_id, body) values (tid, app_uid(), p_recipient, btrim(p_body))
  returning * into row;
  if p_recipient is not null then
    perform sos_notify(p_recipient, 'message', 'New message', left(row.body, 140), 'message', row.id);
  else
    for v_recipient_id in select id from profiles where tenant_id = tid and id <> app_uid() loop
      perform sos_notify(v_recipient_id, 'announcement', 'Team announcement', left(row.body, 140), 'message', row.id);
    end loop;
  end if;
  perform sos_log('send', case when p_recipient is null then 'announcement' else 'message' end, row.id, null);
  return to_jsonb(row);
end $$;

-- one DM thread with a specific person.
create function sos_conversation(p_with uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'senderId', m.sender_id, 'body', m.body, 'createdAt', m.created_at, 'mine', m.sender_id = app_uid()) order by m.created_at)
    from sos_messages m where m.tenant_id = tid and m.recipient_id is not null
      and ((m.sender_id = app_uid() and m.recipient_id = p_with) or (m.sender_id = p_with and m.recipient_id = app_uid()))), '[]'::jsonb);
end $$;

-- inbox view: the latest message in every DM thread the caller is part of, newest first, plus unread count.
create function sos_my_conversations() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard();
begin
  return coalesce((select jsonb_agg(x order by x->>'lastAt' desc) from (
    select jsonb_build_object(
      'withId', other_id, 'withName', coalesce(pr.name, u.email),
      'lastBody', (select body from sos_messages m2 where m2.tenant_id = tid
        and ((m2.sender_id = app_uid() and m2.recipient_id = other_id) or (m2.sender_id = other_id and m2.recipient_id = app_uid()))
        order by m2.created_at desc limit 1),
      'lastAt', (select created_at from sos_messages m2 where m2.tenant_id = tid
        and ((m2.sender_id = app_uid() and m2.recipient_id = other_id) or (m2.sender_id = other_id and m2.recipient_id = app_uid()))
        order by m2.created_at desc limit 1)
    ) as x
    from (
      select distinct case when sender_id = app_uid() then recipient_id else sender_id end as other_id
      from sos_messages where tenant_id = tid and recipient_id is not null and (sender_id = app_uid() or recipient_id = app_uid())
    ) t join profiles pr on pr.id = t.other_id join auth_users u on u.id = t.other_id
  ) y), '[]'::jsonb);
end $$;

-- team-wide announcements feed (anyone internal can read; only a manager can post, enforced in sos_message_send).
create function sos_announcements() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'senderName', coalesce(pr.name, u.email), 'body', m.body, 'createdAt', m.created_at) order by m.created_at desc)
    from sos_messages m join auth_users u on u.id = m.sender_id left join profiles pr on pr.id = m.sender_id
    where m.tenant_id = tid and m.recipient_id is null
    limit 50), '[]'::jsonb);
end $$;

grant select, insert on sos_messages to app;
grant execute on function sos_team_directory() to app;
grant execute on function sos_message_send(uuid, text) to app;
grant execute on function sos_conversation(uuid) to app;
grant execute on function sos_my_conversations() to app;
grant execute on function sos_announcements() to app;
