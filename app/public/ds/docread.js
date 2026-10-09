/* Reads text out of a PDF or a photo, then turns it into a DRAFT invoice or menu. Free and on the device:
   PDF text via PDF.js, photos and scanned PDFs via Tesseract (both vendored in /vendor, loaded only when used).
   Nothing here saves anything: the callers show the draft for the person to check first. */
(function (root) {
  'use strict';
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const UNITS = 'kg|kgs|g|gm|gms|gram|grams|l|ltr|ltrs|litre|litres|ml|pcs|pc|piece|pieces|nos|no|box|boxes|pkt|pkts|packet|packets|dozen|doz|unit|units|bottle|bottles|tray|bag|bags|can|cans';
  const TAXES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 14, 18, 28, 40];
  const r2 = (n) => Math.round(n * 100) / 100;
  const num = (s) => { const n = parseFloat(String(s).replace(/,/g, '')); return isNaN(n) ? NaN : n; };
  const pad = (n) => String(n).padStart(2, '0');
  const clean = (s) => String(s || '').replace(/[\u00a0\t]+/g, ' ').replace(/\s{2,}/g, '  ').trim();

  // ---------------------------------------------------------------- reading files
  const loaded = {};
  function loadScript(src) {
    return loaded[src] || (loaded[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load the reader. Check your connection once and try again.')); document.head.appendChild(s); }));
  }
  async function pdfDoc(file) {
    const lib = await import('/vendor/pdfjs/pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    return lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  }
  // group the text pieces of one PDF page into lines (same height = same line), left to right, wide gaps kept as two spaces
  function pageLines(items) {
    const rows = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const y = it.transform[5], x = it.transform[4];
      let row = rows.find((r) => Math.abs(r.y - y) < Math.max(2.5, (it.height || 8) * 0.4));
      if (!row) { row = { y, parts: [] }; rows.push(row); }
      row.parts.push({ x, w: it.width || 0, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    return rows.map((r) => {
      r.parts.sort((a, b) => a.x - b.x);
      let out = '', end = null;
      for (const p of r.parts) { if (end != null) out += p.x - end > 6 ? '  ' : (p.x - end > 0.5 ? ' ' : ''); out += p.s; end = p.x + p.w; }
      return clean(out);
    }).filter(Boolean);
  }
  // make a photo easier to read: bigger, black on white, table lines taken out (grid lines make the reader see noise)
  async function prepare(source) {
    let bmp; try { bmp = await createImageBitmap(source); } catch (e) { return source; }
    const sc = Math.max(1, Math.min(3, 2200 / bmp.width)), W = Math.min(3200, Math.round(bmp.width * sc)), H = Math.round(bmp.height * W / bmp.width);
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(bmp, 0, 0, W, H);
    const im = x.getImageData(0, 0, W, H), d = im.data, g = new Uint8Array(W * H), hist = new Array(256).fill(0);
    for (let i = 0; i < W * H; i++) { const v = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) | 0; g[i] = v; hist[v]++; }
    let tot = W * H, sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sB = 0, wB = 0, best = 0, th = 128; for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = tot - wB; if (!wF) break; sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; th = t; } }
    const dark = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) dark[i] = g[i] < th ? 1 : 0;
    const LH = Math.round(W * 0.03), LV = Math.round(W * 0.04), kill = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) { let run = 0; for (let xx = 0; xx <= W; xx++) { if (xx < W && dark[y * W + xx]) run++; else { if (run >= LH) for (let k = xx - run; k < xx; k++) kill[y * W + k] = 1; run = 0; } } }
    for (let xx = 0; xx < W; xx++) { let run = 0; for (let y = 0; y <= H; y++) { if (y < H && dark[y * W + xx]) run++; else { if (run >= LV) for (let k = y - run; k < y; k++) kill[k * W + xx] = 1; run = 0; } } }
    for (let i = 0; i < W * H; i++) { const v = dark[i] && !kill[i] ? 0 : 255; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
    x.putImageData(im, 0, 0); return c;
  }
  async function ocrImage(source, onProgress) {
    await loadScript('/vendor/ocr/tesseract.min.js');
    source = await prepare(source);
    const worker = await Tesseract.createWorker('eng', 1, {
      workerPath: '/vendor/ocr/worker.min.js', corePath: '/vendor/ocr/', langPath: '/vendor/ocr/', gzip: true,
      logger: (m) => { if (onProgress && m.status === 'recognizing text') onProgress(m.progress); },
    });
    try { await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' }); const r = await worker.recognize(source); return r.data.text || ''; } finally { await worker.terminate(); }
  }
  /** file -> { text, lines, method: 'pdf' | 'ocr', pages } */
  async function extract(file, o) {
    o = o || {}; const say = o.onStatus || (() => {});
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    if (isPdf) {
      say('Reading the PDF…');
      const doc = await pdfDoc(file); let lines = [];
      for (let p = 1; p <= Math.min(doc.numPages, 12); p++) { const pg = await doc.getPage(p); lines = lines.concat(pageLines((await pg.getTextContent()).items)); }
      if (lines.join('').replace(/\s/g, '').length >= 40) return { text: lines.join('\n'), lines, method: 'pdf', pages: doc.numPages };
      // a scanned PDF has no text inside: draw each page and read it like a photo
      let text = '';
      for (let p = 1; p <= Math.min(doc.numPages, 4); p++) {
        say('Scanned PDF: reading page ' + p + '… (this takes a little while)');
        const pg = await doc.getPage(p), vp = pg.getViewport({ scale: 2.2 }), c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
        await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        text += (await ocrImage(c, (x) => say('Scanned PDF: page ' + p + ', ' + Math.round(x * 100) + '%'))) + '\n';
      }
      const ls = text.split('\n').map(clean).filter(Boolean);
      return { text: ls.join('\n'), lines: ls, method: 'ocr', pages: doc.numPages };
    }
    say('Reading the photo… (first time loads the reader, about 10 MB)');
    const text = await ocrImage(file, (x) => say('Reading the photo… ' + Math.round(x * 100) + '%'));
    const ls = text.split('\n').map(clean).filter(Boolean);
    return { text: ls.join('\n'), lines: ls, method: 'ocr', pages: 1 };
  }

  // ---------------------------------------------------------------- invoice -> draft
  function toISO(d, m, y) { y = +y; if (y < 100) y += 2000; d = +d; m = +m; if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return ''; return y + '-' + pad(m) + '-' + pad(d); }
  function findDates(line) {
    const out = []; let m;
    const a = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/g; while ((m = a.exec(line))) { const v = toISO(m[1], m[2], m[3]); if (v) out.push(v); }
    const b = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g; while ((m = b.exec(line))) { const v = toISO(m[3], m[2], m[1]); if (v) out.push(v); }
    const c = /\b(\d{1,2})(?:st|nd|rd|th)?[\s\-\/.,]+([A-Za-z]{3,9})[\s\-\/.,]+(\d{2,4})\b/g; while ((m = c.exec(line))) { const mo = MONTHS[m[2].slice(0, 4).toLowerCase()] || MONTHS[m[2].slice(0, 3).toLowerCase()]; if (mo) { const v = toISO(m[1], mo, m[3]); if (v) out.push(v); } }
    return out;
  }
  const GSTIN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g;
  const SKIP = /\b(sub\s*-?total|total|grand|cgst|sgst|igst|utgst|cess|round|rounded|discount|taxable|amount\s+in\s+words|rupees|bank|ifsc|a\/c|account|branch|upi|signature|authori[sz]ed|terms|declaration|e\.?&?o\.?e|remarks?|balance|paid|due|advance|received|payable|freight|packing|transport|gstin|pan\s*no|invoice\s*no|invoice\s*date|bill\s*to|ship\s*to|place\s+of\s+supply|state\s*code|hsn|description|particulars|s\.?\s*no|sr\.?\s*no|qty|quantity|rate|mrp|page\s+\d)/i;
  function moneyIn(line) { return [...line.matchAll(/(?:^|[^\d.,])(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?![\d])/g)].map((m) => num(m[1])).filter((n) => !isNaN(n)); }

  function parseLine(line, defTax) {
    if (SKIP.test(line)) return null;
    // numbers with an optional unit glued/after them, at the end of the line
    const toks = []; const re = /(\d[\d,]*(?:\.\d+)?)\s*(%|(?:kg|kgs|g|gm|gms|l|ltr|ltrs|ml|pcs|pc|nos|no|box|pkt|dozen|doz|unit|units)\b)?/gi; let m;
    while ((m = re.exec(line))) toks.push({ v: num(m[1]), u: m[2] || '', i: m.index, e: m.index + m[0].length });
    if (toks.length < 2) return null;
    // the numeric tail: walk back from the end while only numbers/units/symbols sit between tokens
    let k = toks.length - 1; while (k > 0 && /^[\s₹Rs.\/:\-|*x×@]*$/i.test(line.slice(toks[k - 1].e, toks[k].i))) k--;
    const tail = toks.slice(k); if (tail.length < 2) return null;
    let desc = clean(line.slice(0, tail[0].i)).replace(/^[\d]+[.)]?\s+(?=[A-Za-z])/, '').replace(/[\s|:\-,*]+$/, '');
    if (desc.length < 2 || !/[A-Za-z]{2}/.test(desc)) return null;
    const amount = tail[tail.length - 1].v, rest = tail.slice(0, -1).filter((t) => t.u !== '%' || true);
    let qty = NaN, rate = NaN, unit = '', tax = NaN, hsn = '';
    for (const t of rest) { if (t.u === '%') { if (TAXES.includes(t.v)) tax = t.v; continue; } }
    const plain = rest.filter((t) => t.u !== '%');
    const hs = plain.find((t) => Number.isInteger(t.v) && String(t.v).length >= 4 && String(t.v).length <= 8 && t.v > 999);
    if (hs && plain.length > 2) hsn = String(hs.v);
    const cand = plain.filter((t) => t !== hs || plain.length <= 2);
    outer: for (const a of cand) for (const b of cand) { if (a === b) continue; const p = a.v * b.v; if (a.v > 0 && b.v > 0 && Math.abs(p - amount) <= Math.max(1, amount * 0.012)) { qty = a.v; rate = b.v; unit = a.u && a.u !== '%' ? a.u.toLowerCase() : (b.u && b.u !== '%' ? b.u.toLowerCase() : ''); break outer; } }
    let sure = true;
    if (isNaN(qty)) {
      // tax-inclusive or discounted row: try amount = qty * rate * (1 + tax)
      for (const a of cand) for (const b of cand) { if (a === b) continue; for (const tr of TAXES) { if (tr && Math.abs(a.v * b.v * (1 + tr / 100) - amount) <= Math.max(1, amount * 0.012)) { qty = Math.min(a.v, b.v); rate = Math.max(a.v, b.v); tax = isNaN(tax) ? tr : tax; break; } } if (!isNaN(qty)) break; }
    }
    if (isNaN(qty)) { qty = cand.length && cand[0].v > 0 && cand[0].v < 1000 ? cand[0].v : 1; rate = qty ? r2(amount / qty) : amount; sure = false; }
    if (isNaN(tax)) tax = defTax == null ? NaN : defTax;
    return { description: desc, hsn, qty: qty, unit, rate: r2(rate), tax_rate: tax, amount: r2(amount), sure };
  }

  /** text -> draft invoice. Everything is a guess; `notes` lists what the person should double-check. */
  function parseInvoice(text, o) {
    o = o || {}; const lines = String(text || '').split('\n').map(clean).filter(Boolean), notes = [];
    const own = (o.ownGstin || '').toUpperCase();
    const gst = [...new Set((text.toUpperCase().match(GSTIN) || []))];
    const supplierGstin = gst.find((g) => g !== own) || '';
    // supplier name: the line right above the supplier's GSTIN, else the first real line
    let name = '';
    const junk = /^(tax\s*invoice|invoice|bill|original|duplicate|triplicate|copy|gst|cash\s*memo|estimate|page|e-?invoice|\(?original|for recipient|customer copy)/i;
    const gi = supplierGstin ? lines.findIndex((l) => l.toUpperCase().includes(supplierGstin)) : -1;
    const from = gi > 0 ? lines.slice(Math.max(0, gi - 5), gi) : lines.slice(0, 8);
    for (const l of from.slice().reverse().concat(gi > 0 ? [] : [])) { if (l.length >= 3 && l.length <= 60 && /[A-Za-z]{3}/.test(l) && !junk.test(l) && !/\d{6,}|@|www\.|phone|mob|tel|gstin|address|road|street|nagar|floor/i.test(l)) { name = l; break; } }
    if (!name) for (const l of lines.slice(0, 10)) if (l.length >= 3 && l.length <= 60 && /[A-Za-z]{3}/.test(l) && !junk.test(l) && !/\d{6,}|@|www\./i.test(l)) { name = l; break; }
    name = name.replace(/^(m\/s\.?|messrs\.?)\s*/i, '').replace(/\s{2,}.*$/, '');
    let phone = ''; const ph = text.match(/(?:ph|phone|mob|mobile|tel|contact)[^\d+]{0,12}((?:\+?91)?[\s-]?[6-9]\d{4}[\s-]?\d{5})/i); if (ph) phone = ph[1].replace(/\D/g, '').slice(-10);
    // invoice number and date
    let invNo = '';
    for (const l of lines) { const mm = l.match(/(?:invoice|inv|bill|voucher|receipt)\s*(?:no|number|num|#)\.?\s*[:#\-]*\s*([A-Z0-9][A-Z0-9\/\-]{1,24})/i) || l.match(/\b(?:inv|bill)\s*[:#\-]+\s*([A-Z0-9][A-Z0-9\/\-]{1,24})/i); if (mm && /\d/.test(mm[1])) { invNo = mm[1].replace(/[\/\-]+$/, ''); break; } }
    let date = '';
    for (const l of lines) if (/date|dt\b|dated/i.test(l) && !/due|expiry|exp\b|mfg/i.test(l)) { const d = findDates(l); if (d.length) { date = d[0]; break; } }
    if (!date) for (const l of lines.slice(0, 25)) { const d = findDates(l); if (d.length) { date = d[0]; break; } }
    let due = ''; for (const l of lines) if (/due\s*date|payment\s*due/i.test(l)) { const d = findDates(l); if (d.length) { due = d[0]; break; } }
    // tax rate printed in the tax rows (CGST 9% + SGST 9% = 18, IGST 18%)
    let defTax = NaN; const cg = text.match(/cgst[^\d]{0,12}(\d+(?:\.\d+)?)\s*%/i), sg = text.match(/sgst[^\d]{0,12}(\d+(?:\.\d+)?)\s*%/i), ig = text.match(/igst[^\d]{0,12}(\d+(?:\.\d+)?)\s*%/i);
    if (cg && sg) defTax = num(cg[1]) + num(sg[1]); else if (ig) defTax = num(ig[1]);
    // totals
    let total = NaN; const tl = lines.filter((l) => /(grand\s*total|total\s*amount|invoice\s*(?:total|value)|net\s*(?:amount|payable)|amount\s*(?:payable|due)|total\s*payable|^total\b)/i.test(l) && !/sub\s*-?total|words|tax\s*amount|gst/i.test(l.replace(/grand total/i, '')));
    for (const l of tl.reverse()) { const n = moneyIn(l).filter((x) => x > 0); if (n.length) { total = Math.max(...n); break; } }
    let sub = NaN; for (const l of lines) if (/sub\s*-?total|taxable\s*(?:value|amount)|total\s*taxable/i.test(l)) { const n = moneyIn(l).filter((x) => x > 0); if (n.length) { sub = Math.max(...n); break; } }
    let taxAmt = 0; for (const l of lines) if (/^(c|s|i|u)gst|^cess/i.test(l) && !/total|taxable|rate\s*%/i.test(l.split(/\d/)[0] + '')) { const n = moneyIn(l); if (n.length) taxAmt += n[n.length - 1]; }
    // item rows: only between the table header and the first totals row, when both are found
    let s = lines.findIndex((l) => /(description|particulars|item)\b.*(qty|quantity|rate|amount|price)|(qty|quantity).*(rate|amount|price)/i.test(l));
    let e = lines.findIndex((l, i) => i > s && /^(sub\s*-?total|total\b|grand|taxable|amount\s+in\s+words|cgst|sgst|igst)/i.test(l));
    if (s < 0) { s = -1; } if (e < 0) e = lines.length;
    const items = [];
    for (const l of lines.slice(s + 1, e)) { const it = parseLine(l, defTax); if (it) items.push(it); }
    // a wrapped description (a row with no numbers right after an item) joins the item above it
    const final = items.map((it) => { const { sure, ...rest } = it; return { ...rest, sure }; });
    const sum = r2(final.reduce((a, x) => a + x.amount, 0));
    let inclusive = false;
    if (final.length) {
      if (!isNaN(sub) && Math.abs(sum - sub) <= Math.max(2, sub * 0.01)) inclusive = false;
      else if (!isNaN(total) && Math.abs(sum - total) <= Math.max(2, total * 0.01) && (isNaN(sub) || Math.abs(sum - sub) > 2)) inclusive = true;
    }
    if (!final.length) notes.push('No item rows could be read. Add the items by hand below.');
    else if (!isNaN(total)) {
      const expect = inclusive ? sum : (!isNaN(sub) ? sub : sum);
      if (!inclusive && !isNaN(sub) && Math.abs(sum - sub) > Math.max(2, sub * 0.01)) notes.push('Item amounts add up to ' + sum + ' but the invoice shows ' + sub + ' before tax. A row may be missing or wrong.');
      else if (isNaN(sub) && !isNaN(total) && Math.abs(sum + (isNaN(defTax) ? 0 : taxAmt) - total) > Math.max(3, total * 0.02) && Math.abs(sum - total) > Math.max(3, total * 0.02)) notes.push('Items add up to ' + sum + ' but the invoice total is ' + total + '. Check the rows.');
    }
    if (final.some((x) => !x.sure)) notes.push('Some rows had no clear quantity and rate; they were set to quantity 1. Check them.');
    if (!supplierGstin) notes.push('No supplier GSTIN found. Choose the supplier yourself.');
    if (!invNo) notes.push('Invoice number not found.');
    if (!date) notes.push('Date not found. Today’s date was used.');
    return { supplier: { name, gstin: supplierGstin, phone }, invoice_no: invNo, date, due_date: due, lines: final, subtotal: isNaN(sub) ? null : sub, tax: taxAmt ? r2(taxAmt) : null, total: isNaN(total) ? null : total, items_sum: sum, price_includes_tax: inclusive, default_tax: isNaN(defTax) ? null : defTax, notes };
  }

  // ---------------------------------------------------------------- menu -> draft
  const NONVEG = /\b(chicken|mutton|lamb|fish|prawn|prawns|shrimp|crab|keema|kebab|tikka|egg|eggs|omelette|omelet|bacon|ham|beef|pork)\b/i;
  /** text -> { categories: [{ name, items: [{ name, price, sizes:[{l,p}], veg, desc }] }] } */
  function parseMenu(text) {
    const lines = String(text || '').split('\n').map(clean).filter(Boolean), cats = []; let cur = null, last = null;
    const ensure = (n) => { if (!cur) { cur = { name: n || 'Menu', items: [] }; cats.push(cur); } return cur; };
    for (let raw of lines) {
      let l = raw.replace(/[.·…_]{2,}/g, '  ').replace(/[₹]/g, ' ').replace(/\b(rs|inr)\.?\s*(?=\d)/gi, ' ').replace(/\s*[-–—]\s*(?=\d)/g, '  ').replace(/\/-/g, ' ');
      l = clean(l);
      if (!/[A-Za-z]/.test(l) || l.length < 2) continue;
      if (/^(page\s*\d|www\.|\+?\d[\d\s-]{8,}$|gst|fssai|taxes|all prices|prices are|service charge|thank|follow us|scan|address|open)/i.test(l)) continue;
      // price columns at the end: "120", "120 180", "100/150", "Small 100 Large 150"
      const m = l.match(/^(.*?[A-Za-z)\]])\s*[:\-]?\s+((?:\d{2,4}(?:\.\d{1,2})?(?:\s*[\/|,]\s*|\s{1,}(?=\d))?){1,4})\s*$/);
      if (m) {
        const prices = m[2].split(/[\s\/|,]+/).map(num).filter((n) => n > 0 && n < 100000);
        const nm = m[1].replace(/[\s:\-.]+$/, '').replace(/^\d+[.)]\s*/, '');
        if (prices.length && nm.length >= 2) {
          const c = ensure(), it = { name: nm, price: prices[0], sizes: [], veg: NONVEG.test(nm) ? (/\begg/i.test(nm) && !/chicken|mutton|fish|prawn/i.test(nm) ? 'egg' : 'nonveg') : 'veg', desc: '' };
          if (prices.length > 1) { it.sizes = prices.map((p, i) => ({ l: ['Small', 'Medium', 'Large', 'XL'][i] || 'Size ' + (i + 1), p })); if (prices.length === 2) it.sizes = [{ l: 'Regular', p: prices[0] }, { l: 'Large', p: prices[1] }]; }
          c.items.push(it); last = it; continue;
        }
      }
      const letters = l.replace(/[^A-Za-z]/g, ''), upper = letters && letters === letters.toUpperCase();
      // a short line with no price: a heading if it is capitals or short and the next line is an item; else it describes the item above
      if (l.length <= 38 && !/[.,;]$/.test(l) && (upper || !last || /^[A-Z]/.test(l) && !/[a-z]{3,}\s+[a-z]{3,}\s+[a-z]{3,}/.test(l))) {
        const cname = l.replace(/[:\-–]+$/, '').replace(/\b([A-Z])([A-Z]+)\b/g, (_, a, b) => a + b.toLowerCase()); cur = { name: cname, items: [] }; cats.push(cur); last = null; continue;
      }
      if (last) last.desc = clean((last.desc ? last.desc + ' ' : '') + l).slice(0, 200);
    }
    return { categories: cats.filter((c) => c.items.length) };
  }

  // A product / price list (a PDF or photo of a stock or rate list) -> a table: first row = column names, then one row per product.
  // With a header line (Item, Qty, Rate, MRP, HSN, GST...) the columns follow it; without one, name + HSN + GST % + the last number as the price.
  // Always a draft: the caller shows the column matching and a dry run before anything is saved.
  function parseProducts(lines) {
    const HEAD = /\b(item|product|description|particulars|name|goods|article)\b/i, HEAD2 = /\b(rate|price|mrp|qty|quantity|stock|hsn|sac|gst|unit|amount|cost|barcode|sku|code)\b/i;
    const NOISE = /^(\s*(sub\s*-?total|total|grand total|page\s*\d|printed|generated|date\b|gstin|phone|mobile|email|address|continued)\b)/i;
    const cells = (l) => clean(l).split(/\s{2,}|\t|\|/).map((x) => x.trim()).filter(Boolean);
    let hi = lines.findIndex((l) => HEAD.test(l) && HEAD2.test(l) && cells(l).length >= 2);
    const notes = [];
    if (hi >= 0) {
      const hdr = cells(lines[hi]), n = hdr.length, rows = [];
      for (const l of lines.slice(hi + 1)) {
        if (NOISE.test(l) || (HEAD.test(l) && HEAD2.test(l) && cells(l).length === n)) continue;   // repeated header on the next page
        let c = cells(l);
        if (c.length > n) c = [c.slice(0, c.length - n + 1).join(' '), ...c.slice(c.length - n + 1)];
        if (c.length !== n) { if (/[A-Za-z]{2}/.test(l) && /\d/.test(l)) notes.push('Skipped: ' + clean(l).slice(0, 60)); continue; }
        if (!/[A-Za-z]{2}/.test(c[0])) { const k = c.findIndex((x) => /[A-Za-z]{2}/.test(x)); if (k < 0) continue; }
        rows.push(c);
      }
      return { table: [hdr, ...rows], notes, mode: 'header' };
    }
    const rows = [];
    for (const l0 of lines) {
      const l = clean(l0); if (!l || NOISE.test(l) || SKIP.test(l)) continue;
      const m = [...l.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(%)?/g)]; if (!m.length) continue;
      const last = m[m.length - 1], price = num(last[1]); if (last[2] || isNaN(price) || !(price > 0)) continue;
      let name = clean(l.slice(0, m[0].index)).replace(/^\d+[.)]?\s+(?=[A-Za-z])/, '').replace(/[\s|:\-,*₹]+$/, '');
      if (name.length < 2 || !/[A-Za-z]{2}/.test(name)) continue;
      const pct = m.find((x) => x[2] && TAXES.includes(num(x[1]))), hs = m.find((x) => /^\d{4,8}$/.test(x[1]) && x !== last);
      rows.push([name, hs ? hs[1] : '', pct ? String(num(pct[1])) : '', String(price)]);
    }
    if (rows.length) notes.push('No column headings found: every line was read as name and price (last number on the line). Check the prices.');
    return { table: [['Name', 'HSN/SAC', 'GST rate %', 'Selling price'], ...rows], notes, mode: 'plain' };
  }

  const api = { extract, parseInvoice, parseMenu, parseProducts, findDates, parseLine };
  root.auzDocRead = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
