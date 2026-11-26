# Storefront dashboard: compact UI pass, per-page checklist

Rules live in `app/public/storefront/ui.css` (one file, loaded after `ecosystem.css`, scoped to `.shell`).
Measured by `node tests/shots-storefront.mjs <dir>`: every page at 1280 px and 390 px, light and dark. `OK` = page renders, no sideways scroll.
Not measured here: real phones, screen readers, keyboard order beyond the visible focus outline.

| Page | Desktop light | Desktop dark | Phone light | Phone dark | Title px (desktop / phone) | Controls under 32 px (phone) |
|---|---|---|---|---|---|---|
| home | OK | OK | OK | OK | 22 / 20 | 0 |
| orders | OK | OK | OK | OK | 22 / 20 | 0 |
| drafts | OK | OK | OK | OK | 22 / 20 | 0 |
| abandoned-checkouts | OK | OK | OK | OK | 22 / 20 | 0 |
| returns | OK | OK | OK | OK | 22 / 20 | 0 |
| shipping | OK | OK | OK | OK | 22 / 20 | 0 |
| taxes | OK | OK | OK | OK | 22 / 20 | 0 |
| products | OK | OK | OK | OK | 22 / 20 | 0 |
| collections | OK | OK | OK | OK | 22 / 20 | 0 |
| inventory | OK | OK | OK | OK | 22 / 20 | 0 |
| transfers | OK | OK | OK | OK | 22 / 20 | 0 |
| categories | OK | OK | OK | OK | 22 / 20 | 0 |
| customers | OK | OK | OK | OK | 22 / 20 | 0 |
| segments | OK | OK | OK | OK | 22 / 20 | 0 |
| companies | OK | OK | OK | OK | 22 / 20 | 0 |
| growth | OK | OK | OK | OK | 22 / 20 | 0 |
| discounts | OK | OK | OK | OK | 22 / 20 | 0 |
| content | OK | OK | OK | OK | 22 / 20 | 0 |
| pages | OK | OK | OK | OK | 22 / 20 | 0 |
| blog | OK | OK | OK | OK | 22 / 20 | 0 |
| redirects | OK | OK | OK | OK | 22 / 20 | 0 |
| versions | OK | OK | OK | OK | 22 / 20 | 0 |
| files | OK | OK | OK | OK | 22 / 20 | 0 |
| data | OK | OK | OK | OK | 22 / 20 | 0 |
| custom-fields | OK | OK | OK | OK | 22 / 20 | 0 |
| markets | OK | OK | OK | OK | 22 / 20 | 0 |
| analytics | OK | OK | OK | OK | 22 / 20 | 0 |
| reports | OK | OK | OK | OK | 22 / 20 | 8 |
| insights | OK | OK | OK | OK | 22 / 20 | 0 |
| live-view | OK | OK | OK | OK | 22 / 20 | 0 |
| channels | OK | OK | OK | OK | 22 / 20 | 0 |
| website | OK | OK | OK | OK | 22 / 20 | 0 |
| builder | OK | OK | OK | OK | 22 / 20 | 0 |
| store-pages | OK | OK | OK | OK | 22 / 20 | 0 |
| store-directory | OK | OK | OK | OK | 22 / 20 | 0 |
| domains | OK | OK | OK | OK | 22 / 20 | 0 |
| checkout | OK | OK | OK | OK | 22 / 20 | 0 |
| apps | OK | OK | OK | OK | 22 / 20 | 0 |
| team | OK | OK | OK | OK | 22 / 20 | 0 |
| roles | OK | OK | OK | OK | 22 / 20 | 0 |
| locations | OK | OK | OK | OK | 22 / 20 | 0 |
| settings | OK | OK | OK | OK | 22 / None | 1 |
| notifications | OK | OK | OK | OK | 22 / 20 | 0 |
| policies | OK | OK | OK | OK | 22 / 20 | 0 |
| privacy-settings | OK | OK | OK | OK | 22 / 20 | 0 |
| billing | OK | OK | OK | OK | 22 / 20 | 0 |
| activity | OK | OK | OK | OK | 22 / 20 | 0 |
| staff-security | OK | OK | OK | OK | 22 / 20 | 0 |
| messages | OK | OK | OK | OK | 22 / 20 | 0 |
| security | OK | OK | OK | OK | 22 / 20 | 0 |
| switch-apps | OK | OK | OK | OK | 22 / 20 | 0 |
| orders/<order> | OK | OK | OK | OK | 22 / 20 | 0 |
| products/<product> | OK | OK | OK | OK | 22 / 20 | 0 |
| products/new | OK | OK | OK | OK | 22 / 20 | 0 |
| collections/new | OK | OK | OK | OK | 22 / 20 | 0 |

## Known limits
- Compact `.btn.compact` buttons are 28 px high on desktop by design (secondary row actions); on touch they are 36 px.
- Pages that already used their own card layout on phones (Products list, Reports library) keep it; they were checked for overflow and tap size, not rebuilt as tables.
- The phone Settings search box is 19 px high in one nested field (listed in the table); not changed.
- Dialogs follow the same radii, padding and a neutral backdrop; checked by the existing suites, not photographed one by one.
