// Turns results into one readable HTML page (+ results.json). Open tests/report/index.html.
import fs from 'node:fs';
import path from 'node:path';
import { results, summary, REPORT_DIR } from './harness.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function verdict() {
  const s = summary();
  if (s.bySev.critical > 0) return { label: 'NOT READY', cls: 'bad', why: s.bySev.critical + ' critical issue(s) must be fixed before launch' };
  if (s.bySev.major > 0) return { label: 'ALMOST READY', cls: 'warn', why: s.bySev.major + ' major issue(s) to fix before launch' };
  if (s.bySev.minor > 0) return { label: 'READY (polish left)', cls: 'ok', why: s.bySev.minor + ' minor polish item(s)' };
  return { label: 'READY', cls: 'ok', why: 'Every automated check passed' };
}

export function writeReport() {
  const s = summary(), v = verdict(), secs = Math.round((Date.now() - results.startedAt) / 1000);
  fs.writeFileSync(path.join(REPORT_DIR, 'results.json'), JSON.stringify({ ...results, summary: s, verdict: v }, null, 1));
  const rows = results.suites.map((st) => {
    const f = st.checks.filter((c) => !c.ok), p = st.checks.length - f.length;
    const fails = f.map((c) => `<li class="${c.sev}"><b>${esc(c.sev)}</b> ${esc(c.title)}<br><code>${esc(c.error)}</code></li>`).join('');
    const passes = st.checks.filter((c) => c.ok).map((c) => `<li>${esc(c.title)}</li>`).join('');
    const shots = st.shots.map((x) => `<figure><a href="shots/${esc(x.file)}"><img loading="lazy" src="shots/${esc(x.file)}" alt=""></a><figcaption>${esc(x.label)}</figcaption></figure>`).join('');
    const notes = st.notes.map((n) => `<li>${esc(n)}</li>`).join('');
    return `<section><h2>${esc(st.name)} <span class="pill ${f.length ? 'bad' : 'ok'}">${p}/${st.checks.length} passed</span></h2>
<p class="d">${esc(st.description)}</p>${fails ? `<h3>Needs attention</h3><ul class="fails">${fails}</ul>` : ''}
${notes ? `<h3>Notes</h3><ul>${notes}</ul>` : ''}
<details><summary>${p} passed checks</summary><ul class="pass">${passes}</ul></details>
${shots ? `<details><summary>${st.shots.length} screenshots</summary><div class="shots">${shots}</div></details>` : ''}</section>`;
  }).join('\n');
  const html = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>AUZslab launch-readiness report</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#f4f4f2;color:#171717}main{max-width:1100px;margin:0 auto;padding:24px}
.top{background:#fff;border-radius:16px;padding:22px 26px;margin-bottom:18px;box-shadow:0 1px 3px #0002}.v{font-size:34px;font-weight:700;margin:4px 0}
.v.ok{color:#1f6b3a}.v.warn{color:#9a6700}.v.bad{color:#a11}.stats{display:flex;gap:24px;flex-wrap:wrap;margin-top:10px}.stats b{font-size:22px;display:block}
section{background:#fff;border-radius:14px;padding:16px 22px;margin-bottom:14px;box-shadow:0 1px 3px #0002}h2{margin:0;font-size:19px}h3{font-size:14px;margin:14px 0 4px;text-transform:uppercase;letter-spacing:.06em}
.d{color:#666;margin:2px 0 6px}.pill{font-size:12px;padding:3px 10px;border-radius:99px;vertical-align:middle;color:#fff}.pill.ok{background:#2a8a4f}.pill.bad{background:#b3261e}
ul{margin:4px 0 4px 18px;padding:0}li{margin:5px 0}.fails li{list-style:none;margin-left:-18px;padding:8px 12px;border-left:4px solid #b3261e;background:#fdf1f0;border-radius:6px}
.fails li.major{border-color:#d68a00;background:#fff7e6}.fails li.minor{border-color:#999;background:#f3f3f3}.fails b{text-transform:uppercase;font-size:11px;margin-right:6px}
code{font-size:12.5px;color:#555;white-space:pre-wrap}.pass{columns:2;font-size:13px;color:#444}.shots{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px}
figure{margin:0;width:150px}figure img{width:150px;border:1px solid #ddd;border-radius:6px}figcaption{font-size:11px;color:#555}summary{cursor:pointer;color:#333;margin-top:8px}</style>
<main><div class=top><div>AUZslab launch-readiness report &middot; ${esc(results.mode)} &middot; ${new Date(results.startedAt).toLocaleString()} &middot; ${secs}s</div>
<div class="v ${v.cls}">${v.label}</div><div>${esc(v.why)}</div>
<div class=stats><div><b>${s.pass}</b>passed</div><div><b>${s.fail}</b>failed</div><div><b>${s.bySev.critical}</b>critical</div><div><b>${s.bySev.major}</b>major</div><div><b>${s.bySev.minor}</b>minor</div></div></div>
${rows}</main>`;
  fs.writeFileSync(path.join(REPORT_DIR, 'index.html'), html);
  return path.join(REPORT_DIR, 'index.html');
}
