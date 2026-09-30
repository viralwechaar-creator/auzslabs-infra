// Every marketing page and the main customer-facing tenant pages on 8 screen sizes.
import { suite, assert } from '../../lib/harness.mjs';
import { newCtx, sitePages, DEVICES, layoutIssues } from '../../lib/common.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Layout on phones, tablets and desktops', 'Each page opened at ' + DEVICES.map((d) => d.w + 'px').join(', ') + '; checks sideways scrolling and broken images; screenshots kept.');
  const targets = [
    ...sitePages().map((f) => ({ name: f, url: stack.url('', '/' + f) })),
    { name: 'salon-home', url: stack.url('testsalon', '/salon/') }, { name: 'salon-menu', url: stack.url('testsalon', '/salon/menu/') },
    { name: 'salon-admin-login', url: stack.url('testsalon', '/salon/admin/') },
    { name: 'cafe-qr-menu', url: stack.url('testcafe', '/site.html?t=T1') }, { name: 'pos-login', url: stack.url('testcafe', '/index.html') },
  ];
  for (const dev of DEVICES) {
    const ctx = await newCtx(browser, stack, dev); const page = await ctx.newPage();
    for (const t of targets) {
      await s.check(`${t.name} fits a ${dev.name} (${dev.w}px)`, async () => {
        await page.goto(t.url, { waitUntil: 'load' }); await page.waitForTimeout(450);
        const issues = await layoutIssues(page); assert(!issues.length, issues.join('; '));
      }, dev.w <= 430 ? 'major' : 'minor');
      if (['index.html', 'salon-home', 'cafe-qr-menu', 'pricing.html'].includes(t.name)) await s.shot(page, `${t.name} @ ${dev.name}`);
    }
    await ctx.close();
  }
  s.done();
}
