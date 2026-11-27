// Home overview (desktop): one line to pick the period and channel, four figures with tiny trends and a live
// visitors figure. Pointing at a figure opens its report: a line chart of this period against the one before.
import { state, money, esc, pathFor } from './ecosystem.js';

const CHANNELS = [['all', 'All channels'], ['online', 'Online store'], ['instore', 'AUZsStyle shop'], ['other', 'Other']];
const PERIODS = [['7', 'Last 7 days'], ['14', 'Last 14 days'], ['30', 'Last 30 days']];
const hm = { period: '30', channel: 'all' };
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });
const dayOf = (offset) => dayFmt.format(new Date(Date.now() - offset * 86400000));
const short = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
const long = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });

// per-day numbers for the last 2N days, oldest first
function series() {
  const n = Number(hm.period), days = []; for (let i = 2 * n - 1; i >= 0; i--) days.push(dayOf(i));
  const v = state.visitors60 && !state.visitors60.error ? state.visitors60 : null, byDay = new Map(((v && v.series) || []).map((r) => [r.day, r]));
  const online = hm.channel === 'all' || hm.channel === 'online';
  const orders = (state.orders || []).filter((o) => !o.isTest && o.status !== 'Cancelled' && (hm.channel === 'all' || (hm.channel === 'online' && o.channel === 'Online store') || (hm.channel === 'instore' && o.channel === 'In-store')));
  const sales = new Map(), count = new Map();
  orders.forEach((o) => { count.set(o.date, (count.get(o.date) || 0) + 1); if (o.payment === 'Paid') sales.set(o.date, (sales.get(o.date) || 0) + Number(o.total) - Number(o.refunded || 0)); });
  const rows = days.map((d) => { const r = byDay.get(d) || {}; return { d, sessions: online ? Number(r.visitors || 0) : 0, ordered: online ? Number(r.ordered || 0) : 0, sales: sales.get(d) || 0, orders: count.get(d) || 0 }; });
  return { n, rows, tracked: !!v };
}
const sum = (rows, k) => rows.reduce((t, r) => t + r[k], 0);
function metrics() {
  const { n, rows, tracked } = series(), prev = rows.slice(0, n), cur = rows.slice(n);
  const rate = (r) => { const s = sum(r, 'sessions'); return s ? sum(r, 'ordered') / s * 100 : 0; };
  const dailyRate = (r) => r.sessions ? r.ordered / r.sessions * 100 : 0;
  const def = [
    ['sessions', 'Sessions', (r) => r.sessions, (rs) => sum(rs, 'sessions'), (x) => String(Math.round(x)), 'Number of user sessions in your online store', 'Sessions over time'],
    ['sales', 'Total sales', (r) => r.sales, (rs) => sum(rs, 'sales'), (x) => money(x), 'Paid orders, after refunds', 'Total sales over time'],
    ['orders', 'Orders', (r) => r.orders, (rs) => sum(rs, 'orders'), (x) => String(Math.round(x)), 'Orders placed, not counting cancelled or test orders', 'Orders over time'],
    ['conversion', 'Conversion rate', dailyRate, rate, (x) => (Math.round(x * 100) / 100) + '%', 'Percentage of online store sessions that result in a sale', 'Conversion rate over time'],
  ];
  return def.map(([key, label, day, agg, fmt, desc, title]) => ({ key, label, fmt, desc, title, value: agg(cur), before: agg(prev), cur: cur.map(day), prev: prev.map(day), curDays: cur.map((r) => r.d), prevDays: prev.map((r) => r.d), tracked }));
}
const spark = (vals) => { const peak = Math.max(1, ...vals), pts = vals.map((v, i) => (i * 36 / Math.max(vals.length - 1, 1)).toFixed(1) + ',' + (13 - 12 * v / peak).toFixed(1)).join(' '); return '<svg class="hm-spark" viewBox="0 0 36 14" aria-hidden="true"><polyline points="' + pts + '" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/></svg>'; };
function smooth(pts, lo, hi) { const cl = (v) => Math.min(hi, Math.max(lo, v)); if (pts.length < 3) return 'M' + pts.map((p) => p.join(',')).join(' L'); let d = 'M' + pts[0].join(','); for (let i = 0; i < pts.length - 1; i++) { const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2; d += ' C' + [p1[0] + (p2[0] - p0[0]) / 6, cl(p1[1] + (p2[1] - p0[1]) / 6), p2[0] - (p3[0] - p1[0]) / 6, cl(p2[1] - (p3[1] - p1[1]) / 6), p2[0], p2[1]].map((x) => x.toFixed(1)).join(','); } return d; }
function chart(m) {
  const W = 640, H = 220, L = 38, R = 8, T = 10, B = 24, all = m.cur.concat(m.prev), top = (() => { const mx = Math.max(...all, 0); if (m.key === 'conversion') return Math.max(5, Math.ceil(mx / 5) * 5); const step = Math.pow(10, Math.floor(Math.log10(Math.max(mx, 1)))); return Math.max(4, Math.ceil(mx / step / 2) * step * 2 || 4); })();
  const x = (i, len) => L + i * (W - L - R) / Math.max(len - 1, 1), y = (v) => T + (H - T - B) * (1 - v / top);
  const grid = [0, 1, 2, 3].map((k) => { const v = top * k / 3, yy = y(v); return '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '" stroke="currentColor" stroke-opacity=".09"/><text x="' + (L - 8) + '" y="' + (yy + 4) + '" text-anchor="end">' + (m.key === 'sales' ? (v >= 1000 ? Math.round(v / 1000) + 'k' : Math.round(v)) : m.key === 'conversion' ? Math.round(v) + '%' : Math.round(v)) + '</text>'; }).join('');
  const ticks = m.curDays.map((d, i) => (i % Math.max(1, Math.round(m.curDays.length / 7)) === 0 ? '<text x="' + x(i, m.curDays.length) + '" y="' + (H - 6) + '" text-anchor="middle">' + short(d) + '</text>' : '')).join('');
  const line = (vals, cls) => '<path class="' + cls + '" d="' + smooth(vals.map((v, i) => [x(i, vals.length), y(v)]), T, H - B) + '" fill="none"/>';
  return '<svg class="hm-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(m.title) + '">' + grid + ticks + line(m.prev, 'prev') + line(m.cur, 'cur') + '</svg>';
}
const channelName = () => CHANNELS.find(([k]) => k === hm.channel)[1], periodName = () => PERIODS.find(([k]) => k === hm.period)[1];

export function homeOverview() {
  const lv = state.liveVisitors && !state.liveVisitors.error ? state.liveVisitors : null, ms = metrics();
  const picker = '<div class="hm-pick"><button type="button" class="hm-pick-btn" data-hm="pick" aria-haspopup="true" aria-expanded="false">' + esc(periodName()) + ' · ' + esc(channelName()) + '</button><div class="hm-menu" role="menu" hidden>' +
    '<div class="hm-grp">Period</div>' + PERIODS.map(([k, n]) => '<button type="button" role="menuitemradio" aria-checked="' + (hm.period === k) + '" data-hm-period="' + k + '"><span>' + n + '</span><i aria-hidden="true">✓</i></button>').join('') +
    '<div class="hm-grp">Sales channel</div>' + CHANNELS.map(([k, n]) => '<button type="button" role="menuitemradio" aria-checked="' + (hm.channel === k) + '" data-hm-channel="' + k + '"><span>' + n + '</span><i aria-hidden="true">✓</i></button>').join('') + '</div></div>';
  const figs = ms.map((m) => '<button type="button" class="hm-fig" data-hm-metric="' + m.key + '"><span>' + m.label + '</span><b>' + m.fmt(m.value) + '</b>' + spark(m.cur) + '</button>').join('');
  const live = '<a class="hm-live" href="' + pathFor('live-view') + '"><span><i class="hm-dot' + (lv && lv.now ? ' on' : '') + '"></i>Live visitors</span><b>' + (lv ? lv.now : '—') + '</b></a>';
  return '<section class="hm" data-home-overview><div class="hm-top">' + picker + '<div class="hm-figs">' + figs + '</div>' + live + '</div><div class="hm-pop" hidden></div></section>';
}

function popFor(key) {
  const m = metrics().find((x) => x.key === key); if (!m) return '';
  const diff = m.before ? Math.round((m.value - m.before) / m.before * 100) : null;
  const note = !m.tracked && key !== 'sales' && key !== 'orders' ? '<p class="hm-note">Visitor tracking is not available right now.</p>' : (hm.channel === 'instore' || hm.channel === 'other') && (key === 'sessions' || key === 'conversion') ? '<p class="hm-note">Sessions are only counted on your online store.</p>' : '';
  return '<div class="hm-card"><div class="hm-card-top"><b>' + m.fmt(m.value) + '</b>' + (diff == null ? '' : '<span class="hm-diff' + (diff < 0 ? ' down' : '') + '">' + (diff >= 0 ? '↑ ' : '↓ ') + Math.abs(diff) + '%</span>') + '</div><h3>' + m.title + '</h3><p>' + m.desc + '</p>' + note + chart(m) +
    '<div class="hm-legend"><span><i class="cur"></i>' + long(m.curDays[0]) + ' – ' + long(m.curDays[m.curDays.length - 1]) + '</span><span><i class="prev"></i>' + long(m.prevDays[0]) + ' – ' + long(m.prevDays[m.prevDays.length - 1]) + '</span></div></div>';
}

export function mountHomeOverview(host, redraw) {
  const pop = host.querySelector('.hm-pop'), menu = host.querySelector('.hm-menu'), btn = host.querySelector('.hm-pick-btn'); let timer = 0, pinned = '';
  const show = (key) => { clearTimeout(timer); pop.innerHTML = popFor(key); pop.hidden = false; host.querySelectorAll('.hm-fig').forEach((f) => f.classList.toggle('on', f.dataset.hmMetric === key)); };
  const hide = () => { timer = setTimeout(() => { if (pinned) return; pop.hidden = true; host.querySelectorAll('.hm-fig').forEach((f) => f.classList.remove('on')); }, 140); };
  host.querySelectorAll('.hm-fig').forEach((f) => { f.addEventListener('mouseenter', () => show(f.dataset.hmMetric)); f.addEventListener('focus', () => show(f.dataset.hmMetric)); f.addEventListener('mouseleave', hide); f.addEventListener('blur', hide); f.addEventListener('click', () => { pinned = pinned === f.dataset.hmMetric ? '' : f.dataset.hmMetric; if (pinned) show(pinned); else hide(); }); });
  pop.addEventListener('mouseenter', () => clearTimeout(timer)); pop.addEventListener('mouseleave', hide);
  btn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); });
  document.addEventListener('click', (e) => { if (!host.isConnected) return; if (!menu.hidden && !menu.contains(e.target)) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
  menu.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.hmPeriod) hm.period = b.dataset.hmPeriod; if (b.dataset.hmChannel) hm.channel = b.dataset.hmChannel; redraw(); });
}

// Phone Home: the figures that sit in the black header (live visitors with a green ring, then orders, conversion rate, sessions and sales with small trends)
export function phoneStats() {
  const lv = state.liveVisitors && !state.liveVisitors.error ? state.liveVisitors : null;
  const ms = metrics(), by = (k) => ms.find((m) => m.key === k);
  const cell = (m) => '<div><span>' + m.label + '</span><b>' + m.fmt(m.value) + spark(m.cur) + '</b></div>';
  return '<div class="m-stats"><a class="m-live" href="' + pathFor('live-view') + '"><span>Live</span><b><i class="hm-ring' + (lv && lv.now ? ' on' : '') + '"></i>' + (lv ? lv.now : '—') + '</b></a>' +
    ['orders', 'conversion', 'sessions', 'sales'].map((k) => cell(by(k))).join('') + '</div>';
}
