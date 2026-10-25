/* "Counter" look: a different layout for the till, not a restyle. Opt-in per device (localStorage 'pos.look' = 'counter');
   Classic stays the default. Same data, same billing, same buttons: only the structure of Sell and the navigation changes.
   - Sell: category rail on the left, one calm top line (order type, table, search, photos switch), item grid, and the bill
     as a floating bar on phones / a receipt panel on wide screens.
   - Navigation: one floating dock on every screen size (no side menu, no tab bar).
   Every rule lives under html.ui-counter in counter.css. Loaded after sell.js and before shell.js. */
'use strict';
const counterOn = () => { try { return localStorage['pos.look'] === 'counter'; } catch { return false; } };
const photosOn = () => { try { return localStorage['pos.photos'] !== '0'; } catch { return true; } };
function setLook(v) {
  try {
    localStorage['pos.look'] = v;
    if (window.auzModern) auzModern.set(v === 'modern');
    else localStorage['ui.modern'] = v === 'modern' ? '1' : '0';
  } catch {}
  document.documentElement.classList.toggle('ui-counter', v === 'counter');
  if (typeof render === 'function' && S.user) render();
}
const lookNow = () => (counterOn() ? 'counter' : window.auzModern && auzModern.on() ? 'modern' : 'classic');
const lookSeg = () => seg([['classic', 'Classic'], ['modern', 'Modern'], ['counter', 'Counter']], lookNow(), setLook);

function counterTile(i, q, photos) {
  const price = i.sizes && i.sizes.length ? i.sizes.map((s) => inr(s.p)).slice(0, 2).join(' / ') : inr(i.price);
  const why = itemOffWhy(i, S.cur && S.cur.type);
  return h('button', { class: 'ct' + (why ? ' off' : ''), onclick: () => (why ? toast(i.name + ': ' + why, { err: true }) : addItemFlow(i)), 'aria-label': i.name },
    photos ? h('div', { class: 'ph' }, i.img ? h('img', { src: i.img, alt: '', loading: 'lazy' }) : h('span', null, String(i.name || '?').trim().charAt(0).toUpperCase())) : null,
    h('div', { class: 'nm' }, i.name),
    why ? h('div', { class: 'offwhy' }, why) : null,
    h('div', { class: 'pr' }, h('b', null, isRetail() ? inr(i.price) : price), !isRetail() ? h('i', { class: 'vmark ' + (i.veg || 'veg'), title: VEG[i.veg || 'veg'] }) : null),
    q ? h('span', { class: 'q' }, String(q)) : null);
}

function counterSell() {
  const o = curOrder(), cs = cats(), photos = photosOn();
  if (!cs.some((c) => c.id === S.cat)) S.cat = cs[0] && cs[0].id;
  const counts = {}; menuItems().forEach((i) => { counts[i.cat] = (counts[i.cat] || 0) + 1; });
  const inCart = {}; o.lines.forEach((l) => (inCart[l.id] = (inCart[l.id] || 0) + l.qty));
  const grid = h('div', { class: 'cgrid' + (photos ? '' : ' nophoto'), 'data-items': '1' });
  const cur = cs.find((c) => c.id === S.cat);
  const title = h('h1', null, ''), count = h('span', null, '');
  const drawGrid = () => {
    const its = visibleItems(o);
    title.textContent = S.q.trim() ? 'Results' : (cur ? cur.name : 'Menu'); count.textContent = plural(its.length, 'item');
    grid.replaceChildren(...its.map((i) => counterTile(i, inCart[i.id], photos)));
    if (!its.length) grid.append(h('div', { style: { gridColumn: '1/-1' } }, cs.length ? empty('search', S.q ? 'No matches' : 'Nothing here', S.q ? 'Try another name or code.' : 'Add items to this category in the admin console under Menu.') : empty('sell', 'No menu yet', 'Add categories and items in the admin console under Menu.')));
  };
  drawGrid();
  const rail = h('nav', { class: 'c-rail', 'aria-label': 'Categories' },
    h('div', { class: 'c-logo' }, h('img', { src: '/icon-pos.svg', alt: 'AUZslab POS' })),
    cs.map((c) => h('button', { class: 'c-cat' + (c.id === S.cat && !S.q ? ' on' : ''), 'data-cat': c.id, onclick: () => { S.cat = c.id; S.q = ''; render(); } },
      h('i', null, String(c.name || '?').trim().charAt(0).toUpperCase()), h('span', null, c.name), h('b', null, String(counts[c.id] || 0)))));
  const search = h('label', { class: 'c-find' }, icon('search', 16),
    h('input', { type: 'search', placeholder: 'Search or type a code', value: S.q, 'aria-label': 'Search items', oninput: (e) => { S.q = e.target.value; clearTimeout(S.qt); S.qt = setTimeout(() => { drawGrid(); }, 120); } }));
  const photoBtn = h('button', { class: 'c-ico' + (photos ? ' on' : ''), 'aria-label': photos ? 'Hide photos' : 'Show photos', title: photos ? 'Hide photos' : 'Show photos', onclick: () => { try { localStorage['pos.photos'] = photos ? '0' : '1'; } catch {} render(); } }, icon('eye', 18));
  const bell = h('button', { class: 'c-ico', 'aria-label': 'Notifications', onclick: notifSheet }, icon('bell', 18), h('span', { id: 'notifCount', class: 'dot hidden' }));
  const top = h('div', { class: 'c-top' },
    !isRetail() ? typeSeg(o) : null,
    o.type === 'Dine-in' && isRestaurant() ? h('button', { class: 'c-chip' + (o.table ? ' set' : ''), onclick: () => tableSheet(o) }, o.table ? tn(o.table) : 'Table') : null,
    search, photoBtn, bell);
  const t = tot(o), n = itemCount(o);
  const ribbon = h('div', { class: 'c-ribbon' + (n ? '' : ' empty') },
    h('button', { class: 'rt', onclick: () => openTicketSheet(), 'aria-label': 'Review the order' }, h('b', null, inr(t.total)), h('span', null, plural(n, 'item') + (o.table ? ' · ' + tn(o.table) : ' · tap to review'))),
    h('button', { class: 'btn fill pay', disabled: !n, onclick: () => payFlow(o) }, 'Pay'));
  return h('div', { class: 'sell c-sell' },
    rail,
    h('div', { class: 'c-mid' }, top, h('div', { class: 'items-scroll c-scroll' }, h('div', { class: 'c-hd' }, title, count), grid), ribbon),
    h('div', { class: 'ticket-pane c-paper' }, ticketView(o)));
}

function counterDock(navs) {
  const main = navs.filter((n) => !n.grp), items = main.concat(navs.filter((n) => n.k === 'more'));
  // phones show the first four sections plus More (like the old tab bar); wider screens show every section
  return h('nav', { class: 'c-dock', 'aria-label': 'Main' }, items.map((n) => h('button', { class: (S.tab === n.k || (n.k === 'more' && !main.slice(0, 4).some((x) => x.k === S.tab) && S.tab !== 'more' && false) ? 'on' : '') + (n.k !== 'more' && main.indexOf(n) >= 4 ? ' c-x' : ''), 'data-tab': n.k, 'aria-current': S.tab === n.k ? 'page' : null, onclick: () => go(n.k) },
    h('span', { class: 'dl' }, n.k === 'more' ? 'More' : n.label), navBadge(n.k) ? h('span', { class: 'badge' }, String(navBadge(n.k))) : null)));
}

(function () {
  const classic = V.sell;
  V.sell = () => (counterOn() ? counterSell() : classic());
  V.sell.fixed = true;
})();
