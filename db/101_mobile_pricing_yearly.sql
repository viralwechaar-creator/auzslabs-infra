-- AUZsMob pricing: Rs 199 a month, no GST, no setup fee. Yearly Rs 1,999 (first year, no GST); from year two Rs 1,599 a year.
-- The cart and the server read these per-product flags so the rule lives in data, not scattered through code.
alter table product_prices
  add column if not exists gst_exempt boolean not null default false,
  add column if not exists setup_fee_exempt boolean not null default false,
  add column if not exists yearly_price numeric(10,2) not null default 0,
  add column if not exists renewal_yearly_price numeric(10,2) not null default 0;

update product_prices
   set monthly_price = 199, yearly_price = 1999, renewal_yearly_price = 1599, gst_exempt = true, setup_fee_exempt = true
 where key = 'mobile';

alter table payments add column if not exists period text not null default 'month' check (period in ('month', 'year'));

create or replace function public_product_prices()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'key', key, 'label', label, 'monthly_price', monthly_price,
      'yearly_price', yearly_price, 'renewal_yearly_price', renewal_yearly_price,
      'gst_exempt', gst_exempt, 'setup_fee_exempt', setup_fee_exempt) order by key), '[]'::jsonb)
  from product_prices;
$$;
