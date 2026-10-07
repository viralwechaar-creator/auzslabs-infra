/* Direct thermal printing (ESC/POS) from the browser: no print window, no driver.
   Builder (`Esc`), a converter from the small HTML the POS uses for kitchen tickets and slips (`htmlToEsc`), and the
   three ways a browser can talk to a receipt printer: WebUSB, Web Serial and Web Bluetooth (`auzPrinter`).
   Works in Chrome / Edge on computers and Android Chrome. It does NOT work inside the Android app wrapper (a WebView
   has none of these APIs), in Safari or on iPhone: there the POS keeps using the normal print window.
   Text is plain ASCII (Latin letters, digits, symbols); other scripts print as '?'. The rupee sign prints as "Rs". */
(function (root) {
  'use strict';
  const ESC = 0x1b, GS = 0x1d, LF = 0x0a;
  const MAP = { '×': 'x', '·': '-', '•': '*', '−': '-', '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '₹': 'Rs ', '€': 'EUR ', '£': 'GBP ', '°': 'deg', '½': '1/2', '¼': '1/4', '¾': '3/4', ' ': ' ', '​': '' };
  function asciiOf(ch) {
    if (ch.charCodeAt(0) < 128) return ch;
    if (MAP[ch] != null) return MAP[ch];
    const base = ch.normalize ? ch.normalize('NFKD').replace(/[̀-ͯ]/g, '') : '';
    return base && base.charCodeAt(0) < 128 ? base : '?';
  }
  const ascii = (s) => Array.from(String(s == null ? '' : s)).map(asciiOf).join('');
  const bytesOf = (s) => { const out = []; for (const c of ascii(s)) out.push(c.charCodeAt(0) & 0x7f); return out; };

  class Esc {
    constructor(width) { this.w = width || 32; this.b = []; this.raw(ESC, 0x40); }   // ESC @ : reset
    raw(...n) { for (const x of n) this.b.push(x & 0xff); return this; }
    text(s) { this.b.push(...bytesOf(s)); return this; }
    nl(n) { for (let i = 0; i < (n || 1); i++) this.b.push(LF); return this; }
    align(a) { return this.raw(ESC, 0x61, a === 'center' ? 1 : a === 'right' ? 2 : 0); }
    bold(on) { return this.raw(ESC, 0x45, on ? 1 : 0); }
    underline(on) { return this.raw(ESC, 0x2d, on ? 1 : 0); }
    size(w, h) { return this.raw(GS, 0x21, (((w || 1) - 1) & 7) << 4 | (((h || 1) - 1) & 7)); }   // GS ! n : 1 = normal, 2 = double
    line(s) { return this.text(s).nl(); }
    hr(ch) { return this.line((ch || '-').repeat(this.w)); }
    /** left text and right text on one line (the left part wraps if it is too long) */
    lr(left, right) {
      left = ascii(left); right = ascii(right);
      const room = this.w - right.length - 1;
      if (room < 4) { this.line(left); return this.align('right').line(right).align('left'); }
      const parts = wrap(left, room);
      for (let i = 0; i < parts.length - 1; i++) this.line(parts[i]);
      const last = parts[parts.length - 1] || '';
      return this.line(last + ' '.repeat(Math.max(1, this.w - last.length - right.length)) + right);
    }
    wrapLine(s, indent) { for (const p of wrap(ascii(s), this.w - (indent || 0))) this.line(' '.repeat(indent || 0) + p); return this; }
    qr(data, size) {                                                                              // GS ( k : QR code (model 2)
      const d = bytesOf(data), n = d.length + 3;
      this.raw(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0);                                        // model 2
      this.raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, size || 6);                                      // module size
      this.raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31);                                           // error correction M
      this.raw(GS, 0x28, 0x6b, n & 255, n >> 8, 0x31, 0x50, 0x30); this.b.push(...d);             // store
      return this.raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30);                                    // print
    }
    drawer() { return this.raw(ESC, 0x70, 0, 25, 250); }                                          // ESC p : pulse the cash drawer
    cut() { return this.nl(3).raw(GS, 0x56, 66, 0); }                                             // feed, then partial cut
    bytes() { return new Uint8Array(this.b); }
  }
  function wrap(s, width) {
    const out = []; let cur = '';
    for (const word of String(s).split(/\s+/).filter(Boolean)) {
      let w = word;
      while (w.length > width) { if (cur) { out.push(cur); cur = ''; } out.push(w.slice(0, width)); w = w.slice(width); }
      if (!cur) cur = w; else if ((cur + ' ' + w).length <= width) cur += ' ' + w; else { out.push(cur); cur = w; }
    }
    if (cur) out.push(cur);
    return out.length ? out : [''];
  }

  // ---- the POS's small slip HTML (kitchen tickets, cancellations, register summary) -> printer bytes ----
  function htmlToEsc(html, width, o) {
    o = o || {};
    const doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html'), e = new Esc(width);
    let buf = '', st = { align: 'left', bold: false, big: false, under: false }, started = false;
    const flush = () => {
      const t = buf.replace(/\s+/g, ' ').trim(); buf = '';
      if (!t) return;
      e.align(st.align).bold(st.bold || st.big).underline(st.under).size(st.big ? 2 : 1, st.big ? 2 : 1);
      if (st.big) { for (const p of wrap(ascii(t), Math.floor(e.w / 2))) e.line(p); } else e.wrapLine(t, st.indent || 0);
      e.size(1, 1).bold(false).underline(false).align('left'); started = true;
    };
    const walk = (n, ctx) => {
      if (n.nodeType === 3) { buf += n.nodeValue; return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName.toLowerCase(), cls = n.getAttribute('class') || '';
      if (tag === 'style' || tag === 'script') return;
      if (tag === 'br') { flush(); return; }
      if (tag === 'hr') { flush(); e.align('left').hr(); return; }
      if (tag === 'table') { flush(); for (const tr of n.querySelectorAll('tr')) row(tr); return; }
      const prev = { ...st };
      const block = tag === 'div' || tag === 'p' || /^h\d$/.test(tag);
      if (block) flush();
      if (/\bc\b|\bhd\b/.test(cls)) st.align = 'center';
      if (/\bbig\b/.test(cls)) { st.big = true; st.bold = true; }
      if (tag === 'b' || tag === 'strong' || /\bhd\b/.test(cls)) { flush(); st.bold = true; }
      if (tag === 'u') { flush(); st.under = true; }
      if (/\bnote\b/.test(cls) || tag === 'small') { flush(); st.indent = 2; }
      for (const c of n.childNodes) walk(c, ctx);
      if (block || tag === 'b' || tag === 'strong' || tag === 'u' || tag === 'small' || /\bnote\b/.test(cls)) flush();
      st = prev;
    };
    const row = (tr) => {
      const cells = Array.from(tr.children).map((c) => c.textContent.replace(/\s+/g, ' ').trim());
      if (!cells.some(Boolean)) return;
      if (cells.length === 1) { st.align = 'left'; e.wrapLine(cells[0]); return; }
      const first = cells[0], last = cells[cells.length - 1], mid = cells.slice(1, -1).filter(Boolean).join(' ');
      const bold = tr.querySelector('b, th') != null || /\bbig\b/.test(tr.getAttribute('class') || '');
      e.bold(bold).lr(mid ? first + ' ' + mid : first, last).bold(false); started = true;
    };
    for (const c of doc.body.childNodes) walk(c);
    flush();
    if (o.drawer) e.drawer();
    e.cut();
    return e.bytes();
  }

  // ---- printers ----
  const BLE_SERVICES = ['000018f0-0000-1000-8000-00805f9b34fb', '0000ffe0-0000-1000-8000-00805f9b34fb', '0000ff00-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '49535343-fe7d-4ae5-8fa9-9fafd205e455', '0000fee7-0000-1000-8000-00805f9b34fb'];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const store = { get() { try { return JSON.parse(localStorage['auz.printer'] || 'null'); } catch { return null; } }, set(v) { try { if (v) localStorage['auz.printer'] = JSON.stringify(v); else localStorage.removeItem('auz.printer'); } catch {} } };
  let T = null;       // the connected transport: { kind, name, write(Uint8Array), close() }
  const listeners = [];
  const changed = () => listeners.forEach((f) => { try { f(); } catch {} });

  async function usbTransport(dev) {
    await dev.open();
    if (dev.configuration === null) await dev.selectConfiguration(1);
    let iface = null, ep = null;
    for (const i of dev.configuration.interfaces) for (const a of i.alternates) { const out = a.endpoints.find((x) => x.direction === 'out' && x.type === 'bulk'); if (out && (a.interfaceClass === 7 || !iface)) { iface = i; ep = out; if (a.interfaceClass === 7) break; } }
    if (!iface) throw new Error('This USB device has no printer output.');
    await dev.claimInterface(iface.interfaceNumber);
    return { kind: 'usb', name: dev.productName || 'USB printer', key: { vendorId: dev.vendorId, productId: dev.productId },
      async write(b) { for (let i = 0; i < b.length; i += 4096) await dev.transferOut(ep.endpointNumber, b.slice(i, i + 4096)); },
      async close() { try { await dev.close(); } catch {} } };
  }
  async function serialTransport(port, baud) {
    await port.open({ baudRate: baud || 9600 });
    const info = port.getInfo ? port.getInfo() : {};
    return { kind: 'serial', name: 'Serial printer', key: { usbVendorId: info.usbVendorId, usbProductId: info.usbProductId, baud: baud || 9600 },
      async write(b) { const w = port.writable.getWriter(); try { await w.write(b); } finally { w.releaseLock(); } },
      async close() { try { await port.close(); } catch {} } };
  }
  async function bleTransport(dev) {
    const server = await dev.gatt.connect();
    let ch = null;
    for (const svc of await server.getPrimaryServices()) { for (const c of await svc.getCharacteristics()) { if (c.properties.write || c.properties.writeWithoutResponse) { ch = c; break; } } if (ch) break; }
    if (!ch) { try { dev.gatt.disconnect(); } catch {} throw new Error('That Bluetooth device is not a receipt printer.'); }
    return { kind: 'bluetooth', name: dev.name || 'Bluetooth printer', key: { name: dev.name }, _dev: dev,
      async write(b) { for (let i = 0; i < b.length; i += 100) { const part = b.slice(i, i + 100); if (ch.properties.writeWithoutResponse && ch.writeValueWithoutResponse) await ch.writeValueWithoutResponse(part); else await ch.writeValue(part); await sleep(25); } },
      async close() { try { dev.gatt.disconnect(); } catch {} } };
  }

  const auzPrinter = {
    supported() { return { usb: !!(root.navigator && navigator.usb), serial: !!(root.navigator && navigator.serial), bluetooth: !!(root.navigator && navigator.bluetooth) }; },
    anySupported() { const s = this.supported(); return s.usb || s.serial || s.bluetooth; },
    info() { const s = store.get(); return T ? { connected: true, kind: T.kind, name: T.name } : s ? { connected: false, kind: s.kind, name: s.name } : null; },
    /** true when a direct printer has been chosen on this device (it is reconnected when needed) */
    ready() { return !!(T || store.get()); },
    onchange(f) { listeners.push(f); },
    async pair(kind, opt) {
      let t;
      if (kind === 'usb') { if (!navigator.usb) throw new Error('This browser cannot use USB printers.'); t = await usbTransport(await navigator.usb.requestDevice({ filters: [{ classCode: 7 }] })); }
      else if (kind === 'serial') { if (!navigator.serial) throw new Error('This browser cannot use serial printers.'); t = await serialTransport(await navigator.serial.requestPort(), opt && opt.baud); }
      else if (kind === 'bluetooth') { if (!navigator.bluetooth) throw new Error('This browser cannot use Bluetooth printers.'); t = await bleTransport(await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES })); }
      else throw new Error('Unknown printer type');
      if (T) await T.close();
      T = t; store.set({ kind: t.kind, name: t.name, key: t.key }); changed(); return this.info();
    },
    async forget() { if (T) await T.close(); T = null; store.set(null); changed(); },
    /** open the remembered printer again (USB and serial devices already allowed in this browser reconnect without asking) */
    async reconnect() {
      if (T) return true;
      const s = store.get(); if (!s) return false;
      try {
        if (s.kind === 'usb' && navigator.usb) { const d = (await navigator.usb.getDevices()).find((x) => !s.key || (x.vendorId === s.key.vendorId && x.productId === s.key.productId)); if (d) { T = await usbTransport(d); changed(); return true; } }
        if (s.kind === 'serial' && navigator.serial) { const p = (await navigator.serial.getPorts()).find((x) => { const i = x.getInfo ? x.getInfo() : {}; return !s.key || (i.usbVendorId === s.key.usbVendorId && i.usbProductId === s.key.usbProductId); }); if (p) { T = await serialTransport(p, s.key && s.key.baud); changed(); return true; } }
      } catch (e) { T = null; }
      return false;                                                                                  // Bluetooth needs a tap on "Connect" again after the page was closed
    },
    async print(bytes) {
      if (!T && !(await this.reconnect())) throw new Error('The printer is not connected. Open Staff & settings, Receipt printer, and connect it.');
      try { await T.write(bytes); }
      catch (e) { const dead = T; T = null; try { await dead.close(); } catch {} changed(); if (await this.reconnect()) { await T.write(bytes); return; } throw e; }
    },
    /** tests and special hardware: plug in any object with write(bytes) */
    _use(t) { T = t; store.set(t ? { kind: t.kind || 'custom', name: t.name || 'Printer', key: null } : null); changed(); },
  };

  const api = { Esc, htmlToEsc, wrap, ascii, auzPrinter };
  root.auzEsc = api; root.auzPrinter = auzPrinter;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
