-- =========================================================
-- The client dashboard's settings Save button (app/public/index.html,
-- both the "Business details" and "Website" cards -- they share the
-- same saveBtn) wrote its record with kind='set' instead of
-- kind='settings' -- a typo, never caught locally because cfg()
-- reads that row straight off R.settings by id, ignoring kind
-- entirely. But every server-side reader (public_menu, public_invoice,
-- 008's expense-report settings lookup) filters explicitly on
-- kind='settings', so any tenant who used Save since this shipped had
-- their business details/website content silently stop reaching the
-- public site, guest ordering and invoices, while the dashboard itself
-- still showed the edit as saved. Repairs any row already written
-- under the wrong kind; the client-side typo is fixed alongside this.
-- =========================================================

update records set kind = 'settings' where id = 'settings' and kind = 'set';
