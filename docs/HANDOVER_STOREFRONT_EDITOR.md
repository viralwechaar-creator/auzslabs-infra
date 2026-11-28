# Handover: AUZslab storefront theme editor (Shopify-style) -- start here

Repo: viralwechaar-creator/auzslabs-infra. Read `CLAUDE.md` first (the "Storefront theme editor, steps 1-19" and "Storefront Shopify-parity" sections hold the full history). Standing rules: after tests pass, commit on a feature branch, push with an explicit refspec (never to `claude/read-claude-md-wo80on`), open a PR with the GitHub MCP, squash-merge, reply briefly with deploy commands, and say what was not tested on a real phone/desktop. Commit trailers: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and the session link.

## What exists (all merged to main)
Section-based editor, files `app/public/storefront/workspace.js` (+ `ui.css`, `ecosystem.js`), public store `app/public/store/store.js`, migrations `db/452`-`db/470`:
1-19 (db/452-467,470): section registry (`sfx_section_types`), items/blocks, per-page templates (collection/product/cart), revision check on save, global design settings, shared header/footer groups, Content section with click-to-edit elements, link picker (`ref:` references), All-pages board, animations, inline typing, duplicate/hide, newsletter, Row container, floating settings panel, custom data field, product tags filter, product-information section, pages follow the theme (db/467 re-added by db/470 after db/468 overwrote it).
Latest (static only, no migration):
- PR #1314: Shopify-style **page tree** in the left panel: Header / Template / Footer groups, nested blocks, "..." menu (Copy, Paste, Duplicate, Hide, Add block before/after, Move, Remove), group "+" add-section menu, phone floating bar (Sections / Theme / Add / close).
- PR #1315: **Online store overview** shows a live preview (desktop + phone frame) with theme/status/set-up cards; **Themes page** cards are even and show a real rendered preview (scaled iframe `/store.html?preview=<slug>&shop=<slug>`) for classic/minimal/studs/kaarigari.
Owner deploys: `cd /root/auzslabs-infra && git pull origin main`, `set -a; source .env; set +a; bash tools/migrate.sh apply` (db/462-470 if not yet), `docker compose up -d --build api` (RPC registry from db/462 and db/468).

## Owner's goal (their words, paraphrased)
Exactly the Shopify theme editor (see Shopify Horizon mobile screenshots): tap Edit theme, pick any page element (header, hero, product card, buttons), change font/size/colour/radius etc.; the left tree with nested blocks and locked blocks; Theme settings as foldable groups (Logo and favicon, Color palette, Typography, Page, Animations, Badges, Buttons, Cart, Drawers, Icons, Input fields, Popovers and modals, Prices, Product cards, Search, Swatches, Variant pickers); an Add-section sheet with Sections/Apps tabs, search, preview, categories; and **upload a theme zip that is validated against rules (accepted or rejected with reasons) and is then fully editable in the same editor**. Decision made: **Option A, no custom JavaScript** in uploaded themes (declarative sections + settings + CSS only). Today only sections you ADD are editable: the hand-coded Minimal/Classic pages and the bespoke Studs/Kaarigari themes are not.

## Build order still to do
2. **Theme settings groups** (the foldable groups above), working on every theme; extend `sfx_design_settings`/`sfx_design_registry` (db/455) and the editor's Design panel.
3. **Add-section sheet** with preview, search and categories (+ presets per section type).
4. **Theme package**: zip format (manifest.json, sections/*.json each with schema {settings, blocks, presets, max_blocks}, templates/*.json, settings_schema.json, css, assets); validator (reject script tags/inline handlers, unknown setting keys, preset keys not in schema, size limits, section/block limits), upload + review UI with reasons, install into the existing registry. Reuse db/375 (marketplace review path) and db/468 (theme registry, `is_bespoke_chrome`); coordinate with the parallel session that owns bespoke themes (Studs/Kaarigari, `docs/STOREFRONT_THEME_CONTRACT.md`).
5. **Rebuild Minimal and Classic from sections** (header, hero, product grid, footer as real sections/blocks with locked blocks) so everything is selectable. Needs section/block `name` + `locked` fields in the cleaner (db) for Rename and Lock.
Also: element styling on hand-coded pages, nested containers beyond one level, product-page parts as movable sections, a merge view for edit conflicts, colour schemes and presets.

## Known open items
- `tests/suites/local/sfxthemes.mjs` "Themes page ... preview picture" failed after PR #1315 only because theme-preview thumbnails are iframes (cancelled requests, seeded `/uploads/collection-cover.jpg` 404s); `tests/lib/harness.mjs` now ignores those (this handover's PR).
- Duplicate migration number 467 (`467_kaarigari_theme` and `467_sfx_pages_follow_theme`); both apply, left as is. Next free db number: 471 (re-check with `git ls-tree --name-only origin/main db/ | sort -V | tail`).
- Nothing here was seen on a real phone or desktop; only headless Chromium and the suites.

## Test commands
`service postgresql start` (own command), then one suite at a time in the background: `node tests/run-local.mjs sfxsections` (31 checks), `sfxthemes` (11), `studs`, `sfxcommerce`. Screenshots: `ONLY=website,builder node tests/shots-storefront.mjs /tmp/shots` (needs Postgres, ~100 s). A suite that crashes building the DB prints CRASHED/Migration failures and no READY.

## Paste this to start a new session
"Read CLAUDE.md and docs/HANDOVER_STOREFRONT_EDITOR.md in /home/user/auzslabs-infra. Continue the storefront theme editor with step 2 (Theme settings groups). Follow the standing rules in the handover: tests first, then commit, PR, squash-merge, and reply briefly with deploy commands."
