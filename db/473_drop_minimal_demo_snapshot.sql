-- Reverts db/472. The owner's actual, repeatedly-confirmed ask turned out to be simpler than a permanent
-- frozen copy: Minimal should show exactly what Classic already correctly shows (the real, live demo
-- account), not a separately-maintained snapshot that can drift out of sync with it -- which is exactly what
-- happened the moment this shipped (the frozen copy predated a same-day fix to how the live path resolves
-- the demo account, so it was already stale on arrival). app/public/store/store.js no longer calls
-- public_frozen_theme_demo; drop it and the table it read from.
drop function if exists public_frozen_theme_demo(text);
drop table if exists sfx_frozen_theme_demos;
