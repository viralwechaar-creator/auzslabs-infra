-- app.auzslab.in is the one shared address for every app (no business is chosen by the address), so a business must never
-- be given a name that is a system address. NOT VALID: existing rows are left alone, every new or changed row is checked.
alter table tenants drop constraint if exists tenants_slug_not_reserved;
alter table tenants add constraint tenants_slug_not_reserved check (slug not in ('app','www','api','status','admin','mail','auth','login','start','go')) not valid;
alter table signup_requests drop constraint if exists signup_requests_slug_not_reserved;
alter table signup_requests add constraint signup_requests_slug_not_reserved check (slug not in ('app','www','api','status','admin','mail','auth','login','start','go')) not valid;
