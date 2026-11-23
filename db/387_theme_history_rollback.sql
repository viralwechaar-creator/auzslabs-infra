-- Theme library gap (Codex design): every publish keeps a version, the owner can see them and bring one back
-- into the draft (then publish again if they like it). Additive: nothing existing changes behaviour.
create table if not exists sfx_theme_install_history (
  id uuid primary key default gen_random_uuid(),
  install_id uuid not null references sfx_theme_installs(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  content jsonb not null,
  published_at timestamptz not null default now()
);
create index if not exists idx_sfx_theme_hist_install on sfx_theme_install_history (install_id, published_at desc);
alter table sfx_theme_install_history enable row level security;   -- no policies: functions only

create or replace function sfx_theme_hist_trg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.published_content is not null and new.published_content is distinct from old.published_content then
    insert into sfx_theme_install_history (install_id, tenant_id, content, published_at) values (new.id, new.tenant_id, new.published_content, coalesce(new.published_at, now()));
    delete from sfx_theme_install_history where install_id = new.id and id not in
      (select id from sfx_theme_install_history where install_id = new.id order by published_at desc limit 20);
  end if;
  return new;
end $$;
drop trigger if exists sfx_theme_hist on sfx_theme_installs;
create trigger sfx_theme_hist after update of published_content on sfx_theme_installs for each row execute function sfx_theme_hist_trg();

create or replace function sfx_theme_history_list(p_install_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage');
begin
  if not exists (select 1 from sfx_theme_installs where id = p_install_id and tenant_id = tid) then raise exception 'Theme install not found'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'publishedAt', h.published_at,
      'sections', coalesce(jsonb_array_length(h.content->'sections'), 0)) order by h.published_at desc)
    from sfx_theme_install_history h where h.install_id = p_install_id and h.tenant_id = tid), '[]'::jsonb);
end $$;

-- Copies an older published version into the DRAFT. Nothing goes live until the owner publishes again.
create or replace function sfx_theme_rollback(p_install_id uuid, p_history_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); c jsonb;
begin
  select h.content into c from sfx_theme_install_history h where h.id = p_history_id and h.install_id = p_install_id and h.tenant_id = tid;
  if c is null then raise exception 'That version was not found'; end if;
  update sfx_theme_installs set draft_content = c where id = p_install_id and tenant_id = tid;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function sfx_theme_history_list(uuid) to app;
grant execute on function sfx_theme_rollback(uuid, uuid) to app;
