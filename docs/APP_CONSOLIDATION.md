# App consolidation rollout

This branch starts the Scan checkout and stock receiving work. Use the local Account prototype to review navigation with sample data. Use an isolated stack to verify changes against actual app records.

| Source workflow | Destination | Status and verification |
| --- | --- | --- |
| Scan camera, keyboard and hardware barcode entry | Style Sell | Shared UPC/EAN matching has a focused test. Scan mode uses the existing bill and scanner. Verify camera and hardware in an isolated browser session. |
| Scan-to-receive, repeat scans | Style Buy | Existing purchase form now increments a scanned variant. Verify cost, stock, offline receipt and replay against the database. |
| Scan quick bill, unknown products, GST override, invoice, print, share and returns | Style Sell and Bills | Parity pending. Preserve the existing document and accounting identifiers for Scan-only merchants. |
| Scan listings, archive, stock, imports, labels, alerts and onboarding | Style Stock, Buy and Settings | Compare existing actions and port gaps, including PDF, Busy and Tally import. Verify large catalog and zero-stock search. |
| Scan expanded accounting tools | Ledger | Ledger already provides the accounting menus and Scan to Bill. Map legacy Scan-only access before changing the launcher. |
| Style Store, Orders, Offers and Reviews, Visitors and website Return Requests | AUZLab Account | UI prototype only. Move existing permission-checked actions and preserve public site configuration, order references, URLs and management bookmarks. |
| Finance Today, Activity, Dues, Owner and Loans, Accounts, Reports, Insights, Notifications, AI, Settings | Ledger | Map existing shared parties and posted entries before migrating Finance-only records. Verify totals against the original Finance reports. |
| Finance withdrawal, approval, recurring, bank import, assets, budget and tax | Ledger | Parity pending. Compare posting, approval, memo-only tax, period locks and replay behavior by action. |
| Mob bills, repairs, IMEI, dues and offline work | Authenticated archive or export | Inventory dependencies and provide access to historical records before retiring operational endpoints. |
| Salon site and console, POS and Pay | Existing apps | Keep current routes and operations. Run Salon booking-to-bill and walk-in billing and shared access regressions. |

## Tenant cutover checklist

1. Record the tenant, active licences and staff roles, installed versions, app-specific catalogue IDs and historical document links.
2. Verify an isolated restore and record stock, balances, open repairs or orders, and outstanding offline operations before enabling a replacement.
3. Test migration with a Scan-only tenant, a Finance-only tenant, a Style storefront tenant and a Salon demo. Verify tenant boundaries, entitlement checks, cancelled subscriptions and staff roles.
4. Drain offline queues, enable replacement access for the specific tenant, and reconcile inventory and accounting. Retry sample operations and check for duplicate writes.
5. Validate replacement links and secure exports before removing discovery, signup, purchase or launch paths. Keep historical receipt links and shared endpoints serving active clients.
6. On rollback, stop replacement writes, drain its queues, identify transactions created since cutover and reconcile or replay them once before restoring legacy writes. Verify balances and permissions before reopening counters.

Production deployment, migrations, live entitlement changes, tenant cutovers and final retirement require owner approval. Permanent record deletion is a separate decision.

## Existing Account and Platform Admin contracts

- Account shell and views: site/account.html, site/ac5.js, site/ac5-views.js. Preserve Overview, Business profile, Services, Open an app, Staff, Roles and access, Billing and plan, Notifications, Account settings, Privacy and my data, AI connectors, and Help and support. The shell already varies visibility by owner, manager, customer, and admin.
- App access has three separate inputs. Platform Admin sets tenant grants and caps through admin_set_tenant_features and admin_set_tenant_caps. Account loads grants and enabled settings through my_dashboard. update_my_features lets the owner toggle only already entitled keys. Staff creation and custom role assignments are a separate authorization layer. Keep the app-side server checks when adding or moving a launcher item.
- Platform Admin also owns signup and add-on approvals, provisioning, tenant slug changes, licence records, client orders, payments and bills, platform notifications, audit and privacy requests. Keep those admin mutations on the existing privileged path. Merchant Account should continue to reflect the shared records through its own scoped reads.
- Before moving the website controls, pilot with an owner, manager, staff member, customer with no tenant and platform admin. Verify that an unrelated tenant cannot read or update another storefront. Compare grants, staff permissions, published domain and template, service renewals, invoice history, notifications, and help links before and after.
- The design preview uses sample records and represents proposed navigation. It is not a replacement for authenticated Account or Platform Admin.
