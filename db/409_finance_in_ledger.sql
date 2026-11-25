-- AUZsFinance features now live inside the AUZsLedger tabs, so every business that has AUZsLedger can use them
-- (before, they needed the separate "finance" switch). Also fixes notification links that pointed at the old finance.html page.
-- Rollback: restore fin_guard from db/250 and drop trigger notifications_fin_link / function fin_link_rewrite.
create or replace function fin_guard(k text default 'view') returns uuid language plpgsql stable security definer set search_path = public as $$
declare tid uuid; f jsonb; e jsonb; ok boolean;
begin
  if me() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  tid := (me()->>'tenant_id')::uuid;
  if tid is null then raise exception 'not a tenant member'; end if;
  select features, enabled_features into f, e from tenant_settings where tenant_id = tid;
  if not ((coalesce(f->>'finance','false') = 'true' and coalesce(e->>'finance','true') <> 'false')
       or (coalesce(f->>'accounting','false') = 'true' and coalesce(e->>'accounting','true') <> 'false')) then
    raise exception 'Money entries are not enabled for this business';
  end if;
  ok := case k when 'view' then acc_perm('acc_view') when 'write' then acc_perm('acc_post') else acc_perm('acc_admin') end;
  if not ok then raise exception 'Your role does not allow this action (finance %)', k using errcode = '42501'; end if;
  return tid;
end $$;

-- /finance.html#/<page>?... -> /accounts.html#/<tab>?sec=fin-<page>&...
create or replace function fin_link_rewrite(p_link text) returns text language plpgsql immutable as $$
declare rest text; pg text; qs text; host text;
begin
  if p_link is null or p_link not like '/finance.html#/%' then return p_link; end if;
  rest := substr(p_link, length('/finance.html#/') + 1);
  pg := split_part(rest, '?', 1); qs := nullif(substr(rest, length(pg) + 2), '');
  host := case pg when 'home' then 'home' when 'activity' then 'books' when 'owner' then 'books' when 'dues' then 'parties'
    when 'accounts' then 'banking' when 'withdrawals' then 'banking' when 'bank' then 'banking' when 'reports' then 'reports'
    when 'budget' then 'reports' when 'assets' then 'assets' when 'insights' then 'analytics' when 'tax' then 'gst'
    when 'approvals' then 'expreq' when 'repeat' then 'subscriptions' when 'settings' then 'settings' else 'home' end;
  return '/accounts.html#/' || host || '?sec=fin-' || case when pg in ('home','activity','owner','dues','accounts','withdrawals','bank','reports','budget','assets','insights','tax','approvals','repeat','settings') then pg else 'home' end
    || coalesce('&' || qs, '');
end $$;

create or replace function notifications_fin_link() returns trigger language plpgsql as $$
begin new.link := fin_link_rewrite(new.link); return new; end $$;
drop trigger if exists notifications_fin_link on notifications;
create trigger notifications_fin_link before insert or update of link on notifications for each row execute function notifications_fin_link();
update notifications set link = fin_link_rewrite(link) where link like '/finance.html#/%';
