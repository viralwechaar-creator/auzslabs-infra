-- Daily health check that tells the platform admin (an in-app notice + push) when something needs attention, before a client notices.
-- p_api carries what only the API process knows: {"lag_ms":..,"rss_mb":..,"error_pct":..,"p95_ms":..}. One notice per day at most.
create or replace function health_alert_run(p_api jsonb default '{}'::jsonb) returns int language plpgsql security definer set search_path = public as $$
declare msgs text[] := '{}'; conns int; hit numeric; r record; n int;
begin
  if exists (select 1 from notifications where type = 'health' and created_at > now() - interval '20 hours') then return 0; end if;
  select count(*) into conns from pg_stat_activity where datname = current_database();
  if conns >= 21 then msgs := msgs || ('database connections are high (' || conns || ' of 35)'); end if;
  select round(100 * sum(blks_hit)::numeric / nullif(sum(blks_hit) + sum(blks_read), 0), 1) into hit from pg_stat_database where datname = current_database();
  if hit is not null and hit < 95 then msgs := msgs || ('the database is reading from disk too often (' || hit || '% from memory)'); end if;
  for r in select relname, n_live_tup, n_dead_tup from pg_stat_user_tables where n_live_tup > 5000 and n_dead_tup > 0.3 * n_live_tup order by n_dead_tup desc limit 3 loop
    msgs := msgs || ('table ' || r.relname || ' needs tidying (' || r.n_dead_tup || ' dead rows)');
  end loop;
  if coalesce((p_api->>'lag_ms')::numeric, 0) > 200 then msgs := msgs || ('the API is sometimes delayed ' || (p_api->>'lag_ms') || ' ms'); end if;
  if coalesce((p_api->>'rss_mb')::numeric, 0) > 1500 then msgs := msgs || ('the API is using ' || (p_api->>'rss_mb') || ' MB of memory'); end if;
  if coalesce((p_api->>'error_pct')::numeric, 0) > 2 then msgs := msgs || ('server errors are at ' || (p_api->>'error_pct') || '% of requests'); end if;
  if coalesce((p_api->>'p95_ms')::numeric, 0) > 1500 then msgs := msgs || ('the slowest 5% of requests take over ' || (p_api->>'p95_ms') || ' ms'); end if;
  n := coalesce(array_length(msgs, 1), 0);
  if n > 0 then
    insert into notifications (tenant_id, type, title, body) values (null, 'health', 'Server health: needs a look', array_to_string(msgs, '; ') || '. Open Admin, System resources.');
  end if;
  return n;
end $$;
