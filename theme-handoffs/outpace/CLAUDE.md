# Integrate Outpace into AUZslab

Use the current AUZslab integration base and bring in only `theme-handoffs/outpace/` from `codex/outpace-template`.

- `preview.html` is the approved standalone Outpace preview. Its SHA-256 is `6632a4c5bbcd59cc9fe8638a31897833f31f4d5ee8c4100de971c0928cdadcd1`.
- `source/index.html` is the separate-file version. Its directory contains the CSS, JavaScript, and all original image assets.

## Theme registration

1. Read the current repository instructions and inspect how the platform registers, previews, edits, installs, and publishes first-party themes. Register **Outpace** with the identifier `outpace` and serve the approved standalone preview through the established theme gallery. Reuse the same campaign artwork and image bytes.
2. Implement Outpace through the native storefront theme path. Connect merchant products, collections, prices, inventory, currency, promotions, bag, shipping, payments, and orders through existing platform services. The public preview uses local sample data and demo checkout. Keep live checkout on the existing server-backed flow.
3. Keep the black-and-lime palette, typography, layout, artwork, image crops, and responsive behaviors. Check the desktop navigation and mobile menu, scroll-aware header, stacked mobile hero, two-column mobile product grid, visible search and expandable filters, limited drops, signup, FAQ, product options, cart, and checkout. Call out any platform constraint that affects visual parity before changing the design.
4. Make installation a draft operation with an explicit merchant publish step. Use an isolated test store. Preserve active themes, merchant data, tenant boundaries, and payment settings.

## Acceptance

Compare the approved preview with the staging storefront at desktop and phone widths, including 390 px. Exercise navigation, search and filters, product options, bag, checkout, and theme draft/publish/rollback in the test store. Deliver a staging URL and a reviewable branch for approval before production deployment.
