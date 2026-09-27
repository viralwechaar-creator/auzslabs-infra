# Reference-build queue — what's done, what's next

The user shared 6 design references in one batch, described exactly what to
change per reference, then said "build." This file tracks it across
sessions since the full list is too large for one pass.

## Done (this pass)

- [x] **Footer** (Undercat/Bienes refs) — black panel, wordmark, link
      columns, newsletter email input, "Back to top" pill button.
      Applied uniformly on all 7 pages (`.footer-dark` in theme.css).
- [x] **Menu button** (Studio99 ref) — hamburger icon replaced with a
      text button reading "Menu" (swaps to "Close" when open via JS).
      Applied on all 7 pages, same `#menuToggle` id/behavior.
- [x] **Stack-panel titles** (Laxer ref) — small corner tab replaced with
      huge bold section name (`clamp(56px,16vw,130px)`) printed at the
      panel's own top edge; the next panel's higher z-index covers the
      lower portion as it stacks up. Offsets widened (112/194/276px
      mobile, 150/260/370px desktop) to give the type room. Currently
      only on index.html's 3 panels (data-tab="WORK" / "BUILD").
- [x] **Desktop hover flyout spacing** — padding/gap increased slightly
      per "already perfect, just needs more spacing."

## Still queued — not built yet

- [ ] **Mobile menu two-level drill-down** (sports-app ref): tapping
      Products/Business types/Resources should swap the WHOLE screen to
      a dedicated sub-list view (smaller typography, category header)
      instead of the current inline accordion-expand — with a back
      button (returns to main list) and the close (X) button relocated
      to the bottom of the screen instead of top-right. This replaces
      the `.nav-group` inline-expand JS/CSS on mobile only; desktop
      hover flyout stays as-is.
- [ ] **Homepage restructure** (Studio99 ref, the rest of it):
      - Bold logo repeated huge at the very BOTTOM of the homepage (not
        just top-left) — separate from the footer wordmark already
        added; this is specifically about the homepage's own layout,
        likely as a closing panel/section before the footer.
      - Short one-word/short-phrase service label list near the hero
        (like their "Branding / Website / Packaging / Interior") —
        ours: **POS** (bold/primary) / CRM / Booking / Payroll (faded).
      - Replace/add an ORIGINAL doodle illustration (not a photo) near
        the hero, matching platform.html's illustrated style — this is
        separate from (but can incorporate ideas from) the 9read ref's
        curvy-blob + bold graphic wave/nature illustration language,
        kept in OUR ink/orange palette (not the 9read red/black/cream —
        flagged as a deliberate palette decision, confirm if they
        actually want red introduced anywhere specific).
- [ ] **Contact page → stacked scroll** (requested before the reference
      batch started): convert contact.html's plain `.section` layout
      into the same `.stack`/`.stack-panel` folder-scroll system as the
      homepage (intro / form / FAQ as 3 panels), now including the huge-
      title treatment above instead of the old small tab.
- [ ] **Homepage "View products" → in-page sub-stack** (requested before
      the reference batch): tapping the hero's "View products" /
      "See all products" buttons should reveal an in-page product
      preview (4th stack panel or similar) instead of navigating to
      products.html. products.html itself stays as the full detail page,
      reachable via the sidebar.
- [ ] **9read-inspired curvy doodle art** — apply the reference's shape
      language (big rounded blob shapes, bold graphic doodle
      illustration) as a decorative motif somewhere concrete (likely the
      homepage hero-art and/or the new doodle illustration above) —
      needs a specific spot chosen, not a full red/black/cream reskin of
      the site (that would undo the established ink/orange brand).

## Standing rules from this batch (apply going forward)

- Everything must be fully responsive/auto-adjusting across phone /
  tablet / desktop, every time, without being asked each time.
- Visual consistency across the whole site — new patterns (footer, menu
  button, stack-panel titles) get applied to every page they're relevant
  to, not just one.
