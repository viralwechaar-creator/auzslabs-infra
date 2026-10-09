-- AUZsScan offline-first: a sale, a new product or a stock receipt made with NO connection is kept on the phone and applied here
-- when the connection returns. acc_offline_apply() is idempotent on a client-made operation id: a phone that retries after a lost
-- reply never creates a second bill (the first result is returned with duplicate=true).
--   kind 'sale'    -> acc_save_document (post:true, with payments). The bill gets its real gapless number NOW, in the order the
--                     phones sync. A walk-in with a typed name/phone becomes (or finds) a customer. A sale that really happened
--                     is never refused for stock: stock may go below zero until the next stock count (see acc_stock_move below).
--   kind 'product' -> acc_save_product
--   kind 'stock'   -> acc_stock_adjust
-- Business refusals (period locked, no permission, unknown product) are raised as normal errors so the phone can show them.
create table if not exists acc_offline_ops (
  tenant_id uuid not null, op text not null, kind text not null, result jsonb not null, created_at timestamptz not null default now(),
  primary key (tenant_id, op)
);
alter table acc_offline_ops enable row level security;      -- no policies: only the function below touches it

-- acc_stock_move as in db/066, plus: a transaction-local switch (set only by acc_offline_apply for a sale) skips the "insufficient stock" refusal.
create or replace function acc_stock_move(tid uuid, pid uuid, wid uuid, d date, q numeric, cost numeric, k text, st text, sid uuid,
                               batch text default null, serial text default null, exp date default null, note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p acc_products; o acc_org; have numeric; wname text; elsewhere text;
begin
  if q = 0 then return; end if;
  select * into p from acc_products where id = pid and tenant_id = tid;
  if p.id is null then raise exception 'Unknown product'; end if;
  if q < 0 then
    select * into o from acc_org where tenant_id = tid;
    have := acc_stock_qty(tid, pid, wid);
    if have + q < 0 and not o.allow_negative_stock and coalesce(current_setting('acc.offline_sale', true), '') <> '1' then
      select name into wname from acc_warehouses where id = wid;
      select string_agg(w.name || ' ' || s.q::text, ', ' order by w.name) into elsewhere
        from (select warehouse_id, sum(qty) q from acc_stock_moves where tenant_id = tid and product_id = pid group by warehouse_id having sum(qty) > 0) s
        join acc_warehouses w on w.id = s.warehouse_id where s.warehouse_id <> wid;
      raise exception 'Insufficient stock for % in % (on hand %, needed %)%', p.name, coalesce(wname, 'this warehouse'), have, -q,
        case when elsewhere is not null then '. Stock is in: ' || elsewhere || ' - choose that warehouse on the invoice' else '' end using errcode = 'AC003';
    end if;
  end if;
  insert into acc_stock_moves (tenant_id, product_id, warehouse_id, move_date, qty, unit_cost, kind, source_type, source_id, batch_no, serial_no, expiry, note, created_by)
  values (tid, pid, wid, d, q, cost, k, st, sid, batch, serial, exp, note, app_uid());
end $$;

create or replace function acc_offline_apply(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid; v_op text := trim(coalesce(p->>'op', '')); v_kind text := p->>'kind'; pl jsonb := coalesce(p->'payload', '{}'::jsonb);
  prev jsonb; res jsonb; nm text; ph text; pid uuid; doc acc_documents;
begin
  if v_op = '' or length(v_op) > 64 then raise exception 'An operation id (op, up to 64 characters) is required.'; end if;
  if v_kind is null or v_kind not in ('sale', 'product', 'stock') then raise exception 'This kind of entry cannot be applied from an offline queue.'; end if;
  tid := acc_guard('acc_view');
  perform pg_advisory_xact_lock(hashtext(tid::text || v_op));
  select result into prev from acc_offline_ops where tenant_id = tid and acc_offline_ops.op = v_op;
  if prev is not null then return prev || jsonb_build_object('duplicate', true); end if;

  if v_kind = 'product' then
    res := acc_save_product(pl);
  elsif v_kind = 'stock' then
    res := acc_stock_adjust(pl);
  else
    -- a typed customer name (+ phone) becomes the party; failure to create it never blocks the sale (it stays a walk-in)
    nm := nullif(trim(coalesce(pl->>'party_name', '')), ''); ph := nullif(trim(coalesce(pl->>'party_phone', '')), '');
    if nullif(pl->>'party_id', '') is null and nm is not null then
      begin
        if ph is not null then
          select id into pid from acc_parties where tenant_id = tid and kind <> 'supplier' and active
            and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = right(regexp_replace(ph, '\D', '', 'g'), 10) and length(regexp_replace(ph, '\D', '', 'g')) >= 8 limit 1;
        end if;
        if pid is null then pid := (acc_save_party(jsonb_build_object('id', null, 'kind', 'customer', 'name', nm, 'phone', ph, 'reg_type', 'unregistered'))->>'id')::uuid; end if;
      exception when others then pid := null;
      end;
      if pid is not null then pl := pl || jsonb_build_object('party_id', pid); end if;
    end if;
    pl := (pl - 'party_name' - 'party_phone' - 'offline') || '{"post": true}'::jsonb;
    -- only a sale the phone says was made offline (offline=true) skips the stock refusal, and only inside this transaction
    if coalesce(p->'payload'->>'offline', '') = 'true' then perform set_config('acc.offline_sale', '1', true); end if;
    res := acc_save_document(pl);
    perform set_config('acc.offline_sale', '', true);
    if res ? 'id' then
      select * into doc from acc_documents where id = (res->>'id')::uuid and tenant_id = tid;
      update acc_documents set client_op = v_op, meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('offline_sale', coalesce(p->'payload'->>'offline', '') = 'true', 'offline_ref', pl->>'offline_ref') where id = doc.id;
      res := res || jsonb_build_object('number', doc.number, 'total', doc.total);
    end if;
  end if;

  insert into acc_offline_ops (tenant_id, op, kind, result) values (tid, v_op, v_kind, coalesce(res, '{}'::jsonb));
  return coalesce(res, '{}'::jsonb) || jsonb_build_object('duplicate', false);
end $$;
