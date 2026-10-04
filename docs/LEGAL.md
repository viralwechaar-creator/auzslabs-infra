# Privacy policy and terms: what they say, and what the owner must confirm

Updated 4 October 2026. These are well-structured drafts written for AUZslab's real behaviour and India's Digital
Personal Data Protection Act, 2023 (DPDP Act). **They are not legal advice and have not been reviewed by a lawyer.**
Have a lawyer or company secretary review them before real shops and real customers rely on them, and keep the
promises below true (a policy that says one thing while the software does another is worse than a short policy).

## The four pages

| Page | Audience | Where |
|---|---|---|
| `site/privacy.html` | AUZslab's visitors and account holders. AUZslab is the data fiduciary for those, and the data processor for each shop's business data. | auzslab.in/privacy.html |
| `site/terms.html` | The business that signs up (the agreement) | auzslab.in/terms.html |
| `app/public/privacy.html` | A shop's own customers. The shop is the data fiduciary and AUZslab its processor. Shop name, address and phone are filled in automatically from the shop's settings. | shopname.auzslab.in/privacy.html |
| `app/public/terms.html` | A shop's own customers (orders, bookings, repairs, buying and selling phones) | shopname.auzslab.in/terms.html |

## Things only the owner can supply or decide (fill in before relying on the pages)

1. **Legal entity.** The pages say "AUZslab" only. Once registered, add the legal name (for example "AUZslab Technologies
   Private Limited"), CIN or LLPIN or proprietorship name, and the registered address. The Privacy Policy says the postal
   address is "sent on request"; replace it with the real address (the IT Rules and the stores expect one).
2. **Named Grievance Officer.** Currently a role plus `helloauzslab@gmail.com` and +91 80056 73683. Add a person's name.
   A business email on your own domain (for example `privacy@auzslab.in`) is better than a Gmail address and looks more
   trustworthy to Razorpay, Apple and Google.
3. **GST.** Pricing and the cart add 18% GST. You can charge GST only if you are GST-registered. Put the GSTIN on invoices.
4. **Jurisdiction.** Terms section 14 says "the courts at the place of AUZslab's registered business". Name the city.
5. **Refund rules (Terms section 5).** These are conservative defaults: cancel any time, effective at the end of the paid
   period; no refund of fees already paid except by law or when we cannot provide the Service; setup fee non-refundable once
   work starts; report a wrong charge within 7 days; refunds paid within 7 working days. Change them if your policy differs.
   Razorpay and the stores require a refund policy to be published.
6. **Liability cap.** Kept as in the old terms (fees paid in the month before the event). A lawyer may advise a higher or
   different cap.

## Promises in the Privacy Policy that the software and the team must actually honour

- **Account deletion:** "personal data removed within 30 days". Today deletion is a *soft delete* (login blocked at once;
  a row is written to `account_deletions`) and a platform admin purges the data by hand. Someone must do that within 30 days,
  or the purge must be automated.
- **Business data after closure:** download available for 30 days, then deleted.
- **Backups:** the policy says deleted data can stay in backups "normally within six months". This matches the
  `BACKUP_KEEP_*` settings (7 daily, 4 weekly, 6 monthly). If you change retention, change the policy.
- **Response times:** acknowledge within 3 working days, reply to a privacy request within 7 days, complete within 30 days.
- **Logs:** security and audit logs kept at least 180 days (CERT-In directions).
- **Service providers named:** Resend (email), Razorpay (payments), Sentry (errors, US region), Backblaze (backups),
  Google and Apple (sign-in, fonts), an SMS provider, and the cloud host. If you add or switch a provider, update the list.
- **No advertising, no selling data, no AI training on customer data.** If this ever changes, update the policy first.

## Not covered here (separate pieces of work)

- A written **data processing agreement** between AUZslab and each shop (the Terms section 7 is the short version).
- Verifying the owner's email at signup and the other account-safety fixes (see CLAUDE.md "Real sign-in providers").
- Under the DPDP Act, a **consent record** for marketing messages a shop sends, and any rules on children's data, are the
  shop's responsibility; the shop notice and the AUZslab terms say so, but the software does not yet record consent.
- Trademark registration for AUZslab and AUZsMob, and a security review of the payroll and ID-proof data before real use.
