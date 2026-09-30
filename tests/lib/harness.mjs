// A very small test harness: suites hold checks; every check records pass/fail + severity.
// Nothing here stops at the first failure, so one run shows *everything* that is wrong.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPORT_DIR = path.join(here, '..', 'report');
export const results = { mode: '', startedAt: Date.now(), suites: [] };

export function reset(mode) {
  results.mode = mode; results.startedAt = Date.now(); results.suites = [];
  fs.rmSync(REPORT_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(REPORT_DIR, 'shots'), { recursive: true });
}

// severity: 'critical' = cannot launch with it, 'major' = fix before launch, 'minor' = polish
export function suite(name, description = '') {
  const s = { name, description, checks: [], shots: [], notes: [], startedAt: Date.now(), ms: 0 };
  results.suites.push(s);
  const api = {
    async check(title, fn, sev = 'major') {
      try { await fn(); s.checks.push({ title, ok: true, sev }); }
      catch (e) { s.checks.push({ title, ok: false, sev, error: String((e && e.message) || e).slice(0, 600) }); }
    },
    note(msg) { s.notes.push(msg); },
    async shot(page, label) {
      try {
        const file = (name + '__' + label).replace(/[^a-z0-9_.-]+/gi, '_').slice(0, 120) + '.png';
        await page.screenshot({ path: path.join(REPORT_DIR, 'shots', file), fullPage: false });
        s.shots.push({ label, file });
      } catch { /* a screenshot must never fail a test */ }
    },
    done() { s.ms = Date.now() - s.startedAt; },
  };
  return api;
}

export const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

// Errors a real visitor would hit. Fonts/CDN scripts are ignored because the test box may be offline.
const IGNORE_HOSTS = /wss?:\/\/api\.auzslab\.in\/ws|fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|google-analytics|googletagmanager/;
export function watch(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('JS error: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (IGNORE_HOSTS.test(t) || /Failed to load resource|ERR_CERT|ERR_NAME_NOT_RESOLVED|ERR_FAILED|net::ERR_/.test(t)) return;
    errors.push('console.error: ' + t.slice(0, 200));
  });
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (IGNORE_HOSTS.test(u) || /^data:|^blob:/.test(u)) return;
    errors.push('request failed: ' + u.slice(0, 120) + ' (' + (r.failure() && r.failure().errorText) + ')');
  });
  page.on('response', (r) => {
    const u = r.url(), s = r.status();
    if (s >= 400 && !IGNORE_HOSTS.test(u) && !/favicon|\/sw\.js|manifest/.test(u)) errors.push('HTTP ' + s + ': ' + u.slice(0, 120) + ' (loaded by page ' + page.url().slice(0, 80) + ')');
  });
  return errors;
}

export function summary() {
  let pass = 0, fail = 0; const bySev = { critical: 0, major: 0, minor: 0 };
  for (const s of results.suites) for (const c of s.checks) { if (c.ok) pass++; else { fail++; bySev[c.sev]++; } }
  return { pass, fail, bySev, total: pass + fail };
}
