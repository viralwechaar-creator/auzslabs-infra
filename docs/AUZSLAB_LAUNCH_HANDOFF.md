# Claude handoff for the AUZslab launch

Paste everything below the divider into Claude.

## Preview reference

- Run `node ecosystem-preview/server.mjs` from the repository root, then open `http://127.0.0.1:4226/`. The owner hub is at `/dashboard.html`; `/account.html` redirects only inside this local preview. Classic and Minimal storefront previews are available at `/store.html?template=classic` and `/store.html?template=minimal`.
- The branch bundles the storefront renderer and the referenced local design images. Some catalog images use public AUZslab demo media URLs. The included catalog is demo data with checkout disabled and sample contact values. Browser-local edits are per browser.
- Related GitHub refs: `codex/app-consolidation` at `aebefaa6b2e635e39b52ecbc152269061ddb7677` (includes GenX demo catalog and inventory import), and `codex/auzsstyle-minimal` at `643759eead92385a23a98be62f9e63aeff2052e7` (Minimal and Classic storefront work). Compare both to current main and production before selecting patches.

---

You are preparing the AUZslab release. Start in **read-only audit mode**. Use the GitHub repository `viralwechaar-creator/auzslabs-infra` and the Codex handoff branch `codex/auzslab-launch-handoff` if it is visible. Compare the branch with the latest GitHub main and the actual deployed revision, which may be different. If a branch, revision, preview, or asset is unavailable, report the gap and request the exact source. Use the current VPS deployment documentation and scripts as evidence for the checkout and service paths.

**Do not merge, deploy, change VPS settings, apply migrations, seed a tenant, change DNS, rotate credentials, replace an active route, or retire an app during the audit.** Deliver your report and wait for my explicit approval before implementation or any production change.

## 1. Reproduce and inventory what Codex built

- Identify the exact commits and list what they contain. Check that the GitHub branch reproduces the local design on desktop and mobile. Audit images, styles, scripts, theme assets, routes, empty states and fallback states. Record missing files and visual differences. The locally approved design is the visual reference. Preserve its typography, palette, layout and approved text. Resolve parity gaps by reusing the existing code and components.
- Review the public homepage, Services, Studio, Contact and its business, developer and careers paths, Themes, Live Demo, About, and the developer partner page. Preserve the restored homepage hero copy, Studio page, compact homepage cards, expandable Services cards with service-specific enquiry links, updated menu and footer. Review page metadata, indexability, canonical URLs, sitemaps, redirects, social previews, structured data and internal links. Ensure public pages can be indexed when published and preview/account pages carry the appropriate controls. Treat policy drafts and developer commission terms as pending approval. Keep claims about payments, integrations and geographic availability tied to verified capabilities.
- The Shopify work was research into workflows and information architecture. AUZslab’s direction is an independent commerce and operations ecosystem. The business owner hub brings together store design, catalogs, inventory, orders, shipping, domains, reporting, marketing, staff access and subscriptions. AUZsStyle, AUZsLedger and Salon Console serve operational workflows. AUZslab Studio delivers custom apps and software. Developers can propose themes and apps for review and earn commission on eligible purchases under approved agreements. Keep future capabilities separate from production-ready features.
- Review the dashboard, catalog and variants, collections, bulk editing, inventory, orders, analytics, user and role management, billing, the theme library and storefront editor, pages and navigation, and domains. Classify each workflow as backed by production services, implemented only in the local preview, or missing. Local sample routes, browser storage, mock API responses, simulated checkout and demo credentials are preview fixtures and must remain isolated from production.
- Review the earlier AUZsStyle consolidation and Minimal storefront/inventory update branches as separate inputs. Keep AUZsStyle’s existing Online store controls available alongside the owner hub. Preserve the existing AUZsStyle barcode workflow and keep Style and Ledger data separate. Confirm the Salon Console and its currently linked public site. Identify legacy apps separately as hidden from new onboarding, still running for current clients, or approved for future retirement. Preserve the existing Claude-built SalesOS and staff login. Exclude the superseded Codex SalesOS from the release.

## 2. Audit live Account parity and client impact

- Inventory the production `account.html` before proposing a redirect or replacement. Use authorized read-only access and test every available role and subscription using demo data. Trace the UI to real routes, payloads, permissions and storage. Cover sign-up and sign-in callbacks, saved/deep links, subscriptions, renewals, invoices, staff, permissions, tenant switching, app launches, business profile, notifications, privacy/data export/deletion, support, admin linkage and any plan-specific features you find.
- Create a parity matrix with the old location, role/plan, backend dependencies, new location, status, impact and proposed action. Include a separate list of every feature that would disappear, change behavior, or lose access. For gaps, propose the smallest addition that keeps the approved new UI and existing behavior. Wait for approval before implementing additions. Verify tenant isolation on the server and entitlement enforcement independently from navigation visibility.
- Report the impact on current customers by app, user role and tenant type. Check URLs, auth/session continuity, downtime, database compatibility, legacy assets, checkout, billing, taxes, stock, staff access, tenant scoping, and the ability to roll back. Identify any risks to the host or other tenant data. GenX sample inventory changes belong only to the explicitly verified GenX demo tenant. Confirm its identity in read-only mode before proposing a dry-run import.
- Draft an additive rollout with backups and a restore check, staging, a demo-tenant or feature-flag pilot, compatibility routes, smoke tests, monitoring and rollback. Avoid irreversible schema and data changes. Any retirement, schema migration, DNS change, or production rollout requires its own identified approval. Provide deployment commands only after verifying the actual repo path, Compose services, revision and approved scope.

## 3. Report before implementing

Return these sections in plain language:

1. **Compared revisions and evidence** with exact SHAs and preview URLs checked.
2. **What gets added or updated** by public site, account dashboard, storefront/editor, apps, backend and SEO.
3. **What users could lose or see changed** with the affected roles, plans and tenants.
4. **Account parity gaps** with the exact workflow and proposed fix for each.
5. **Production readiness** covering preview-only features, production dependencies, security/tenant checks, unresolved legal items, data migration risks and rollback.
6. **Go/no-go recommendation** and the specific decisions you need from me.

Stop after the report and wait for written approval. Preserve the approved local design when implementation is authorized.

