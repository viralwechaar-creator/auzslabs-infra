-- Runs last (highest filename sort order). Grants the ordinary "app"
-- role (created in 000b_create_app_role.sh) exactly the access the API
-- server needs, on everything defined by every migration before this
-- one -- table/function ownership stays with POSTGRES_USER, so RLS
-- actually applies to this role (see 000b for why that distinction
-- matters).
grant select, insert, update, delete on all tables in schema public to app;
grant execute on all functions in schema public to app;
grant usage, select on all sequences in schema public to app;
