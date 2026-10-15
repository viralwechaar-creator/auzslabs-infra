# AUZslab design system: tokens, Apple HIG mapping, platform rules

Written to back the owner's "Global Change Engine" master prompt (see CLAUDE.md's "Global
Change Engine" section) — this is the one place that says which tokens exist, where they live,
and which Apple-HIG principles this codebase has already implemented versus what's genuinely
new-design territory. It does not repeat CLAUDE.md's own design sections in full; it points at
them and at the real files.

## There is no single design system — there are four, each with a real reason to stay separate

| Surface | Token source | Why it's separate |
|---|---|---|
| Marketing site (`site/`) | `site/theme.css` (ink `#2e2c2a`/`#171717`, wine accent `#800020`, SF Pro + Inter + Space Mono) + `site/design-system/ui-kit.css` (`--uk-*` tokens, kept in sync by hand) | Public-facing, never uses `hig.css`; its own scroll-driven visual language (see CLAUDE.md "Marketing site: FX scroll worlds" and the later "reverted to PR #79 design" note — most of that scroll-scene machinery is now **gone** from `main`; `site/kept/` keeps the old look for 4 named pages only, deliberately). |
| Web staff apps (`app/public/ds/`) | `ds/auz.css` (the real token file — accent, surfaces, type scale, spacing, radii, shadows, `--hit:44px`, dark mode) + `ds/brand.js` (`auzBrand*`, the business's own colour becomes `--accent`) | POS, console, Accounting/AUZsScan, AUZsMob, Payroll all load this first. Back Office and Website Builder instead load `ds/legacy.css` last (a bridge mapping their own old `--ink`/`--l`/`--g` names onto the real tokens — they're `data-theme=light` only, dark mode not yet retokened there). |
| Native Flutter apps (`native/auzspos\|auzsmob\|auzsscan\|auzspay\|auzsledger/lib/ui/theme.dart`) | `Tk` class — the SAME values as `ds/auz.css`, hand-ported and kept in sync by hand, not generated from the CSS. Each app has its OWN copy of `theme.dart` (same convention as the web apps' "no shared JS modules" rule). | A Flutter app can't `@import` a CSS file; this is the acknowledged cost of keeping true native apps rather than a WebView. |
| Native hub's marketing pages (`native/auzshub/lib/ui/mkt.dart`) | `M` class — mirrors `site/theme.css`'s tokens (paper `#faf9f7`, ink `#2e2c2a`, wine `#800020`), NOT `Tk` — marketing pages deliberately ignore the business accent colour and dark mode, same as the website does. | The hub is one app that has to render BOTH a business's own app UI (business-coloured, `Tk`) and the public marketing site (brand-fixed, `M`) — these must never bleed into each other. |

**Changing a colour or spacing value means updating it in up to four places by hand**, and
checking `ui-kit.css`'s `:root` block whenever `theme.css` changes (CLAUDE.md's own documented
near-miss: `--uk-font-display` once pointed at a font that was never `<link>`ed, so every
`.uk-kit` component silently rendered in the wrong font for a long time before anyone noticed).

## Apple HIG: what's already built, read as a checklist before calling something "new"

CLAUDE.md documents the actual HIG implementation history in detail (search for "Apple HIG",
"hig.css", "Restaurant POS rebuild", "AUZslab design system for the staff apps", "KPI cards").
Summary of what already exists, so a `/global-fix` request doesn't rebuild it:

- **Clarity / hit targets** — `--hit:44px` is a real token, enforced by the `design` test suite
  at 7 widths; native apps' `Tk.hit` mirrors it.
- **Visual hierarchy** — `ds/kpi.js`/`ds/kpi.css` gives every `.kpis` group across POS, console,
  AUZsLedger/AUZsScan, AUZsPay and AUZsMob the same hero-tile layout automatically via a
  `MutationObserver` — don't hand-restyle a new metrics screen, let it be picked up.
- **Consistency** — segmented controls (`.seg`), bottom sheets for modals on phones, sentence
  case labels (no tiny mono uppercase in a staff app) are the baseline every staff screen is
  built to from the start, per CLAUDE.md's own standing rule under "Staff apps: Apple HIG
  layer."
- **Deference to content** — the admin console and AUZsLedger/Accounting deliberately keep dense
  tables/sidebars on desktop (CLAUDE.md: "Desktop business applications may require dense
  tables... preserve these capabilities"); this is not a HIG violation, HIG itself only asks
  that information stay scannable, not that every screen be sparse.
- **Feedback and control** — no `prompt()`/`confirm()`/`alert()` anywhere in the POS (`sheet()`,
  `alertBox()`, `confirmBox()`, `promptBox()` instead); irreversible actions (post/cancel a
  document, delete a client, clear all data) always ask first with a typed confirmation for the
  most destructive ones.
- **Accessibility** — the `design` suite checks dark-mode contrast and 12px text floor at phone
  widths; `prefers-reduced-motion` is respected by every CSS scroll-driven animation on the
  marketing site.
- **Platform-appropriate patterns** — native apps use Flutter's own navigation/sheet/dialog
  widgets, not reimplementations of the web's; the web apps use native `<dialog>`-style sheets,
  not Flutter widgets. Neither copies the other's control vocabulary.

**Genuinely not done yet** (don't claim these without checking first): Back Office/Website
Builder dark mode (still `ds/legacy.css`-bridged, `data-theme=light` only); a native iOS build
for any of the five product apps (Android-only so far, no Capacitor/Xcode iOS target for them —
only the Electron desktop shell and the hub's own iOS plan in `docs/HUB_APP_RELEASE.md` exist);
tablet-specific layouts beyond what CLAUDE.md's own native-app session logs say was added
(AUZsPOS round 10's max-extent grids are the only tablet work so far).

## Platform rules (condensed from CLAUDE.md Part 4 of the owner's master prompt)

- **Marketing/web apps**: preserve the approved look; new/explicitly-redesigned screens follow
  the Apple-HIG checklist above while keeping AUZslab's own ink/wine identity — never force an
  iOS look onto a desktop admin screen.
- **Native iOS/iPadOS** (not yet built for the 5 product apps; the hub has an iOS build target
  in progress, see `docs/HUB_APP_RELEASE.md`): use real platform navigation/sheets/typography
  once built — do not port the Android-first Flutter widget choices blindly.
- **Native Android** (the five product apps + the hub, all Flutter): respect Android back
  navigation, system insets, permission prompts. Apple-inspired polish (spacing, restraint,
  hierarchy) is fine; Android gesture/interaction conventions still apply.
- **Android WebView wrapper** (`mobile/`): reuses the live website outright — a fix there is
  usually "the web fix is enough," not a separate implementation to maintain. Native push,
  camera and Bluetooth bridges are the only things that needed wrapper-specific code (see
  CLAUDE.md "Android app store-readiness review").
- **Desktop** (`desktop/`, Electron): same principle as the wrapper — loads the live site.

## Where to look next

- `docs/APP_INVENTORY.md` — every app, its routes/screens, roles, backend dependencies, and
  test coverage.
- `docs/BACKEND_MAP.md` — the server route/module split.
- `docs/SITE_MAP.md` — the marketing site's three asset sets and page groups.
- `docs/UI_REDESIGN.md`, `docs/POS_AUDIT.md` — the original HIG audits and gap matrices this
  design system grew out of.
- CLAUDE.md itself — the authoritative, continuously-updated narrative; this file is a map into
  it, not a replacement for reading the relevant section before a design change.
