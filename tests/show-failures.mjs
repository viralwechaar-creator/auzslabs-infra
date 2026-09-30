// Prints the failures from the last test run (report/results.json).
import fs from 'node:fs';
const r = JSON.parse(fs.readFileSync(new URL('./report/results.json', import.meta.url), 'utf8'));
let n = 0;
for (const s of r.suites) for (const c of s.checks) if (c.ok === false) { n++; console.log(`[${c.sev.toUpperCase()}] ${s.name}\n  ${c.title}\n  ${String(c.error).split('\n')[0].slice(0, 220)}\n`); }
if (n === 0) console.log('No failures.');
