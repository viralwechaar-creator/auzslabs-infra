-- =========================================================
-- Targeted push (native apps): tell the right people, not every phone in the business.
-- notify_push_users() sends the same 'push_events' envelope as notify_push() plus the user ids to reach;
-- server/src/push.js sends those only to those people's registered phones (fcm_tokens).
-- AUZsPay uses it: a request from an employee reaches the owner and managers, and the decision reaches the employee.
-- All triggers are SECURITY DEFINER and swallow their own errors: an alert must never block a leave request.
-- =========================================================

create or replace function notify_push_users(p_tenant_id uuid, p_user_ids uuid[], title text, body text) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user_ids is null or array_length(p_user_ids, 1) is null then return; end if;
  perform pg_notify('push_events', jsonb_build_object('tenant_id', p_tenant_id, 'user_ids', to_jsonb(p_user_ids), 'title', title, 'body', body)::text);
end $$;

create or replace function pay_push_approvers(p_tenant uuid, p_title text, p_body text) returns void language plpgsql security definer set search_path = public as $$
begin
  perform notify_push_users(p_tenant, coalesce((select array_agg(id) from profiles where tenant_id = p_tenant and role in ('owner', 'manager') and coalesce(login_off, false) = false), '{}'), p_title, p_body);
exception when others then null;
end $$;

create or replace function pay_push_employee(p_tenant uuid, p_emp text, p_title text, p_body text) returns void language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  select user_id into u from pay_employees where id = p_emp and tenant_id = p_tenant;
  if u is not null then perform notify_push_users(p_tenant, array[u], p_title, p_body); end if;
exception when others then null;
end $$;

create or replace function pay_push_request_trigger() returns trigger language plpgsql security definer set search_path = public as $$
declare who text; what text; st_old text; st_new text; emp text;
begin
  emp := NEW.employee_id;
  select name into who from pay_employees where id = emp;
  what := case TG_TABLE_NAME when 'pay_leave_requests' then 'leave' when 'pay_claims' then 'expense claim' when 'pay_loans' then 'advance' else 'time correction' end;
  st_new := NEW.status;
  if TG_OP = 'INSERT' then
    if st_new in ('pending', 'submitted', 'requested') then
      perform pay_push_approvers(NEW.tenant_id, 'New ' || what || ' request', coalesce(who, 'An employee') || ' is waiting for your decision');
    end if;
  else
    st_old := OLD.status;
    if st_new is distinct from st_old and st_new in ('approved', 'rejected', 'active', 'paid') then
      perform pay_push_employee(NEW.tenant_id, emp, 'Your ' || what || ' request', 'It was ' || case st_new when 'rejected' then 'declined' when 'paid' then 'paid' else 'approved' end);
    end if;
  end if;
  return NEW;
exception when others then
  return NEW;
end $$;

drop trigger if exists pay_push_leave on pay_leave_requests;
create trigger pay_push_leave after insert or update of status on pay_leave_requests for each row execute function pay_push_request_trigger();
drop trigger if exists pay_push_claims on pay_claims;
create trigger pay_push_claims after insert or update of status on pay_claims for each row execute function pay_push_request_trigger();
drop trigger if exists pay_push_loans on pay_loans;
create trigger pay_push_loans after insert or update of status on pay_loans for each row execute function pay_push_request_trigger();
drop trigger if exists pay_push_reg on pay_regularizations;
create trigger pay_push_reg after insert or update of status on pay_regularizations for each row execute function pay_push_request_trigger();
