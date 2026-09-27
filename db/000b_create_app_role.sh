#!/bin/sh
# The Docker postgres image always makes POSTGRES_USER a superuser --
# and a superuser (or the owner of a table, which POSTGRES_USER also is,
# since it's the role that runs every file in this directory) BYPASSES
# every RLS policy in this schema silently, regardless of what the
# policy says. Confirmed by hand against a real Postgres 16 while
# writing this migration: the exact same queries that correctly return
# zero rows with no app.uid set returned all rows when run as the
# superuser instead.
#
# So the API server must NEVER connect using POSTGRES_USER/PASSWORD.
# This ordinary, non-superuser role -- created here, granted access in
# 999_app_grants.sql -- is what it actually uses.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  do \$\$
  begin
    if not exists (select from pg_roles where rolname = 'app') then
      create role app login password '$POSTGRES_APP_PASSWORD';
    end if;
  end
  \$\$;
EOSQL
