# Storefront theme contract

Like Shopify's own theme requirements, this is the binding checklist any storefront theme on this platform must
meet to properly integrate with the backend's orders, inventory and other storefront features without losing
any of its own UI or frontend design. It applies to every theme in `sfx_themes` -- both kinds:

- **section-based** themes (Minimal, Classic, Salon, Kiln, Kiln (Salon)): drawn entirely by the shared section
  renderer from `sfx_theme_versions`' JSON content. Adding one is a data row plus content -- nothing new to wire.
- **bespoke-chrome** themes (Studs, Kaarigari): a fully custom-coded JS/CSS file that bypasses the section
  renderer entirely. This is the integration path that caused a real production bug (see below) and the one
  most of this document is about.

**The single source of truth for which theme is which, and what it declares it owns, is the theme registry**:
`sfx_themes` itself, read through the public RPC `public_sfx_theme_registry()` (`db/468_theme_registry.sql`).
Client code (`store.js`, `demo.js`, the Themes gallery) must read that list, never hardcode its own copy of
which theme ids exist or which ones are bespoke.

## Why this document exists

Activating Kaarigari on a demo account silently fell back to the wrong theme/data, because
`app/public/store/demo.js` had a hardcoded, stale check (`theme === 'minimal' ? 'minimal' : '1'`) that was
never updated when Studs/Kaarigari were added. Investigating further found the exact same failure mode
repeated in at least 8 separate spots in `store.js` alone (`isMin()`, the `cfg().template === 'studs'` /
`'kaarigari'` checks scattered through routing/caching/boot, the preview allowlist), plus `demo.js`, plus
`workspace.js`'s theme-install/preview logic. Nothing enforced that adding a 3rd/4th/5th theme touched every
one of those spots -- that is exactly how the Kaarigari bug happened, and would keep happening for every future
theme without a structural fix. The fix is this document plus the registry (`db/468`) and the automated
conformance suite (`tests/suites/local/theme-contract.mjs`), not another patch to one file.

## The theme registry (`public_sfx_theme_registry()`)

Returns, for every `is_builtin` and `status = 'approved'` row in `sfx_themes`:

| field | meaning |
|---|---|
| `slug` | the theme's marketplace slug, e.g. `'salon'`, `'studs'` |
| `name` | display name |
| `kind` | `'section'` or `'bespoke'` |
| `baseChrome` | the chrome this theme is built on (see below) |
| `template` | the DISPATCH value this theme resolves to at runtime -- what ends up in `sfx_stores.theme` / `cfg().template` client-side. For a bespoke theme this is its own slug; for a section-based theme it is the generic chrome (`'minimal'`/`'classic'`) it is built on |
| `isBespoke` | boolean, computed from `base_chrome` (never a hand-maintained list) |
| `capabilities` | declared capabilities object, see below |

`is_bespoke_chrome` is a **generated column**: `base_chrome is not null and base_chrome not in ('minimal',
'classic')`. A theme is bespoke precisely when it ships its own chrome file instead of being drawn by the
shared renderer -- this is computed structurally, so it can never silently drift the way a literal array did.

Client code must read `BESPOKE` / `THEME_REGISTRY` (in `store.js`, populated from this RPC at boot) instead of
writing its own `['studs', 'kaarigari']` or `['minimal', 'studs', 'kaarigari']` array. `demo.js` must resolve
whatever `?demo=` id it is given against this same registry (`templateFor()` in `store.js`), never its own list.

## What EVERY theme must satisfy, regardless of kind

1. **Renders with zero products** (empty catalogue state) without erroring.
2. **Renders with a genuinely empty cart** without erroring.
3. **Works at both phone and desktop widths**, no sideways scroll.
4. **Shows its own branding** (name, colours, header/footer) somewhere a customer can see it.
5. **Never silently swallows a real RPC error** -- a failed `public_sfx_*`/`public_sty_*` call must surface as
   a real error state, not a blank page or a fallback to different data (this is the exact bug class this
   document exists to prevent).
6. Checkout (COD at minimum) must complete and produce a real order.
7. Files that MUST be touched when adding a new theme of either kind: the row in `sfx_themes` (the registry,
   item above), and nothing else client-side needs touching for identity/dispatch -- the registry eliminates
   that. The public Themes gallery (`site/themes.html`) is maintained separately as marketing copy and preview
   links, and still needs its own card added by hand (it is static marketing HTML, not fed by the registry).

## Section-based themes (Minimal, Classic, Salon, Kiln, Kiln (Salon))

These are "just a data row" by design, but that row must still be valid:

- `base_chrome` must be `'minimal'` or `'classic'` (one of the two generic chromes the section renderer draws).
- Its approved `sfx_theme_versions.content` must be a well-formed sections document: `{"sections": [...]}`
  (or `{"kind": "...", "sections": [...], "settings": {...}}` for a themed variant like Salon/Kiln). Every
  section `type` it uses must exist in the section registry (`sfx_section_registry()`, `db/452`) -- a section
  type the renderer does not know about is silently skipped, which is its own (separate, already-handled)
  failure mode the section renderer already guards against.
- It renders through the SAME shared code path as Minimal/Classic (`store.js`'s generic, non-bespoke render
  functions) -- there is no separate per-theme JS file to validate for this kind, which is why its conformance
  checklist (enforced by `theme-contract.mjs`) is lighter than a bespoke theme's.
- It is NOT exempt from the "every theme" checklist above (empty catalogue, empty cart, both breakpoints,
  checkout, no swallowed errors) -- being generic does not mean untested.

## Bespoke-chrome themes (Studs, Kaarigari, and any future one)

### The JS contract

A bespoke theme ships `app/public/store/<slug>.js` (and may ship its own CSS, loaded by convention -- see
below). It is loaded by `store.js` ONLY when `cfg().template === '<slug>'`; no other store ever requests it.
It must expose exactly this global, following the naming convention `window.<Slug>Theme` (capitalize the
slug's first letter, e.g. `studs` -> `window.StudsTheme`, `kaarigari` -> `window.KaarigariTheme` -- this
convention is itself part of the contract: `store.js`'s generic loader (`loadBespokeChrome`) derives the
script path (`/store/<slug>.js`) and the global name from the slug alone, so a conforming theme needs zero
changes to `store.js` to be loaded):

```js
window.<Slug>Theme = {
  owns(routeId)     // true if this theme draws this route itself (home, shop, product, etc.)
  show(parts)       // draw the route this theme owns
  hide()            // hide this theme's shadow-root host
  frame()           // wrap the theme's own header/footer around the shared page (checkout/account/orders/policies)
  unframe()         // undo frame() -- called before this theme draws one of its own routes
  refresh()         // re-render after settings change (e.g. a live editor preview)
  ready             // a function/promise: resolves once this theme's data layer has loaded
};
```

`store.js`'s router (`route()`) calls `owns(id)`; if true, `show(parts)`; otherwise `frame()`, leaving the
shared page to render underneath the theme's header/footer. This is a real, binding contract now, not an
informal convention documented only in `studs.js`'s own top comment.

### What a bespoke theme may read from `store.js`, and what it must NOT do

May use, through `window.StoreHost`: **read the catalogue** (`H.STY()`, `H.D.collections`, `H.photos`,
`H.isGone`, `H.leftOf`, `H.sizesOf`, `H.colours`) and **use the shared bag** (`H.bag`, `H.saveBag`, `H.addBag`,
`H.bagLines`, `H.bagTotal`, `H.bagCount`). Nothing else. It must NOT:

- touch another tenant's data, directly or indirectly;
- bypass the real `public_sfx_*`/`public_sty_*` RPCs (fetch its own endpoints, fabricate orders, fake stock);
- fake checkout or payment client-side -- checkout is always the shared, real flow (see below);
- read or write `localStorage`/`sessionStorage` keys outside the `st.<slug>.*` convention the shared code uses.

### Header/footer-only checkout ownership (the baseline standard)

**A bespoke theme wraps its own header/footer around the SHARED, generic checkout/account/orders/policies UI.
It does not have to re-theme checkout's own form/fields.** This is the owner-approved baseline for every
bespoke theme going forward (confirmed against what Studs and Kaarigari already do), declared explicitly in
the registry as `capabilities.checkoutOwnership = 'header_footer'`. A future theme that genuinely needs fuller
checkout ownership (re-themed form fields, a different checkout layout) is an **explicit, reviewed exception**
-- a different declared `checkoutOwnership` value, added with its own migration and sign-off -- never a
default expectation for a new theme.

### Required real-data behaviors (in addition to the "every theme" list above)

- Must render correctly with a draft that has never been published (the merchant's live store must not change
  until Publish).
- Rollback (reverting to the previous theme) must be clean and per-store: it must never touch another store.
- Sold-out/zero-stock items must be handled visibly (washed out, disabled "add" control), not hidden or crashed on.

### Files to update when adding a new bespoke-chrome theme

1. The registry: a new `sfx_themes` row with `base_chrome = '<slug>'` and `capabilities` set (at minimum
   `checkoutOwnership: 'header_footer'`) -- `db/468_theme_registry.sql`'s generated column and defaults pick it
   up automatically; no separate list to edit.
2. `sfx_themes.base_chrome`'s check constraint (and `sfx_stores.theme`'s, if the theme can go live) must
   include the new slug -- see `db/467_kaarigari_theme.sql` for the pattern (drop and recreate the constraint).
3. `app/public/store/<slug>.js` (and `.css` if needed), following the JS contract above and the naming
   convention (`window.<Slug>Theme`).
4. The public Themes gallery, `site/themes.html` -- a new theme card (marketing copy, preview link, screenshot).
5. **Nothing else.** `store.js`, `demo.js` and `workspace.js`'s preview-on-own-address logic all read the
   registry (or the naming convention derived from it) and need no further edits for a conforming theme.

### Verifying a new theme is conforming

Run `tests/suites/local/theme-contract.mjs` (`node tests/run-local.mjs theme-contract`). It iterates over
**every** row the real registry returns -- bespoke or section-based -- and fails loudly, by design, if a theme
was added to `sfx_themes` but never wired up correctly (see that file's own header comment for how).
