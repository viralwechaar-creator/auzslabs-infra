// Live View globe and map. One canvas, no libraries. Dotted land from a 1-degree mask, visitors as pulsing dots.
// Globe: drag to turn it, scroll or pinch to zoom, arrow keys and + / - also work. Map: drag to pan, scroll or pinch to zoom.
import { LAND, TZ } from './globe-data.js?v=1';

const RAD = Math.PI / 180;
const mask = (() => { const bin = atob(LAND); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; })();
const isLand = (lat, lng) => { const x = Math.min(359, Math.max(0, Math.floor(lng + 180))), y = Math.min(179, Math.max(0, Math.floor(90 - lat))); const i = y * 360 + x; return (mask[i >> 3] >> (i & 7)) & 1; };

// land dots: even spacing on the sphere (rows every STEP degrees, columns widened toward the poles)
const STEP = 1.7;
const DOTS = [];
for (let lat = -84; lat <= 84; lat += STEP) {
  const c = Math.cos(lat * RAD), n = Math.max(1, Math.round(360 * c / STEP)), off = ((Math.round((lat + 90) / STEP) % 2) ? 0.5 : 0) * (360 / n);
  for (let k = 0; k < n; k++) { const lng = -180 + off + k * 360 / n; if (isLand(lat, lng)) DOTS.push([lat * RAD, lng * RAD, lat, lng]); }
}

let SAVED = null; // keeps the view when the dashboard redraws after a data refresh
export function mountGlobe(host, zones, opts = {}) {
  if (!host || host.dataset.mounted === '1') return null;
  host.dataset.mounted = '1';
  const dark = (opts.theme || 'light') === 'dark';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const zonePts = Object.entries(zones || {}).filter(([z]) => TZ[z]).map(([z, n]) => ({ z, n, lat: TZ[z][0], lng: TZ[z][1] }));
  const shared = (opts.points || []).map((p) => ({ z: 'Shared location', n: p.n, lat: Number(p.lat), lng: Number(p.lng) }));
  const pts = shared.concat(zonePts);
  const unknown = Object.values(zones || {}).reduce((s, n) => s + n, 0) - zonePts.reduce((s, p) => s + p.n, 0);

  host.innerHTML = '<div class="gl-wrap"><canvas class="gl-canvas" tabindex="0" role="img" aria-label="Live visitors on an interactive globe. Drag to turn, scroll or pinch to zoom."></canvas>' +
    '<div class="gl-legend"><span><i class="gl-dot gl-v"></i>Visitors right now</span></div>' +
    '<div class="gl-tools"><button type="button" class="gl-btn" data-g="toggle" aria-label="Switch between globe and map" title="Globe / map"></button><button type="button" class="gl-btn" data-g="in" aria-label="Zoom in">+</button><button type="button" class="gl-btn" data-g="out" aria-label="Zoom out">−</button><button type="button" class="gl-btn" data-g="reset" aria-label="Reset view" title="Reset">↺</button></div>' +
    '<div class="gl-tip" hidden></div><div class="gl-note"></div></div>';
  const cv = host.querySelector('canvas'), ctx = cv.getContext('2d'), tip = host.querySelector('.gl-tip'), note = host.querySelector('.gl-note'), tbtn = host.querySelector('[data-g=toggle]');
  note.textContent = pts.length ? '' : (unknown ? 'Visitors are online, but their browsers did not share a location.' : 'No visitors right now. Dots appear here as people open your store.');
  if (pts.length && unknown > 0) note.textContent = unknown + ' visitor' + (unknown === 1 ? '' : 's') + ' without a known location are not drawn.';

  // view state
  let mode = 'globe';
  const home = pts.length ? { lat: pts[0].lat, lng: pts[0].lng } : { lat: 20, lng: 78 };
  const g = { lat: home.lat * RAD, lng: home.lng * RAD, zoom: 1, vlat: 0, vlng: 0 };
  const m = { cx: home.lng, cy: home.lat, zoom: 1 };
  let W = 0, H = 0, R = 0, dpr = 1, auto = !reduce, drag = null, t0 = performance.now(), raf = 0, alive = true;
  if (SAVED) { mode = SAVED.mode; Object.assign(g, SAVED.g); Object.assign(m, SAVED.m); auto = false; }
  const pointers = new Map(); let pinch = 0;

  const col = dark
    ? { sphereA: '#16233b', sphereB: '#0b1220', land: [120, 220, 190], rim: 'rgba(120,180,255,.25)', glow: 'rgba(80,160,255,.18)', grid: 'rgba(255,255,255,.05)', bg: '#101a2c' }
    : { sphereA: '#e7f1fb', sphereB: '#cfe0f5', land: [74, 196, 170], rim: 'rgba(80,120,200,.18)', glow: 'rgba(120,200,255,.28)', grid: 'rgba(0,0,0,.04)', bg: '#f1f6fc' };

  function size() {
    const r = host.querySelector('.gl-wrap').getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(280, Math.round(r.width)); H = mode === 'globe' ? Math.min(W, 640) : Math.round(Math.min(W * 0.55, 560));
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px';
    R = Math.min(W, H) * 0.44;
  }

  // ---- globe ----
  function projG(latR, lngR) {
    const dl = lngR - g.lng, cl = Math.cos(dl), cp = Math.cos(latR), sp = Math.sin(latR), cp0 = Math.cos(g.lat), sp0 = Math.sin(g.lat);
    const depth = sp0 * sp + cp0 * cp * cl;
    return { x: W / 2 + R * g.zoom * cp * Math.sin(dl), y: H / 2 - R * g.zoom * (cp0 * sp - sp0 * cp * cl), depth };
  }
  function drawGlobe(time) {
    const Rz = R * g.zoom, cx = W / 2, cy = H / 2;
    const glow = ctx.createRadialGradient(cx, cy, Rz * 0.9, cx, cy, Rz * 1.25); glow.addColorStop(0, col.glow); glow.addColorStop(1, dark ? 'rgba(80,160,255,0)' : 'rgba(120,200,255,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    const sg = ctx.createRadialGradient(cx - Rz * 0.35, cy - Rz * 0.4, Rz * 0.1, cx, cy, Rz); sg.addColorStop(0, col.sphereA); sg.addColorStop(1, col.sphereB);
    ctx.beginPath(); ctx.arc(cx, cy, Rz, 0, Math.PI * 2); ctx.fillStyle = sg; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = col.rim; ctx.stroke();
    const base = Math.max(0.9, Rz / 150);
    for (let i = 0; i < DOTS.length; i++) {
      const d = DOTS[i], p = projG(d[0], d[1]);
      if (p.depth <= 0.02) continue;
      const a = Math.min(1, 0.25 + p.depth * 0.9), r = base * (0.55 + p.depth * 0.5);
      ctx.fillStyle = 'rgba(' + col.land[0] + ',' + col.land[1] + ',' + col.land[2] + ',' + a.toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.2832); ctx.fill();
    }
    markers(time, (p) => projG(p.lat * RAD, p.lng * RAD), (q) => q.depth > 0.05);
  }

  // ---- flat map ----
  const mx = (lng) => W / 2 + (lng - m.cx) * (W / 360) * m.zoom;
  const my = (lat) => H / 2 - (lat - m.cy) * (W / 360) * m.zoom;
  function drawMap(time) {
    ctx.fillStyle = col.bg; ctx.fillRect(0, 0, W, H);
    const k = (W / 360) * m.zoom, dotR = Math.max(0.8, k * STEP * 0.32), stepLng = 1.7;
    ctx.fillStyle = 'rgb(' + col.land[0] + ',' + col.land[1] + ',' + col.land[2] + ')';
    for (let lat = -84; lat <= 84; lat += STEP) {
      const y = my(lat); if (y < -6 || y > H + 6) continue;
      const off = ((Math.round((lat + 90) / STEP) % 2) ? 0.5 : 0) * stepLng;
      for (let lng = -180 + off; lng < 180; lng += stepLng) {
        if (!isLand(lat, lng)) continue;
        // wrap horizontally so the map repeats when panned
        let x = mx(lng); const span = 360 * k; x = ((x % span) + span) % span;
        for (let xx = x - span; xx < W + 6; xx += span) { if (xx < -6) continue; ctx.beginPath(); ctx.arc(xx, y, dotR, 0, 6.2832); ctx.fill(); }
      }
    }
    markers(time, (p) => { const span = 360 * k; let x = mx(p.lng); x = ((x % span) + span) % span; if (x > W + 20 && x - span > -20) x -= span; return { x, y: my(p.lat), depth: 1 }; }, () => true);
  }

  // ---- markers (shared) ----
  let hits = [];
  function markers(time, project, visible) {
    hits = [];
    for (const p of pts) {
      const q = project(p); if (!visible(q)) continue;
      const base = 5 + Math.min(9, Math.sqrt(p.n) * 2.2), pulse = (time / 1400 + p.lng / 90) % 1;
      ctx.beginPath(); ctx.arc(q.x, q.y, base + pulse * 14, 0, 6.2832); ctx.strokeStyle = 'rgba(37,150,235,' + (0.45 * (1 - pulse)).toFixed(2) + ')'; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(q.x, q.y, base, 0, 6.2832); ctx.fillStyle = '#2596eb'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = dark ? '#0b1220' : '#fff'; ctx.stroke();
      hits.push({ x: q.x, y: q.y, r: base + 8, p });
    }
  }

  function frame(now) {
    if (!alive) return;
    if (!host.isConnected) { alive = false; return; }
    const dt = Math.min(48, now - t0); t0 = now; SAVED = { mode, g: { lat: g.lat, lng: g.lng, zoom: g.zoom, vlat: 0, vlng: 0 }, m: { cx: m.cx, cy: m.cy, zoom: m.zoom } };
    if (mode === 'globe') {
      if (!drag && (Math.abs(g.vlng) > 1e-5 || Math.abs(g.vlat) > 1e-5)) { g.lng += g.vlng * dt; g.lat = Math.max(-1.35, Math.min(1.35, g.lat + g.vlat * dt)); g.vlng *= 0.94; g.vlat *= 0.94; }
      else if (auto && !drag) g.lng += 0.00005 * dt;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    if (mode === 'globe') drawGlobe(now); else drawMap(now);
    raf = reduce && !drag && Math.abs(g.vlng) < 1e-5 ? 0 : requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

  // ---- input ----
  const clampZoom = () => { if (mode === 'globe') g.zoom = Math.max(0.7, Math.min(5, g.zoom)); else { m.zoom = Math.max(1, Math.min(14, m.zoom)); m.cy = Math.max(-70, Math.min(80, m.cy)); } };
  const zoomBy = (f) => { if (mode === 'globe') g.zoom *= f; else m.zoom *= f; clampZoom(); kick(); };
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); auto = false; tip.hidden = true;
    if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, moved: 0 }; if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); drag = null; } g.vlng = g.vlat = 0; kick(); });
  cv.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId); if (!prev) { hover(e); return; }
    const cur = { x: e.clientX, y: e.clientY }; pointers.set(e.pointerId, cur);
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch) zoomBy(d / pinch); pinch = d; return; }
    if (!drag) return; const dx = cur.x - prev.x, dy = cur.y - prev.y; drag.moved += Math.abs(dx) + Math.abs(dy);
    if (mode === 'globe') { const k = 1 / (R * g.zoom); g.lng -= dx * k; g.lat = Math.max(-1.35, Math.min(1.35, g.lat + dy * k)); g.vlng = -dx * k / 16; g.vlat = dy * k / 16; }
    else { const k = 360 / (W * m.zoom); m.cx -= dx * k; m.cy = Math.max(-70, Math.min(80, m.cy + dy * k)); }
    kick();
  });
  const up = (e) => { const was = drag; pointers.delete(e.pointerId); if (pointers.size < 2) pinch = 0; if (!pointers.size) { drag = null; if (was && was.moved < 6) tap(e); } };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', (e) => { e.preventDefault(); auto = false; zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
  cv.addEventListener('keydown', (e) => {
    const s = 0.12 / g.zoom; auto = false;
    if (e.key === '+' || e.key === '=') zoomBy(1.2); else if (e.key === '-') zoomBy(1 / 1.2);
    else if (e.key === 'ArrowLeft') { mode === 'globe' ? g.lng -= s : m.cx -= 12 / m.zoom; } else if (e.key === 'ArrowRight') { mode === 'globe' ? g.lng += s : m.cx += 12 / m.zoom; }
    else if (e.key === 'ArrowUp') { mode === 'globe' ? g.lat = Math.min(1.35, g.lat + s) : m.cy += 8 / m.zoom; } else if (e.key === 'ArrowDown') { mode === 'globe' ? g.lat = Math.max(-1.35, g.lat - s) : m.cy -= 8 / m.zoom; }
    else return; e.preventDefault(); kick();
  });
  function hitAt(e) { const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; return hits.find((h) => (h.x - x) ** 2 + (h.y - y) ** 2 <= h.r * h.r); }
  function showTip(h) { if (!h) { tip.hidden = true; return; } tip.hidden = false; tip.textContent = h.p.n + ' visitor' + (h.p.n === 1 ? '' : 's') + ' · ' + (h.p.z === 'Shared location' ? 'shared their location' : h.p.z.split('/').pop().replace(/_/g, ' ')); tip.style.left = Math.min(W - 150, Math.max(8, h.x + 10)) + 'px'; tip.style.top = Math.max(8, h.y - 36) + 'px'; }
  function hover(e) { if (e.pointerType === 'mouse') showTip(hitAt(e)); }
  function tap(e) { showTip(hitAt(e)); }

  host.querySelector('.gl-tools').addEventListener('click', (e) => {
    const b = e.target.closest('[data-g]'); if (!b) return; auto = false;
    if (b.dataset.g === 'in') zoomBy(1.3); else if (b.dataset.g === 'out') zoomBy(1 / 1.3);
    else if (b.dataset.g === 'reset') { g.lat = home.lat * RAD; g.lng = home.lng * RAD; g.zoom = 1; m.cx = home.lng; m.cy = home.lat; m.zoom = 1; auto = !reduce; kick(); }
    else if (b.dataset.g === 'toggle') { mode = mode === 'globe' ? 'map' : 'globe'; label(); size(); tip.hidden = true; kick(); }
  });
  function label() { tbtn.innerHTML = mode === 'globe'
    ? '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M2.5 4.5l5-1.5 5 1.5 5-1.5v12l-5 1.5-5-1.5-5 1.5z"/><path d="M7.5 3v12.5M12.5 4.5V17"/></svg>'
    : '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10" cy="10" r="7.2"/><path d="M2.8 10h14.4M10 2.8c2.4 2.2 2.4 12.2 0 14.4M10 2.8c-2.4 2.2-2.4 12.2 0 14.4"/></svg>';
    tbtn.title = mode === 'globe' ? 'Switch to map' : 'Switch to globe'; cv.setAttribute('aria-label', mode === 'globe' ? 'Live visitors on an interactive globe. Drag to turn, scroll or pinch to zoom.' : 'Live visitors on a world map. Drag to pan, scroll or pinch to zoom.'); }
  label(); size();
  const ro = new ResizeObserver(() => { size(); kick(); }); ro.observe(host.querySelector('.gl-wrap'));
  raf = requestAnimationFrame(frame);
  return { destroy() { alive = false; ro.disconnect(); cancelAnimationFrame(raf); } };
}
