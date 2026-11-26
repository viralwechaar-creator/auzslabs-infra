# Storefront master plan (Shopify-parity build)

Source: the Shopify lesson series (Modules 1-11) plus the owner's decisions. Shopify behaviour is the spec; deviations only where law or infrastructure forces them (GST, Razorpay Route, Indian addresses).

## Owner decisions
- Catalogue, stock, orders, customers are shared between the storefront and AUZsStyle when a shop has both; each sale/order carries a channel tag (online | in-store). A shop with only AUZsStyle keeps working on its own data.
- Products can be fully edited in both apps; a version check (`updated_at`) stops silent overwrites.
- AUZsStyle loses all website/design editing; it keeps one link/tab/icon that opens the storefront. All other AUZsStyle features stay.
- Last-unit rule as Shopify: in-store sale to zero blocks online; online-to-zero warns POS but POS may still sell; oversold sales are flagged; optional per-shop stock buffer.
- Payments: Razorpay Route (AUZslab account, linked accounts per shop). Sign-in codes: email + WhatsApp. Couriers: fixed fees now, shop's own courier account later (shipment records designed for it). Multi-country from the start. Apps: built-in first, API later.

## Rounds (built in this order, each with migration + tests)
| Round | Scope | Status |
|---|---|---|
| A | Order lifecycle: separate payment/fulfilment/delivery states, per-shipment fulfilment records with items + tracking + events, order channel tag, oversold flag, timeline events | built, tested |
| B | Inventory: stock states (available/committed/unavailable), stock buffer, adjustments with reasons, versioned product edits, "needs shipping" and cost per variant (cost snapshot on order lines) | built, tested |
| C | Returns/refunds/cancel as separate records with restock choice; draft orders; test-order flag | built, tested (draft orders already existed) |
| D | Customers: stable customer id on orders, address snapshots, consent record, sign-in by code (email + WhatsApp), account portal, store credit | built, tested (customer account page UI, credit redemption at checkout, SMS not built) |
| E | Discounts/marketing: discount calculator, buy-X-get-Y, free shipping, UTM/touch log, campaign attribution | built, tested (stacking/combining discounts and campaign reports from attribution not built) |
| F | Checkout settings: fields, payment methods order, shipping tiers + reasons, tax rules (CGST/SGST/IGST), purchase limits | built, tested (checkout page fields change what the public checkout shows only through config; theme code not rewritten) |
| G | Content/themes: blogs, redirects on handle change, theme revisions + restore, SEO fields, custom data (metafields/metaobjects) | built, tested (themes revisions cover store settings and theme choice, not section content edits; public pages for blog/redirects need the store theme code to call the new public RPCs) |
| H | Analytics: sessions, funnel, cohorts, RFM, inventory reports, profit with cost coverage, dashboard layout | built, tested (new Insights page; dashboard card choice has backend only) |
| I | Settings: roles/permissions split, security screen, notifications log, domains records, languages/markets, privacy, billing records | built, tested (roles screen for the new keys not built) |
| J | AUZsStyle shared mode + migration + storefront link tab | built, tested (in-store sales shared; returns in AUZsStyle not copied) |
| K | Razorpay Route onboarding and settlements; apps hub + API | built, tested (Route dormant and untested against Razorpay; read-only API) |
| L | Admin UI blueprint pass (patterns, unsaved-changes, field errors, filtered-empty, selection scope) | built, tested (unsaved changes, inline errors, filtered-empty, selection scope) |

Blocked on owner/outside services (not built, flagged): Razorpay Route approval, WhatsApp authentication template approval, email sender domain verification, courier accounts, domain registrar, Hindi review.
