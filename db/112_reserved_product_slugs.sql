-- auzspos / auzsmob / auzspay / auzsledger.auzslab.in are shared product addresses (like app.auzslab.in), so no business may
-- take those names (or auzsqr / auzslab / hub). Replaces the list from db/111. NOT VALID: existing rows are left alone.
alter table tenants drop constraint if exists tenants_slug_not_reserved;
alter table tenants add constraint tenants_slug_not_reserved check (slug not in ('app','www','api','status','admin','mail','auth','login','start','go','auzspos','auzsmob','auzspay','auzsledger','auzsqr','auzslab','hub')) not valid;
alter table signup_requests drop constraint if exists signup_requests_slug_not_reserved;
alter table signup_requests add constraint signup_requests_slug_not_reserved check (slug not in ('app','www','api','status','admin','mail','auth','login','start','go','auzspos','auzsmob','auzspay','auzsledger','auzsqr','auzslab','hub')) not valid;
