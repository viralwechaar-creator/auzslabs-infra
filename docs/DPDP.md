# DPDP Act 2023: how AUZslab handles it (internal, not published)

Not legal advice. The Act and its Rules are phased in; a lawyer must confirm the dates and wording before launch.

## Who is who
- **AUZslab = Data Fiduciary** for its own users: owners and managers (sign-in, profile, billing, devices, support).
- **A client business = Data Fiduciary** for its own customers, staff and payroll records; **AUZslab = Data Processor** for those.
  Clients should be told in their contract/terms that they are responsible for their own customers' consent.

## What the software does
- **Notice + consent at sign-up** (`site/signup.html`): a required, unticked box (Privacy policy + Terms, to run the account) and a separate optional box (product updates). Google/Apple sign-in is blocked until the first is ticked. The choice is stored against the new account right after sign-in (`record_my_consent`, called by `site/signin.html` for Google, by `signup.html` for Apple).
- **Re-consent when the policy changes:** `platform_flags.privacy_version` (now `2026-10`, same as "Last updated" on `site/privacy.html`). To publish a new policy: edit `privacy.html`, then `update platform_flags set value = '2026-11' where key = 'privacy_version';`. Every signed-in person sees a banner on their account page until they agree again.
- **Account -> Privacy & my data** (`site/account.html`): consent status, optional-updates switch, ask to stop processing, **Download my data** (`my_personal_data`: login, profile, sign-in methods, businesses, devices, consents, requests; never password/PIN hashes or tokens), and **requests** (see, correct, delete, nominee, complaint, other). Owners' business records come from "Your data -> Backup".
- **Deleting an account:** `site/delete-account.html` (immediate, soft delete, data purge within 30 days by a human: see `account_deletions`). Consents and requests are removed with the account.
- **Admin -> Privacy requests** (`site/admin.html`): the queue, newest overdue first; **Acknowledge** within 2 days, **Reply & done** or **Decline** (reply required) within 30 days. Every action is written to the admin audit log. The badge shows how many are open. Nobody is emailed automatically: **check this screen daily**.
- Data export for a business owner: `my_data_export` (every app's Backup). Erase a whole business: admin -> Clients -> Delete (typed name) or the owner's Clear.

## Answering a request (steps)
1. Open admin -> Privacy requests, press **Acknowledge** (this starts the "answered within 2 days" clock being met).
2. Check who is asking: the person's login email is shown. Reply only to that login's email.
3. **See my data:** the person can already download it; if they ask you, press Reply & done and tell them where (Account -> Privacy & my data).
4. **Correct:** change it (profile in admin -> Users, or ask them to edit My profile), then reply.
5. **Delete:** if they own a business, explain that the business data goes with the business; delete the user (admin -> Users -> Delete permanently) or the client (admin -> Clients -> Delete). Billing and tax records must be kept for the legal period (commonly 8 years). Reply what was deleted and what was kept and why.
6. **Withdraw / stop processing:** same as delete for the account; for optional updates the switch already works.
7. **Nominee / complaint / other:** write down the answer in the reply. A complaint not settled in 30 days can go to the Data Protection Board.

## Personal data breach: what to do
Breach = anyone unauthorised may have seen, changed or lost personal data (leaked database or backup, stolen admin login, wrong tenant data shown).
1. **Contain (first hour):** sign out all sessions of the affected account (admin -> Users -> sign out everywhere), disable the account, rotate the API secrets (`SESSION_SECRET`, database password, provider keys), take the affected service offline if needed.
2. **Write down** time found, what data, how many people and businesses, how it happened, what was done. Keep server logs and the admin audit log.
3. **Tell the affected people** without delay: plain words, what happened, what data, what they should do, who to contact (the grievance officer in the Privacy policy).
4. **Tell the Data Protection Board of India**: intimation without delay, and a fuller report within 72 hours (confirm the exact current rule with a lawyer). Tell affected client businesses too: they are fiduciaries for their customers.
5. **Fix and prevent:** root cause, a test that would have caught it, then note it in CLAUDE.md.
Keep a breach register (date, summary, who was told, when).

## Retention
Active accounts: kept while the account is active. Deleted accounts: removed within 30 days except billing/tax records (law). Backups age out within a few weeks after that. Sessions older than 30 days, phone codes and expired links are cleaned daily (`server/src/maintenance.js`).

## Not built
Automatic email to the person when a request is acknowledged or answered (they see the reply under Account -> Privacy & my data); a separate parental-consent flow (AUZslab is for businesses, 18+); a consent-manager integration; per-business consent capture for a client's own customers (a client's job).
