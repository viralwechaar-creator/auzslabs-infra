# UI Kit — build roadmap

Shared component library for both the marketing site (`site/`) and the future
POS/CRM product (`app/public/`). Source lives in `design-system/`, gets copied
into `site/design-system/` (and later `app/public/design-system/`) so it
actually deploys — Cloudflare only serves `site/`, not the repo root.

Brand rule for every component: minimal, premium, easy to use. Ink / white /
gray carry the interface; orange (`--uk-accent` / `#F25623`) marks only the
one active or important thing per component, never decoration. Soft quiet
elevation, thin 1px lines, short purposeful motion (150–280ms), no bounce.

## Status

- [x] **Group 1 — Navigation** (done, live on site + demo page)
  Accordion, Bento menu, Breadcrumb, Hamburger menu, Kebab menu, Meatballs
  menu, Tab/nav bar, Sidebar, Pagination, List of links.
  Demo: `design-system/nav-kit.html`. Live on site: Bento menu (homepage
  "What we build"), Accordion (contact page FAQ), Hamburger morph (all pages).

- [ ] **Group 2 — Input UI** (next up)
  Button, Checkbox, Dropdown, Input Field, Combobox, Multiselect, Date
  Picker, Form, Password Field, Radio Button, Slider Control, Stepper,
  Toggle, Picker, Search Field, Comment.

- [ ] **Group 3 — Feedback UI**
  Badge, Confirmation Dialog, Modal, Progress Bar, Toast Notification,
  Loader, Notification.

- [ ] **Group 4 — Display UI**
  Card, Charts, Icon, Feed, Tag, Widget, Carousel.

## Reference material the user shared for these

Sliders/range controls: labeled min/recommended/great slider, dot-step
progress, dual-handle range with value tags, waveform scrubber.
Dashboard cards, task-input bar, emoji rating row, pill segmented nav,
bento moodboard (dark code tile + orange accent tile), bold-numeral
calendar list, timeline/task modal, pill pagination/segmented controls,
mockup-portfolio hero, UI-pattern glossary reference.

## Process (repeat per group)

1. Add component CSS to `design-system/ui-kit.css` (namespaced `.uk-*`).
2. Add any interactive behavior to `design-system/ui-kit.js`.
3. Add a demo section to a showcase page (`nav-kit.html` pattern — maybe
   `input-kit.html`, `feedback-kit.html`, `display-kit.html` per group).
4. `cp -a design-system/. site/design-system/` so it deploys.
5. Wire real instances into actual site pages where they have a natural
   home (don't force-fit every component onto the 4-page marketing site —
   most of Input/Feedback belongs in the POS/CRM app once that UI exists).
6. Sync into `/home/user/auzslabs-infra` and push.

Paused after Group 1 per user request — resume with Group 2 (Input UI)
when asked.
