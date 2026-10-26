/* AUZsStyle: Excel (.xlsx) and CSV in/out, built in the browser (no server round trip, no third-party library).
   Writes a plain, real .xlsx a shop owner can open directly in Excel or Google Sheets -- never a JSON/code dump.
   Ported and extended (multi-sheet) from the same technique already used by AUZslab Accounting (accounts/core.js). */
'use strict';
function downloadFile(name, blob) { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = [',', ';', '\t', '|'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}
const csvCell = (v) => { v = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(v) && isNaN(Number(v))) v = "'" + v; return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
function exportCSV(name, head, rows) { downloadFile(name + '.csv', new Blob(['﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })); }
const crcT = (() => { const tbl = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tbl[n] = c >>> 0; } return tbl; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zipStore(files) { // files: [[name, string]] -> Blob (uncompressed zip, enough for .xlsx)
  const enc = new TextEncoder(), parts = [], cd = []; let off = 0;
  for (const [name, text] of files) {
    const nb = enc.encode(name), db = enc.encode(text), crc = crc32(db);
    const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint32(14, crc, true); lh.setUint32(18, db.length, true); lh.setUint32(22, db.length, true); lh.setUint16(26, nb.length, true);
    parts.push(lh, nb, db);
    const ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint32(16, crc, true); ch.setUint32(20, db.length, true); ch.setUint32(24, db.length, true); ch.setUint16(28, nb.length, true); ch.setUint32(42, off, true);
    cd.push(ch, nb); off += 30 + nb.length + db.length;
  }
  const cdSize = cd.reduce((s, x) => s + (x.byteLength ?? x.length), 0);
  const end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...cd, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
function sheetXml(head, rows) {
  const col = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const cell = (v, r, c) => { const ref = col(c) + (r + 1); if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`; return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v ?? '')}</t></is></c>`; };
  return '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + [head, ...rows].map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cell(v, ri, ci)).join('')}</row>`).join('') + '</sheetData></worksheet>';
}
// sheets: [[sheetName, head, rows], ...] -- one workbook, one tab per sheet, so a backup can hold Inventory/Customers/Sales side by side
function exportXLSXMulti(name, sheets) {
  const n = sheets.length;
  const files = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map(([name_], i) => `<sheet name="${esc(name_).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + '</Relationships>'],
  ];
  sheets.forEach(([, head, rows], i) => files.push([`xl/worksheets/sheet${i + 1}.xml`, sheetXml(head, rows)]));
  downloadFile(name + '.xlsx', zipStore(files));
  void n;
}
function exportXLSX(name, head, rows) { exportXLSXMulti(name, [['Sheet1', head, rows]]); }
async function inflateRaw(bytes) { const ds = new DecompressionStream('deflate-raw'); const w = ds.writable.getWriter(); w.write(bytes); w.close(); return new Uint8Array(await new Response(ds.readable).arrayBuffer()); }
async function readXLSX(buf) { // first worksheet -> array of rows (strings)
  const u8 = new Uint8Array(buf), dv = new DataView(buf); let e = u8.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('This is not a valid .xlsx file');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const ent = {};
  for (let i = 0; i < n; i++) { const m = dv.getUint16(p + 10, true), cs = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true); const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl)); ent[name] = { m, cs, lo }; p += 46 + nl + xl + cl; }
  const get = async (name) => { const x = ent[name]; if (!x) return null; const nl = dv.getUint16(x.lo + 26, true), xl = dv.getUint16(x.lo + 28, true), start = x.lo + 30 + nl + xl, data = u8.subarray(start, start + x.cs); return new TextDecoder().decode(x.m === 0 ? data : await inflateRaw(data)); };
  const parse = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const shared = []; const ss = await get('xl/sharedStrings.xml');
  if (ss) parse(ss).querySelectorAll('si').forEach((si) => shared.push([...si.querySelectorAll('t')].map((t) => t.textContent).join('')));
  const sheetName = Object.keys(ent).filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!sheetName) throw new Error('No worksheet found in this file');
  const doc = parse(await get(sheetName)), rows = [];
  const colIdx = (ref) => { let c = 0; for (const ch of ref.replace(/\d+/g, '')) c = c * 26 + ch.charCodeAt(0) - 64; return c - 1; };
  doc.querySelectorAll('row').forEach((r) => {
    const row = [];
    r.querySelectorAll('c').forEach((c) => { const t = c.getAttribute('t'), v = c.querySelector('v'); let val = ''; if (t === 's') val = shared[+(v && v.textContent)] ?? ''; else if (t === 'inlineStr') val = c.textContent; else val = v ? v.textContent : ''; row[colIdx(c.getAttribute('r'))] = val; });
    if (row.some((x) => x !== undefined && x !== '')) rows.push([...row].map((x) => x ?? ''));
  });
  return rows;
}
async function readTable(file) { // CSV or XLSX -> [[...]] rows
  if (/\.xlsx$/i.test(file.name)) return readXLSX(await file.arrayBuffer());
  if (/\.xls$/i.test(file.name)) throw new Error('Old .xls files are not supported. Save as .xlsx or .csv first');
  return parseCSV(await file.text());
}
