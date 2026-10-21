-- AUZsStyle (clothing and footwear shops) as a sellable product: a price row (set the real price in Admin -> Pricing; 0 = not priced
-- yet, so it is requested and quoted by hand) and auzsstyle.auzslab.in as a shared product address.
insert into product_prices (key, label) values ('style', 'AUZsStyle') on conflict (key) do update set label = 'AUZsStyle';

alter table tenants drop constraint if exists tenants_slug_not_reserved;
alter table tenants add constraint tenants_slug_not_reserved check (slug not in ('app','www','api','status','admin','mail','auth','login','start','go','auzspos','auzsmob','auzspay','auzsledger','auzsscan','auzsstyle','auzsqr','auzslab','hub','agents')) not valid;
alter table signup_requests drop constraint if exists signup_requests_slug_not_reserved;
alter table signup_requests add constraint signup_requests_slug_not_reserved check (slug not in ('app','www','api','status','admin','mail','auth','login','start','go','auzspos','auzsmob','auzspay','auzsledger','auzsscan','auzsstyle','auzsqr','auzslab','hub','agents')) not valid;
