// Finds Playwright: a normal `npm install` in tests/ first, then a global install.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const roots = [path.join(here, '..'), '/opt/node22/lib/node_modules', '/usr/lib/node_modules', '/usr/local/lib/node_modules'];
let pw = null;
for (const r of roots) {
  try { pw = createRequire(path.join(r, 'x.js'))('playwright'); break; } catch { /* try next */ }
}
if (!pw) throw new Error('Playwright not found. Run `npm install` in tests/ (then `npx playwright install chromium`).');

export const { chromium } = pw;
export function launchOptions() {
  const exe = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  return exe ? { executablePath: exe } : {};
}
