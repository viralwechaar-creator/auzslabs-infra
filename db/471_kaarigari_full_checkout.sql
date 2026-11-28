-- Kaarigari gets its own checkout layout back (owner-reported bug: its approved handoff --
-- theme-handoffs/kaarigari/source/checkout.js + style.css -- had a fully custom checkout page, but the real
-- integration (PR #1299) left checkout on the shared, generic header/footer-only form, same as every other
-- bespoke theme). The owner has explicitly asked for Kaarigari's own checkout design back: this is the
-- documented, reviewed "fuller ownership" exception db/468's own comment and
-- docs/STOREFRONT_THEME_CONTRACT.md already describe -- a different declared capabilities.checkoutOwnership
-- value, added with its own migration -- never a change to the header/footer-only default every OTHER theme
-- (including Studs) keeps.
--
-- Rollback: update sfx_themes set capabilities = capabilities || jsonb_build_object('checkoutOwnership', 'header_footer')
--           where slug = 'kaarigari';

update sfx_themes set capabilities = capabilities || jsonb_build_object('checkoutOwnership', 'full')
  where slug = 'kaarigari';
