// Option A: builds an isolated test copy (DB + API + web), runs every suite, writes tests/report/index.html
import { chromium, launchOptions } from './lib/pw.mjs';
import { reset } from './lib/harness.mjs';
import { build } from './lib/db.mjs';
import { startStack } from './lib/stack.mjs';
import { writeReport, verdict, printFailures } from './lib/report.mjs';
import { summary } from './lib/harness.mjs';

const only = process.argv[2];
const suites = ['marketing', 'responsive', 'journeys', 'salon', 'cafe', 'pos', 'apps', 'accounts', 'payroll', 'mobile', 'offline', 'accoffline', 'docread', 'dpdp', 'signup', 'design', 'security', 'load', 'loadmob'];
reset('local test copy');
console.log('Building test database...'); await build(console.log);
const stack = await startStack({ log: console.log });
const browser = await chromium.launch(launchOptions());
const t0 = Date.now();
for (const name of suites) {
  if (only ? only !== name : name === 'loadmob') continue; // loadmob only runs when named (it is heavy)
  process.stdout.write('Running ' + name + '... ');
  try { const mod = await import('./suites/local/' + name + '.mjs'); await mod.default({ browser, stack }); console.log('done'); }
  catch (e) { console.log('CRASHED: ' + e.message); const { suite } = await import('./lib/harness.mjs'); const s = suite(name + ' (suite crashed)'); await s.check('suite ran to the end', () => { throw e; }, 'critical'); }
}
await browser.close(); await stack.stop();
printFailures();
const file = writeReport(); const v = verdict(), s = summary();
console.log(`\n${v.label}: ${s.pass} passed, ${s.fail} failed (${s.bySev.critical} critical, ${s.bySev.major} major, ${s.bySev.minor} minor) in ${Math.round((Date.now() - t0) / 1000)}s\nReport: ${file}`);
process.exit(s.bySev.critical || s.bySev.major ? 1 : 0);
