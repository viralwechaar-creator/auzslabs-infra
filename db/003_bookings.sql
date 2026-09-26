-- =========================================================
-- bookings: the one concept worth a real table instead of a
-- generic `records` row — a salon appointment, a gym class
-- slot, a cafe table reservation. Slot-conflict checking needs
-- actual date/time columns, unlike everything in 002_core_engine.
-- =========================================================

create table bookings (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  resource_id     text,   -- matches a records.id where kind='resource' (a stylist/table/trainer) — no hard FK, stays loose like everything in 002
  customer_name   text not null,
  customer_phone  text not null,
  date            date not null,
  time            time,
  status          text not null default 'pending'
                  check (status in ('pending', 'confirmed', 'completed', 'cancelled')),
  items           jsonb not null default '[]',   -- snapshot of chosen catalog items (kind='item' records) at booking time
  total           numeric(10,2) not null default 0,
  created_at      timestamptz not null default now()
);

create index idx_bookings_tenant_id on bookings (tenant_id);
alter table bookings enable row level security;
create policy tenant_isolation on bookings
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));
