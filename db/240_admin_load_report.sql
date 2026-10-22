-- Admin -> System resources -> Product load: what each product costs the database. Read-only; platform admin only.
create or replace function admin_load_report() returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; slow jsonb := '[]'::jsonb;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if exists (select 1 from pg_extension where extname = 'pg_stat_statements') then
    begin
      execute $q$select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select calls, round(total_exec_time)::bigint as total_ms, round(mean_exec_time)::bigint as mean_ms, left(regexp_replace(query, '\s+', ' ', 'g'), 110) as q
        from pg_stat_statements where dbid = (select oid from pg_database where datname = current_database())
        order by total_exec_time desc limit 10) x$q$ into slow;
    exception when others then slow := '[]'::jsonb; end;
  end if;
  with t as (
    select s.relname, s.n_live_tup, s.n_dead_tup, s.seq_scan, s.seq_tup_read, pg_total_relation_size(s.relid) as sz,
      case when s.relname like 'sty\_%' then 'AUZsStyle' when s.relname like 'pay\_%' then 'AUZsPay'
        when s.relname like 'acc\_%' then 'AUZsLedger / AUZsScan' when s.relname like 'mob\_%' then 'AUZsMob'
        when s.relname in ('records', 'guest_orders', 'pos_audit', 'push_subs', 'fcm_tokens') then 'AUZsPOS and QR ordering'
        when s.relname like 'salon%' or s.relname = 'bookings' then 'Salon and bookings'
        when s.relname like 'wa\_%' then 'WhatsApp'
        else 'Platform (accounts, billing, other)' end as product
    from pg_stat_user_tables s)
  select jsonb_build_object(
    'db_size', pg_database_size(current_database()),
    'connections', (select count(*) from pg_stat_activity where datname = current_database()),
    'active', (select count(*) from pg_stat_activity where datname = current_database() and state = 'active' and pid <> pg_backend_pid()),
    'longest_query_s', (select coalesce(round(max(extract(epoch from now() - query_start))::numeric, 1), 0) from pg_stat_activity where datname = current_database() and state = 'active' and pid <> pg_backend_pid()),
    'cache_hit_pct', (select round(100 * sum(blks_hit)::numeric / nullif(sum(blks_hit) + sum(blks_read), 0), 1) from pg_stat_database where datname = current_database()),
    'products', (select coalesce(jsonb_agg(jsonb_build_object('product', product, 'tables', n, 'size', sz, 'rows', live, 'dead', dead, 'seq_read', sr) order by sz desc), '[]'::jsonb)
                 from (select product, count(*) n, sum(sz) sz, sum(n_live_tup) live, sum(n_dead_tup) dead, sum(seq_tup_read) sr from t group by product) q),
    'biggest', (select coalesce(jsonb_agg(jsonb_build_object('table', relname, 'size', sz, 'rows', n_live_tup) order by sz desc), '[]'::jsonb) from (select * from t order by sz desc limit 8) b),
    'bloat', (select coalesce(jsonb_agg(jsonb_build_object('table', relname, 'live', n_live_tup, 'dead', n_dead_tup) order by n_dead_tup desc), '[]'::jsonb) from (select * from t where n_live_tup > 5000 and n_dead_tup > 0.2 * n_live_tup order by n_dead_tup desc limit 6) b),
    'scan_heavy', (select coalesce(jsonb_agg(jsonb_build_object('table', relname, 'rows', n_live_tup, 'scans', seq_scan, 'read', seq_tup_read) order by seq_tup_read desc), '[]'::jsonb) from (select * from t where seq_scan > 2000 and n_live_tup > 20000 order by seq_tup_read desc limit 6) b),
    'slow', slow
  ) into r;
  return r;
end $$;
