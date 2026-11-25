// One PDF for a SalesOS staff member: every profile detail, then each uploaded document (images fitted to a page, PDFs appended).
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const A4 = [595.28, 841.89];
const SKIP = /(^|_)(id|user_id|tenant_id|staff_id|created_at|updated_at|createdat|updatedat)$/i;
// the standard PDF fonts only cover Latin-1; replace anything else so a name with a special sign can never break the file
const clean = (v) => String(v ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/₹/g, 'Rs ').replace(/[^\x20-\x7e\xa0-\xff\n]/g, '?');
const human = (k) => String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function pairsOf(obj) {
  const out = [];
  for (const [k, v] of Object.entries(obj || {})) {
    if (SKIP.test(k) || v === null || v === undefined || v === '' || typeof v === 'object') continue;
    out.push([human(k), typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)]);
  }
  return out;
}

export async function buildStaffPdf({ name, sections, docs }) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage(A4), y = A4[1] - 56; const M = 48, W = A4[0] - 2 * M;
  const ensure = (h) => { if (y - h < 48) { page = pdf.addPage(A4); y = A4[1] - 56; } };
  const wrap = (text, f, size, width) => {
    const lines = [];
    for (const para of clean(text).split('\n')) {
      let line = '';
      for (const w of para.split(/\s+/)) {
        const t = line ? line + ' ' + w : w;
        if (f.widthOfTextAtSize(t, size) <= width) line = t;
        else { if (line) lines.push(line); line = w; while (f.widthOfTextAtSize(line, size) > width) { let i = line.length - 1; while (i > 1 && f.widthOfTextAtSize(line.slice(0, i), size) > width) i--; lines.push(line.slice(0, i)); line = line.slice(i); } }
      }
      lines.push(line);
    }
    return lines;
  };
  page.drawText('Staff profile', { x: M, y, size: 11, font, color: rgb(0.4, 0.4, 0.4) }); y -= 24;
  page.drawText(clean(name || 'Staff member'), { x: M, y, size: 22, font: bold }); y -= 14;
  page.drawText('Generated ' + new Date().toISOString().slice(0, 10), { x: M, y: y - 10, size: 9, font, color: rgb(0.5, 0.5, 0.5) }); y -= 34;
  for (const sec of sections) {
    if (!sec.rows.length) continue;
    ensure(40); page.drawText(clean(sec.title), { x: M, y, size: 13, font: bold }); y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.6, color: rgb(0.8, 0.8, 0.8) }); y -= 16;
    for (const [k, v] of sec.rows) {
      const vl = wrap(v, font, 10, W * 0.62); ensure(Math.max(14, vl.length * 13));
      page.drawText(clean(k), { x: M, y, size: 9.5, font, color: rgb(0.35, 0.35, 0.35) });
      vl.forEach((ln, i) => page.drawText(ln, { x: M + W * 0.36, y: y - i * 13, size: 10, font }));
      y -= Math.max(15, vl.length * 13 + 2);
    }
    y -= 12;
  }
  // documents
  const list = docs || [];
  if (list.length) { ensure(40); page.drawText('Documents on file', { x: M, y, size: 13, font: bold }); y -= 18;
    for (const d of list) { ensure(16); page.drawText(clean(d.label + (d.category ? ' (' + d.category + ')' : '') + ' - ' + (d.buffer ? 'attached' : d.uploaded ? 'file not available' : 'pending')), { x: M, y, size: 10, font }); y -= 15; } }
  for (const d of list) {
    if (!d.buffer) continue;
    try {
      if (d.type === 'application/pdf') {
        const src = await PDFDocument.load(d.buffer, { ignoreEncryption: true });
        const cover = pdf.addPage(A4); cover.drawText(clean(d.label), { x: M, y: A4[1] - 56, size: 14, font: bold });
        const pages = await pdf.copyPages(src, src.getPageIndices()); pages.forEach((p) => pdf.addPage(p));
      } else {
        const img = d.type === 'image/png' ? await pdf.embedPng(d.buffer) : await pdf.embedJpg(d.buffer);
        const pg = pdf.addPage(A4); pg.drawText(clean(d.label), { x: M, y: A4[1] - 48, size: 14, font: bold });
        const maxW = A4[0] - 2 * M, maxH = A4[1] - 130, s = Math.min(maxW / img.width, maxH / img.height, 1);
        pg.drawImage(img, { x: M, y: A4[1] - 80 - img.height * s, width: img.width * s, height: img.height * s });
      }
    } catch {
      const pg = pdf.addPage(A4); pg.drawText(clean(d.label + ' - this file could not be added to the PDF'), { x: M, y: A4[1] - 56, size: 11, font });
    }
  }
  return Buffer.from(await pdf.save());
}
