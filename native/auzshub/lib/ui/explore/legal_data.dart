/// Verbatim legal copy, extracted straight from the website's HTML (`site/terms.html`,
/// `site/privacy.html`, `site/refund.html`, `site/cookies.html`, `site/security.html`,
/// `site/acceptable-use.html`, `site/ip-custom-development.html`, `site/hardware-terms.html`,
/// `site/delete-account.html`). The `data-co` placeholders (company name, address, GSTIN,
/// grievance officer, phone, court) are already substituted with the real values the website's
/// own `company.js` fills in at runtime, so this matches what a visitor actually reads, not the
/// raw template. Keep this file verbatim: change it only by re-copying the matching site page
/// word for word, never by paraphrasing.
///
/// A [LSec] is one numbered/titled clause; its body is an ordered list of [LB] blocks, each
/// either a paragraph ([LB.p]) or a bullet list ([LB.ul]).
class LSec {
  const LSec(this.heading, this.blocks);
  final String heading;
  final List<LB> blocks;
}

class LB {
  const LB.p(String text)
      : para = text,
        items = null;
  const LB.ul(List<String> list)
      : para = null,
        items = list;
  final String? para;
  final List<String>? items;
}

final List<LSec> termsSections = [
  LSec('1. Who we are and what this covers', [
    LB.p('These terms are an agreement between you and Mahendra, trading as AUZslab (sole proprietorship) (“AUZslab”, “we”, “us”). They cover your use of the AUZslab website (auzslab.in), our web and mobile apps (POS, Payroll, Accounting, AUZsMob, Salon, Website Builder, QR ordering and any module we add) and the services around them. Address: 3/21 DDP Nagar, Madhuban, Jodhpur 342005, Rajasthan. GSTIN: 08KALPM2374C1ZH. Contact: helloauzslab@gmail.com.'),
    LB.p('By creating an account, paying, or using the software you agree to these terms and to our Privacy Policy and Refund & Cancellation Policy. If you sign up for a business, you confirm you are allowed to bind that business.'),
  ]),
  LSec('2. Your account', [
    LB.ul(['You must be 18 or older and able to enter a contract in India.', 'Sign-up is with Google. Existing accounts may also use email and password. Staff you add use a username and PIN that the owner controls.', 'You are responsible for everything done through your account and your staff\'s logins. Keep PINs and passwords private, and turn off a staff login when someone leaves.', 'Give us correct information. We may suspend an account that is false, shared in a way that breaks these terms, or used for fraud.']),
  ]),
  LSec('3. The service', [
    LB.p('AUZslab provides business software that runs on our servers and is used through a browser or app. We keep it running, fix problems and improve it. Features differ by plan. We may add, change or retire features; if we remove something you pay for in a way that matters, we will tell you first and you can cancel.'),
    LB.p('Accounting and Payroll are tools, not professional advice. Tax, GST, PF, ESI, professional tax and other statutory rates and rules change. We keep our settings up to date as best we can, but you (or your accountant) are responsible for checking every figure, return and payment before you rely on it or file it.'),
  ]),
  LSec('4. Plans, prices and payment', [
    LB.ul(['Prices are the ones shown on our pricing page when you buy. GST at 18% is added to the subscription and shown in your bill before you pay, for every product except AUZsMob, which is priced without GST and without a setup fee.', 'A new business account has a one-time setup fee of ₹2,190 (no GST), shown in your bill before you pay. It covers account setup, your business profile and initial users. Extensive data migration and custom development are quoted and charged separately.', 'A bug is always fixed free of charge. A small post-setup change (a label, a field, a setting) is a flat ₹500 (no GST) per request. Anything bigger — a new report, screen or workflow — is custom development, quoted and agreed with you first.', 'You can pay by card, UPI or net banking through our payment partner, or by UPI or bank transfer to us. If you pay manually, your account is switched on when we have matched your payment.', 'Subscriptions renew automatically at the end of each billing period. If a renewal charge fails, our payment partner retries it automatically first; we only contact you directly if those retries don\'t succeed. Your account is never automatically suspended just because one renewal attempt failed.', 'We may change prices for the next billing period with at least 30 days\' notice.']),
  ]),
  LSec('5. Cancelling and refunds', [
    LB.p('You can cancel any time by contacting us — there\'s no minimum term and cancellation takes effect as soon as we process your request. What (if anything) is refunded depends on when you cancel; the full rules are in our Refund & Cancellation Policy, which forms part of these terms.'),
  ]),
  LSec('6. Your data', [
    LB.ul(['The business data you and your staff enter (orders, customers, stock, staff and payroll records, documents) belongs to you.', 'You give us permission to store and process it only to run the service for you, to keep it secure and backed up, and as the law requires.', 'We do not sell your data or use it for advertising. See the Privacy Policy.', 'You are responsible for having the right to enter other people\'s information (for example your customers\' and employees\' details) and for using it lawfully.', 'You can export your data from the apps, and you can ask us to delete your account at any time (see Delete your account).']),
  ]),
  LSec('7. What you must not do', [
    LB.ul(['Use AUZslab for anything illegal, to process payments you are not authorised to take, or to send spam.', 'Try to break, overload, probe or get around the security of the service, or access another business\'s data.', 'Copy, scrape, reverse-engineer or extract the software, design or data, or use the demo accounts to build or sell a competing product.', 'Resell or share your subscription with another business without our written agreement.']),
  ]),
  LSec('8. Pausing, ending and deletion', [
    LB.ul(['Either of us may end the arrangement with notice. We may suspend or end an account straight away for serious misuse, or for non-payment after notice.', 'If an account is paused or ends, your data stays safe for 30 days so you can renew or export it. After that we delete it, except records we must keep by law (for example billing records).', 'If you delete your account yourself, we handle it as described in the Privacy Policy.']),
  ]),
  LSec('9. Availability and support', [
    LB.p('We work to keep the service running all day, but we cannot promise it will never be interrupted. Maintenance, internet or provider outages, and events outside our control can cause downtime. Support is by email and WhatsApp during normal business hours. Keep your own copy of anything critical (the apps have export and backup tools).'),
  ]),
  LSec('10. Third-party services', [
    LB.p('The service relies on providers such as Google (sign-in and website analytics on our marketing site), Razorpay (payments), our server and backup providers, and an email provider. Their own terms apply to their part. We are not responsible for a third party\'s outage or change, but we will work to keep your service running.'),
  ]),
  LSec('11. Our rights in the software', [
    LB.p('AUZslab, its design, the software and its logos belong to us. You get a non-exclusive right to use the service for your own business while your plan is active. The data you put in stays yours.'),
  ]),
  LSec('12. Limits on our responsibility', [
    LB.p('To the extent the law allows: we are not liable for indirect or consequential loss (such as lost sales or profit, or loss caused by incorrect tax or payroll figures you did not check). Our total liability for any claim is limited to the fees you paid us in the 3 months before the claim. Nothing here limits liability that cannot legally be limited.'),
  ]),
  LSec('13. Disputes and governing law', [
    LB.p('These terms are governed by the laws of India. If we cannot settle a problem by talking, the courts at Jodhpur, Rajasthan will have jurisdiction. Write to us first at helloauzslab@gmail.com and we will try to resolve it within 30 days.'),
  ]),
  LSec('14. Changes to these terms', [
    LB.p('We may update these terms. For anything that matters to you we will give notice (by email or in the app) before it takes effect. Using the service after the change means you accept it. Questions: helloauzslab@gmail.com.'),
  ]),
  LSec('15. More terms that apply to every plan', [
    LB.ul(['Updates. We release fixes, security updates, improvements and new features from time to time. They can change how parts of the software look or work.', 'Customisation. Basic setup is part of the plan. New modules, special workflows, custom reports, integrations (such as WhatsApp automation or Zomato and Swiggy orders) or large design changes are quoted and charged separately. Fees charged by other companies for those services are not part of our price.', 'Custom projects. Ownership and licence of a custom project are set in its own agreement. Unless it says otherwise in writing, we keep ownership of our existing software, frameworks and reusable parts.', 'Internet and equipment. You are responsible for internet, phones, computers, printers, scanners and other equipment, unless we supply them under a separate agreement.', 'Tax and accounting tools. The software helps you keep records and prepare tax figures (such as GST). It is not tax, accounting or legal advice. You remain responsible for the accuracy of your records and for your filings.', 'Security and sharing. We use reasonable technical measures to protect accounts and data. You keep passwords and PINs private, manage who on your team has access, report any suspected misuse quickly, and do not share one login between people or locations beyond what your plan allows. More users or outlets may need a higher plan.']),
  ]),
];

final List<LSec> privacySections = [
  LSec('1. Who we are', [
    LB.p('Mahendra, trading as AUZslab (sole proprietorship) (“AUZslab”) is the data fiduciary for the personal data described here, under India\'s Digital Personal Data Protection Act, 2023 and the Information Technology Act, 2000. Address: 3/21 DDP Nagar, Madhuban, Jodhpur 342005, Rajasthan. GSTIN: 08KALPM2374C1ZH. When a business uses our apps to store its own customers\' and employees\' details, that business decides what is stored and we process it on its behalf.'),
  ]),
  LSec('2. What we collect', [
    LB.ul(['Account details: your name, email address, phone number and the business name you give us. If you sign in with Google we receive your name, email address and Google account identifier (never your Google password).', 'Business data you enter: products and prices, orders and bills, customers, stock, expenses, staff and payroll records (such as attendance, salary and bank details a business chooses to store), accounting documents, bookings and uploaded files such as logos and photos.', 'Staff logins: a username and a PIN, stored only as a one-way hash. We never store a PIN or password in readable form.', 'Payments: the amount, date, order number and the UPI reference or payment id. Card, UPI and bank details are handled by our payment partner; we do not see or store card numbers.', 'Device and usage data: IP address, browser and device type, sign-in times and the technical details of errors, used for security and to fix problems.', 'Location (optional): if a business turns on location-checked clock-in in Payroll, the staff member\'s device location is read when they clock in or out and stored with that attendance record. We do not track location at other times.', 'Cookies and local storage: a sign-in token and small settings (like your language or theme) on your device.', 'Website analytics: on our public marketing website only (not inside the POS, Payroll, Accounting or other business apps), Google Analytics (GA4) collects pages viewed, approximate location and device/browser type, and how you arrived at the site, to help us understand and improve it. We do not use advertising or retargeting trackers, and we don\'t sell this data.']),
  ]),
  LSec('3. Why we use it', [
    LB.ul(['To create and run your account and the apps you pay for.', 'To take payments, keep billing records and send receipts and renewal reminders.', 'To keep the service secure, stop misuse and fix errors.', 'To answer your questions and give support.', 'To meet legal duties (tax, accounting, responding to lawful requests).']),
    LB.p('We use your data with your consent and for these purposes only. We do not sell it, rent it, or use it for advertising or to train AI models.'),
  ]),
  LSec('4. Who we share it with', [
    LB.p('Only the service providers we need to run AUZslab, each limited to its job:'),
    LB.ul(['Server and backup providers that host the apps and keep encrypted copies of the database.', 'Google for sign-in, and Google Analytics for website traffic (marketing website visits only).', 'Razorpay (and your bank or UPI app) for payments.', 'An email provider (our email provider) to send sign-in, receipt and reminder emails.', 'An error-monitoring provider (an error-monitoring provider) that receives technical error details.', 'Authorities where the law requires it.']),
    LB.p('Some providers may store data outside India. We choose providers with reasonable security and use them only for the purposes above.'),
  ]),
  LSec('5. How long we keep it', [
    LB.ul(['While your account is active.', 'If an account ends or you delete it, we delete or anonymise your data within 30 days, except records we must keep by law, such as billing and tax records (kept for as long as the law requires, commonly up to 8 years).', 'Encrypted backups are replaced on a regular cycle, so deleted data leaves backups within a few weeks after that.']),
  ]),
  LSec('6. How we protect it', [
    LB.ul(['All traffic uses HTTPS. Passwords and PINs are stored as one-way hashes.', 'Each business\'s data is separated from every other business\'s, and staff only see what their role allows.', 'Sign-ins can be revoked per device, and we keep an audit trail of important actions.', 'We monitor the service, keep nightly backups, and test that backups can be restored.']),
    LB.p('No system is perfectly secure. If a breach affects your data we will tell you and the authorities as the law requires.'),
  ]),
  LSec('7. Your rights', [
    LB.p('You can ask us to show you the personal data we hold about you, correct it, delete it, or stop processing it where the law allows. You can withdraw consent and nominate someone to exercise these rights for you. You can do most of this yourself, signed in, under Account, Privacy & my data: download your personal data, change your email-updates choice, and send us a request. To delete your account yourself, see Delete your account. For anything else, email helloauzslab@gmail.com and we will reply within 30 days. If you are not satisfied you may complain to the Data Protection Board of India.'),
  ]),
  LSec('8. Children', [
    LB.p('AUZslab is for businesses and is not meant for anyone under 18. We do not knowingly collect children\'s data.'),
  ]),
  LSec('9. Grievance officer', [
    LB.p('Name: Mahendra. Email: helloauzslab@gmail.com. Phone: +91 9251250829. Write to us with any complaint about how your data is handled and we will acknowledge it within 48 hours and resolve it within 30 days.'),
  ]),
  LSec('10. Changes to this policy', [
    LB.p('We may update this policy. For changes that matter we will notify you by email or in the app before they apply. The date at the top shows the latest version.'),
  ]),
];

final List<LSec> refundSections = [
  LSec('1. Plain summary', [
    LB.ul(['There is no lock-in. You can cancel any time by contacting us, and cancellation takes effect as soon as we process it — no notice period.', 'Before your account setup is finished: full refund of what you paid, minus a 1% transaction processing fee.', 'Monthly plan, after setup is complete: no refund of fees already paid. You can still cancel to stop future billing.', 'Yearly plan, after setup is complete: 20% of what you paid is refunded if you cancel within 6 months of starting; no refund if you cancel after 6 months.', 'A bug is always fixed free — that\'s never a refund situation. We also refund money taken by mistake (charged twice, wrong amount) in full.']),
  ]),
  LSec('2. Cancelling', [
    LB.ul(['Tell us by email at helloauzslab@gmail.com from the email on your account — there\'s no self-service cancel button in the apps yet.', 'Cancellation is immediate: there\'s no notice period to give, and we don\'t charge any extra fee just for cancelling.', 'Auto-renewal: if a renewal charge fails, our payment partner automatically retries it first. We only contact you directly if those retries don\'t succeed, and your account is never auto-suspended purely because one attempt failed.']),
  ]),
  LSec('3. Refunds', [
    LB.ul(['Before setup is complete: full refund minus a 1% transaction fee.', 'Monthly, after setup: no refund of fees already paid; billing simply stops when you cancel.', 'Yearly, after setup: 20% refund if cancelled within 6 months of starting; 0% after 6 months.', 'Setup fee (₹2,190): not refundable once setup work has begun, except as part of the full "before setup" refund above.', 'The ₹500 small-modification fee: not refundable once the change has been made — it\'s a service already delivered. Bug fixes are always free and never charged.', 'If we fail: if the service can\'t be used because of a problem on our side that we can\'t fix, we refund the fees for the period we couldn\'t provide it.', 'Charged twice or by mistake: we refund the extra amount in full.', 'Free demo accounts are free: no payment, no refund.']),
  ]),
  LSec('4. How refunds are paid', [
    LB.p('Approved refunds are returned to the same method you paid with (Razorpay refunds reach your bank in about 5 to 7 working days; UPI and bank transfers are returned to the account that paid). We process approved refunds within 7 working days.'),
  ]),
  LSec('5. How to ask', [
    LB.p('Email helloauzslab@gmail.com with the business name, the date and amount of the payment, and your payment reference. We reply within 2 working days.'),
    LB.p('Related: Terms & conditions and Privacy policy.'),
  ]),
];

final List<LSec> cookiesSections = [
  LSec('1. What we use', [
    LB.ul(['Essential session cookie: keeps you signed in. You can\'t disable it and still stay logged in — it\'s required for the service to work.', 'Google Analytics (GA4): on our public marketing website (not inside the business apps like the POS, Payroll or Accounting), to see which pages visitors read, roughly where they\'re browsing from, and how they found us. It does not identify you by name; see Privacy Policy §4 for what Google itself does with this data.']),
  ]),
  LSec('2. What we don\'t use', [
    LB.p('We don\'t run advertising or retargeting cookies, and we don\'t sell or share this data for marketing. Google Analytics is used for our own website traffic only.'),
  ]),
  LSec('3. If that changes', [
    LB.p('If we add advertising cookies or anything beyond basic traffic analytics in future, we\'ll update this policy first and add any consent mechanism required by law before switching it on.'),
  ]),
];

final List<LSec> securitySections = [
  LSec('1. What we do today', [
    LB.ul(['All traffic between you and AUZslab is encrypted (HTTPS).', 'Passwords are hashed, never stored in plain text; staff PIN logins are protected the same way.', 'Two-factor authentication is available for owner and manager accounts.', 'Access to your business data is restricted by role (owner, manager, staff) within your own account, and every business\'s data is kept separate from every other business\'s.', 'Rate-limiting and account-lockout protections guard against automated attacks on logins.', 'You can sign out a single lost or stolen device without changing your password.', 'We take regular backups and are investing in off-site backup and server failover infrastructure.', 'We monitor for errors and security issues using an error-monitoring service.']),
  ]),
  LSec('2. What we don\'t claim', [
    LB.p('No system is 100% secure, and we don\'t claim ISO or SOC-style certification. We are not liable for a security incident caused by your own password or device practices, a lost staff login, or a third-party service outage beyond our reasonable control.'),
  ]),
  LSec('3. If you find a vulnerability', [
    LB.p('Please report it to us at helloauzslab@gmail.com rather than exploiting or publicly disclosing it — we\'ll work with you to fix it. See also our Privacy Policy and Terms & conditions.'),
  ]),
];

final List<LSec> acceptableUseSections = [
  LSec('1. You agree not to', [
    LB.ul(['Break any applicable law, including tax, consumer-protection or data-protection law.', 'Defraud AUZslab, your own customers, or anyone else (for example fake refunds or manipulated invoices to evade tax).', 'Attempt to access another business\'s data, bypass access controls, or probe or attack our systems.', 'Resell, sublicense, or share your account access with a business other than your own without our written consent.', 'Upload content that is unlawful, defamatory, or infringes someone else\'s intellectual property.', 'Give a staff login more access than their actual role should have, to get around approval controls.', 'Interfere with the service\'s normal operation, such as automated scraping or excessive API calls outside normal use.']),
  ]),
  LSec('2. What happens if you don\'t follow this', [
    LB.p('We may investigate suspected violations and take action under our Terms & conditions, including suspension or termination, and we will cooperate with law enforcement where legally required.'),
  ]),
];

final List<LSec> ipCustomDevSections = [
  LSec('1. The platform', [
    LB.p('AUZslab — the software, platform, brand, logos and underlying code — is and remains our intellectual property. Using the service gives you a licence to use it for your business, not ownership of it.'),
  ]),
  LSec('2. Your data', [
    LB.p('You own the business data you put into AUZslab (sales, menu, customers, bookings and so on) and can export or delete it as described in our Privacy Policy and Terms & conditions.'),
  ]),
  LSec('3. Custom-built projects', [
    LB.p('Where we build something specifically for you — a bespoke website, a custom integration, a one-off feature — that work remains our intellectual property, licensed to you for your own use, unless a separate written agreement for that specific project says you\'re buying the IP outright. This lets us reuse general techniques and components across clients while you still get full use of what was built for you.'),
  ]),
  LSec('4. Each custom project gets its own written agreement', [
    LB.ul(['What\'s being built (scope).', 'Price and payment milestones.', 'Timeline.', 'Who owns what (defaults to section 3 above unless stated otherwise).', 'What happens if the scope changes after work starts (a change request is quoted and agreed before extra work begins).']),
    LB.p('This protects both sides — you know exactly what you\'re paying for and when, and we\'re not stuck absorbing unlimited scope creep under a vague general clause.'),
  ]),
  LSec('5. Small modifications', [
    LB.p('A small post-setup change (a label, a field, a setting) is a flat ₹500 fee, no separate written agreement needed — see our Terms & conditions. Anything bigger is custom development under section 4 above.'),
  ]),
];

final List<LSec> hardwareTermsSections = [
  LSec('1. We don\'t sell or ship hardware', [
    LB.p('AUZslab doesn\'t stock, sell or ship hardware (scanners, printers, tablets, token displays) as a product line. We don\'t carry inventory, so there\'s no standard shipping, returns or warranty process to describe here — this isn\'t a retail hardware business.'),
  ]),
  LSec('2. On-demand integration service', [
    LB.p('If you want help connecting hardware you already own (or sourcing something specific) to AUZslab — for example setting up a barcode scanner or a receipt printer — we provide that as an on-demand service, scoped and charged separately, case by case. Terms for that work (price, what\'s covered, any warranty on the integration itself versus the hardware\'s own manufacturer warranty) are agreed in writing before the work starts, the same way a custom software project is — see Ownership & custom development.'),
  ]),
];

final List<LSec> deleteAccountSections = [
  LSec('Delete your account yourself', [
    LB.ul(['Sign in at auzslab.in/signup.html and open Account.', 'Scroll to Delete account and follow the steps. If your account has a password you will be asked for it.', 'You can also delete your account from Settings inside the POS, Payroll, Accounting and AUZsMob apps.']),
  ]),
  LSec('Or ask us to delete it', [
    LB.p('Email helloauzslab@gmail.com from the address on your account, saying you want your account and data deleted. We reply within 2 working days and complete the deletion within 30 days.'),
  ]),
  LSec('What happens', [
    LB.ul(['Your sign-in stops working straight away.', 'Your business data is deleted or anonymised within 30 days.', 'We keep only what the law requires, such as billing and tax records.', 'Encrypted backups are replaced on a regular cycle, so deleted data leaves them within a few weeks after that.', 'Deleting is permanent. Export your data first from the Back up / Export option in your app if you need a copy.']),
  ]),
  LSec('Staff accounts', [
    LB.p('A staff member with a username and PIN is removed by the business owner (Staff, then turn off or remove the login). If you are staff and want your personal details removed, ask the business owner or email us.'),
  ]),
];