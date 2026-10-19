-- History tables must survive deleting a login. The permanent-delete tools switch foreign-key checks
-- off, so audit rows were left pointing at deleted logins and a backup restore failed on them
-- ("admin_audit_admin_id_fkey"). Dropping the links keeps the history and lets a backup restore.
-- Deletes no data. Safe to run more than once.
alter table admin_audit drop constraint if exists admin_audit_admin_id_fkey;
alter table client_payments drop constraint if exists client_payments_recorded_by_fkey;
