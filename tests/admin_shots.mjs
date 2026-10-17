// Real-browser screenshots of site/admin.html (the platform admin panel), at phone/tablet/desktop
// widths, for the Master Frontend Mission's Priority 4 (honest visual verification, not fabricated).
// Not a test: a before/after record. Usage: node admin_shots.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { chromium, launchOptions } from './lib/pw.mjs';
import { build, USERS, PASSWORD } from './lib/db.mjs';
import { startStack } from './lib/stack.mjs';
import { ROOT, newCtx } from './lib/common.mjs';

const out = path.resolve(process.argv[2] || path.join(ROOT, 'tests/report/admin-shots'));
fs.mkdirSync(out, { recursive: true });
const WIDTHS = [[390, 844, 'phone'], [768, 1024, 'tablet'], [1440, 900, 'desktop']];

await build(() => {});
const stack = await startStack();
const browser = await chromium.launch(launchOptions());

for (const [w, h, label] of WIDTHS) {
  const ctx = await newCtx(browser, stack, { w, h });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(stack.url('', '/admin.html'));
  await page.waitForTimeout(800);
  await page.fill('#email', USERS.admin);
  await page.fill('#password', PASSWORD);
  await page.click('#signin');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(out, `admin-${label}-dashboard.png`), fullPage: true });

  // Try to open a few more sections via their data-section nav button (sidebar on tablet/desktop,
  // tab bar on phone -- both carry the same data-section attribute per admin.html's own markup).
  for (const sec of ['clients', 'leads', 'pricing', 'users', 'team']) {
    const candidates = page.locator(`[data-section="${sec}"]`);
    const n = await candidates.count();
    let btn = null;
    for (let i = 0; i < n; i++) {
      if (await candidates.nth(i).isVisible()) { btn = candidates.nth(i); break; }
    }
    if (btn) {
      try {
        await btn.click({ timeout: 3000 });
        await page.waitForTimeout(1200);
        await page.screenshot({ path: path.join(out, `admin-${label}-${sec}.png`), fullPage: true });
      } catch (e) { errs.push(`click ${sec}: ${e}`); }
    }
  }
  if (errs.length) fs.writeFileSync(path.join(out, `admin-${label}-console-errors.txt`), errs.join('\n'));
  await ctx.close();
}
await browser.close();
await stack.stop();
console.log('Screenshots written to', out);
