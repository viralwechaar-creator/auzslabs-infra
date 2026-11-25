-- Adding a staff document failed with a server error: db/369 added a second version of sos_document_create (with a category)
-- next to db/364's one-argument version, so the database could not tell them apart. Keep only the two-argument one.
-- Rollback: recreate the one-argument function from db/364.
drop function if exists sos_document_create(text);
