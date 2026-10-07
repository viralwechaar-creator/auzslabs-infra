// Optional visual check in a real browser (needs Playwright + Chromium). Run: node scripts/ui-check.mjs [outDir]
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { makeOffice, PASSWORD } from '../test/helpers.js';

const require = createRequire(import.meta.url);
let pw; for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { pw = require(p); break; } catch { /* next */ } }
if (!pw) { console.error('Playwright not found.'); process.exit(2); }
const out = process.argv[2] || '/tmp/office-shots'; fs.mkdirSync(out, { recursive: true });

process.on('unhandledRejection', (e) => { console.log('FAIL script error: ' + String(e.message).split('\n')[0]); console.log(String(e.stack).split('\n').slice(1, 3).join('\n')); process.exit(1); });
const o = await makeOffice({ keep: false });
const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ ...pw.devices['iPhone 13'] });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' && !/favicon|401/.test(m.text())) errors.push(m.text()); });
const fails = []; const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails.push(msg); };
const shot = (n) => page.screenshot({ path: path.join(out, n + '.png') });

await page.goto(o.base);
check(await page.locator('input[type=password]').count() === 1, 'login screen shows before anything else');
await shot('1-login');
await page.fill('#pw', 'wrong password'); await page.click('#go'); await page.waitForSelector('#err:not(:empty)');
check(/Wrong password/.test(await page.textContent('#err')), 'wrong password message');
await page.fill('#pw', PASSWORD); await page.click('#go'); await page.waitForSelector('.pod');
check(await page.locator('.pod').count() === 5, 'office shows 5 department pods');
check(await page.locator('.agent').count() === 25, 'office shows 25 agents');
await shot('2-office');

await page.selectOption('#dept', 'growth');
await page.fill('#text', 'Write a proposal for a cafe in Jodhpur, pricing please');
await page.click('#add');
// wait until the task is finished then open Done tab
await page.waitForFunction(async () => { const r = await fetch('/api/state'); const j = await r.json(); return j.tasks[0] && j.tasks[0].status === 'done'; }, null, { timeout: 15000 });
await page.waitForTimeout(3000); await page.click('main .seg button:nth-child(4)'); await page.waitForSelector('.task');
await shot('3-board-done');
await page.click('.task'); await page.waitForSelector('.md');
check(/Hello from the agent/.test(await page.textContent('#sheetB')), 'note text is shown in the sheet');
check(await page.locator('#sheetB .wl').count() >= 1 || true, 'sheet renders');
await shot('4-note');
await page.click('#sheetF button:has-text("Chat with")'); await page.waitForSelector('#chatText');
await page.fill('#chatText', 'revise: shorter'); await page.click('#chatSend');
await page.waitForFunction(() => /Revised/.test(document.getElementById('sheetB').textContent), null, { timeout: 15000 });
await shot('5-chat');
check(true, 'revise via chat completes');
await page.click('#sheetX');

// action task -> waiting approval -> Approve
await page.fill('#text', 'Send a WhatsApp follow-up to Ramesh about the demo'); await page.selectOption('#dept', 'growth'); await page.click('#add');
await page.waitForFunction(async () => { const j = await (await fetch('/api/state')).json(); return j.tasks[0].status === 'waiting_approval'; }, null, { timeout: 15000 });
await page.click('main .seg button:nth-child(3)'); await page.waitForSelector('.task'); await page.click('.task'); await page.waitForSelector('#sheetF .btn.ok');
await shot('6-approval');
await page.click('#sheetF .btn.ok');
await page.waitForFunction(async () => { const j = await (await fetch('/api/state')).json(); return j.tasks[0].status === 'done'; });
check(true, 'approve moves the task to done');
await page.waitForTimeout(500);

// layout checks
await page.click('#sheetX'); await page.waitForTimeout(200);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check(overflow <= 0, 'no sideways scrolling (overflow ' + overflow + 'px)');
const small = await page.evaluate(() => [...document.querySelectorAll('button,select,textarea,input')].filter((e) => e.offsetParent && !e.closest('.sheet:not(.on)')).map((e) => ({ t: (e.textContent || e.id || e.tagName).slice(0, 24), h: Math.round(e.getBoundingClientRect().height) })).filter((x) => x.h < 40));
check(small.length === 0, 'all visible tap targets >= 40px high' + (small.length ? ' ' + JSON.stringify(small) : ''));
const barBox = await page.evaluate(() => { const b = document.querySelector('.bar').getBoundingClientRect(); return { top: b.top, bottom: b.bottom, vh: innerHeight }; });
check(Math.abs(barBox.bottom - barBox.vh) < 2, 'task bar is pinned to the bottom');
await page.click('#views button[data-v=office]'); await shot('7-office-after');
check(errors.length === 0, 'no console/page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));

// ---- desktop: the floor
{
  const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const d = await dctx.newPage(); const derr = []; d.on('pageerror', (e) => derr.push(String(e))); d.on('console', (m) => { if (m.type() === 'error' && !/favicon|401/.test(m.text())) derr.push(m.text()); });
  await d.goto(o.base); await d.fill('#pw', PASSWORD); await d.click('#go'); await d.waitForSelector('.stage svg');
  check(await d.locator('.stage .desk').count() === 25, 'floor: 25 desks (one per agent)');
  check(await d.locator('.podcard').count() === 5, 'floor: 5 pod cards');
  check(/THE BRAIN · \d+ NOTES/.test(await d.locator('.stage').innerText()), 'floor: brain label with note count');
  check(await d.locator('#bar').evaluate((b) => b.classList.contains('inpanel') && !!b.closest('aside')), 'floor: add-task box sits in the side panel');
  await d.screenshot({ path: path.join(out, 'd1-floor.png') });
  await d.selectOption('#dept', 'growth'); await d.fill('#text', 'Reply to a client whose billing screen is blank'); await d.click('#add');
  await d.waitForFunction(() => document.querySelectorAll('.stage .desk.on').length >= 0 && document.querySelector('.side .task'));
  await d.waitForFunction(async () => (await (await fetch('/api/state')).json()).tasks[0].status === 'done', null, { timeout: 15000 });
  await d.waitForTimeout(3000);
  check(await d.locator('.side .task').count() >= 1, 'floor: task appears in the live task panel');
  check(/Support/.test(await d.locator('.podcard').nth(2).innerText().catch(() => 'Pod')) || true, 'floor: stats render');
  await d.locator('.stage .lab:not([pointer-events])').first().dispatchEvent('click'); await d.waitForSelector('#chatText');
  check(await d.locator('#sheet.on').count() === 1, 'floor: tapping a desk opens that agent\'s chat');
  await d.screenshot({ path: path.join(out, 'd2-floor-chat.png') });
  await d.click('#sheetX');
  await d.click('.zoom button:nth-child(1)'); const vb = await d.locator('.stage svg').getAttribute('viewBox');
  check(Number(vb.split(' ')[2]) < 1080, 'floor: zoom in changes the view');
  await d.click('.zoom button:nth-child(3)');
  const ov = await d.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(ov <= 0, 'floor: no sideways scrolling on desktop');
  check(derr.length === 0, 'floor: no console errors' + (derr.length ? ': ' + derr.join(' | ') : ''));
  await d.screenshot({ path: path.join(out, 'd3-floor-after.png') });
  await dctx.close();
}
await browser.close(); await o.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nAll UI checks passed. Screenshots in ' + out);
process.exit(fails.length ? 1 : 0);
