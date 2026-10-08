-- password_resets.token was stored in plaintext: the exact value mailed to the
-- person was also the row's primary key, readable straight off any DB dump or
-- backup. email_verifications (db/092) already does this the right way -- it
-- stores only a SHA-256 hash of the token, never the raw value. Mirror that
-- exactly here: the server now generates the raw token in Node
-- (randomBytes(32).toString('base64url'), same call already used for every
-- email_verifications token), mails it, and only ever stores/looks up its
-- SHA-256 hash.
--
-- These rows expire in 1 hour, so there is nothing meaningful to backfill --
-- any currently-outstanding reset link is simply expired here; whoever
-- requested it can ask again, same as if the hour had already passed.

update password_resets set expires_at = now() where used_at is null;

alter table password_resets add column if not exists token_hash text;
alter table password_resets drop constraint if exists password_resets_pkey;
alter table password_resets drop column if exists token;
alter table password_resets alter column token_hash set not null;
alter table password_resets add constraint password_resets_pkey primary key (token_hash);
