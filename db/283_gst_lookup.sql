-- GST lookup (AUZsLedger / AUZsScan): cache of taxpayer details and a usage log for the daily cap.
-- Server-only tables (no RLS, reached only by server/src/gst.js). Explicit grants: see db/094.
create table if not exists gst_lookup_cache (
  gstin text primary key,
  data jsonb not null,
  fetched_at timestamptz not null default now()
);
create table if not exists gst_lookup_log (
  id bigserial primary key,
  tenant_id uuid,
  user_id uuid,
  gstin text,
  cached boolean not null default false,
  ok boolean not null default true,
  at timestamptz not null default now()
);
create index if not exists gst_lookup_log_tenant_at on gst_lookup_log (tenant_id, at);
grant select, insert, update, delete on gst_lookup_cache, gst_lookup_log to app;
grant usage, select on sequence gst_lookup_log_id_seq to app;

-- Who may look up: a signed-in person with AUZsLedger/AUZsScan sales rights or AUZsFinance write rights.
-- Returns the tenant id, or null. Server-only (not in the RPC list).
create or replace function gst_lookup_allowed() returns uuid language plpgsql stable security definer set search_path = public as $$
declare t uuid;
begin
  begin t := acc_guard('acc_sales'); exception when others then t := null; end;
  if t is null then
    begin t := fin_guard('write'); exception when others then t := null; end;
  end if;
  return t;
end $$;
