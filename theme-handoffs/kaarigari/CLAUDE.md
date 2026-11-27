# Integrate the approved Kaarigari theme

Use the current AUZslab integration branch as the base. The `codex/kaarigari-template` branch supplies the approved theme, including its complete source and image assets.

- `preview.html` is the approved standalone preview, byte-for-byte. SHA-256 `0d497ce5b64d619a598d69aa96c295055334fe97ec5e13fbace73f503102b75b`.
- `source/index.html` is the separate-file version with CSS, JavaScript, catalogue fixtures, and all artwork. Serve this directory to review it.

## Public preview and theme library

1. Serve the approved `preview.html` as the public Kaarigari preview, using the current routing convention for theme previews. Register **Kaarigari** in the public Themes gallery and the merchant theme library using the identifier `kaarigari`. Reuse the original cover and artwork.
2. Inspect the current storefront renderer, theme registration, editor schema, draft/publish behavior, and existing tenant boundaries. Integrate Kaarigari through the supported native theme path. If the ZIP importer only accepts a theme configuration or section schema, treat these files as source assets for a first-party theme.

## Storefront integration

3. Use the approved preview as the visual reference. Keep its fonts, colors, images, image crops, borders, shadows, spacing, responsive breakpoints, and interaction patterns. Use the same asset bytes. Verify the header, full-screen hero, six-tile homepage collection layout, product cards and previews, Pottery edit, Our Story, checkout layout, and skyline footer. The retired Craft Journal pages are absent from the approved preview.
4. Hook up merchant collections, products, prices, stock, currency, bag, checkout, orders, policies, and contacts through the current platform services. Keep fixtures and local checkout behavior on the public preview. Use real merchant configuration in the storefront. Put live payment and fulfillment outcomes on the existing server-backed flow. If a required capability has no platform integration, list that dependency for review.
5. Let a merchant install Kaarigari as a draft, preview it, and publish it explicitly for their own store. Preserve existing active themes, merchant configuration, records, domains, and payment settings. Reuse the existing tenant scoping, theme versioning, and rollback conventions.

## Acceptance

Capture side-by-side screenshots of the approved preview and a test storefront at 1484 × 678 and 390 × 844. Compare desktop and phone layouts and exercise navigation, product previews, cart, checkout, and draft/publish/rollback using an isolated test tenant. Report any platform constraint that affects visual parity before making a design change. Deliver a staging preview and a reviewable branch for approval before production deployment.
