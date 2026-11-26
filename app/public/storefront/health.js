// Website health card on Home: runs light checks in the browser and fills the card in.
const ms = (n) => (n < 1000 ? Math.round(n) + ' ms' : (n / 1000).toFixed(1) + ' s');
const set = (host, k, text, tone) => { const el = host.querySelector('[data-hc="' + k + '"]'); if (el) { el.textContent = text; el.dataset.tone = tone || ''; } };
export function mountHealth(host) {
  let cfg = {}; try { cfg = JSON.parse(host.dataset.health || '{}'); } catch {}
  const tones = {};
  const rate = (k, text, tone) => { tones[k] = tone; set(host, k, text, tone); finish(); };
  const finish = () => {
    const list = Object.values(tones); if (list.length < 4) return;
    const el = host.querySelector('[data-hc-overall]'), bad = list.includes('bad'), warn = list.includes('warn');
    el.textContent = bad ? 'Needs attention' : warn ? 'Okay, could be faster' : 'Healthy'; el.dataset.tone = bad ? 'bad' : warn ? 'warn' : 'ok';
  };
  host.querySelectorAll('[data-hc-size]').forEach((b) => b.addEventListener('click', () => {
    host.querySelectorAll('[data-hc-size]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    host.querySelector('[data-hc-frame]').className = 'hc-frame ' + b.dataset.hcSize;
  }));
  rate('live', cfg.live ? 'Published' : 'Not published', cfg.live ? 'ok' : 'warn');
  rate('pay', cfg.pay ? 'Connected' : 'Not connected', cfg.pay ? 'ok' : 'warn');
  if (cfg.url) {
    const t0 = performance.now();
    fetch(cfg.url, { mode: 'no-cors', cache: 'no-store' }).then(() => { const t = performance.now() - t0; rate('resp', ms(t), t < 1200 ? 'ok' : t < 3000 ? 'warn' : 'bad'); }).catch(() => rate('resp', 'Not reachable', 'bad'));
  } else rate('resp', 'No store address', 'warn');
  const imgs = [...host.querySelectorAll('[data-hc-img]')];
  if (!imgs.length) { rate('img', 'No pictures to test', 'warn'); return; }
  let done = 0, ok = 0, total = 0;
  imgs.forEach((im) => {
    const t0 = performance.now(), fin = (good) => { done++; if (good) { ok++; total += performance.now() - t0; } if (done === imgs.length) { const avg = ok ? total / ok : 0; rate('img', ok + ' of ' + imgs.length + ' loaded' + (ok ? ' · ' + ms(avg) : ''), ok < imgs.length ? 'bad' : avg > 1500 ? 'warn' : 'ok'); } };
    if (im.complete) fin(im.naturalWidth > 0); else { im.addEventListener('load', () => fin(true)); im.addEventListener('error', () => fin(false)); }
  });
}
