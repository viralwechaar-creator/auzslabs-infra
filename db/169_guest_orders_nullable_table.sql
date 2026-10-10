-- =========================================================
-- Real, live-breaking bug: the QR-ordering takeaway fix (PR #346) made
-- site.html call place_order() with t=null for any visitor with no
-- table (a general link, or genuine takeaway) -- but guest_orders.tbl
-- was "text not null" since the very first migration (db/002), from
-- back when every guest order was assumed to be at a real table.
-- Every single takeaway order placed since that PR deployed has been
-- failing outright with "null value in column tbl violates not-null
-- constraint", surfaced to the customer as "Could not place the
-- order. Please try again or call our staff." -- confirmed by
-- reproducing it directly against a scratch database before writing
-- this fix (never guessed).
-- =========================================================

alter table guest_orders alter column tbl drop not null;
