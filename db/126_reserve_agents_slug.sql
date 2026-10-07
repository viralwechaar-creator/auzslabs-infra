-- agents.auzslab.in is the Agents Office (the owner's AI team dashboard, opened from the admin panel). A business must not be able to take that address.
alter table tenants drop constraint if exists tenants_slug_not_reserved;
alter table tenants add constraint tenants_slug_not_reserved check (slug not in ('app','www','api','status','admin','mail','auth','login','start','go','auzspos','auzsmob','auzspay','auzsledger','auzsqr','auzslab','hub','agents')) not valid;
alter table signup_requests drop constraint if exists signup_requests_slug_not_reserved;
alter table signup_requests add constraint signup_requests_slug_not_reserved check (slug not in ('app','www','api','status','admin','mail','auth','login','start','go','auzspos','auzsmob','auzspay','auzsledger','auzsqr','auzslab','hub','agents')) not valid;
