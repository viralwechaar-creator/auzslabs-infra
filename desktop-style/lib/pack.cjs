'use strict';
// A folder <-> one .tgz file (tar + gzip), written here so nothing outside Node is needed (Windows 7 has no tar). Used for cloud backups.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { Readable, pipeline } = require('node:stream');
const { promisify } = require('node:util');
const pipe = promisify(pipeline);

const oct = (n, len) => Buffer.from(n.toString(8).padStart(len - 1, '0') + '\0', 'latin1');
function header(name, size, isDir, mtime) {
  let prefix = '', nm = name;
  if (Buffer.byteLength(nm) > 100) { const i = nm.lastIndexOf('/', nm.length - 1); const cut = nm.slice(0, i), rest = nm.slice(i + 1); if (i < 1 || Buffer.byteLength(rest) > 100 || Buffer.byteLength(cut) > 155) throw new Error('file name too long for the backup: ' + name); prefix = cut; nm = rest; }
  const b = Buffer.alloc(512);
  b.write(nm, 0, 'utf8'); oct(isDir ? 0o755 : 0o644, 8).copy(b, 100); oct(0, 8).copy(b, 108); oct(0, 8).copy(b, 116); oct(isDir ? 0 : size, 12).copy(b, 124); oct(Math.floor(mtime / 1000), 12).copy(b, 136);
  b.fill(0x20, 148, 156); b.write(isDir ? '5' : '0', 156); b.write('ustar\0', 257, 'latin1'); b.write('00', 263, 'latin1'); b.write(prefix, 345, 'utf8');
  let sum = 0; for (let i = 0; i < 512; i++) sum += b[i];
  b.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'latin1');
  return b;
}
function* walk(dir, rel = '') {
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) { yield { r, dir: true }; yield* walk(dir, r); } else if (e.isFile()) yield { r, dir: false };
  }
}
async function* entries(dir) {
  for (const f of walk(dir)) {
    const full = path.join(dir, f.r), st = fs.statSync(full);
    if (f.dir) { yield header(f.r + '/', 0, true, st.mtimeMs); continue; }
    yield header(f.r, st.size, false, st.mtimeMs);
    for await (const chunk of fs.createReadStream(full)) yield chunk;
    const pad = (512 - (st.size % 512)) % 512; if (pad) yield Buffer.alloc(pad);
  }
  yield Buffer.alloc(1024);
}
async function packDir(dir, outFile) { await pipe(Readable.from(entries(dir)), zlib.createGzip({ level: 6 }), fs.createWriteStream(outFile)); }

async function unpackTo(file, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const root = path.resolve(dir) + path.sep;
  let buf = Buffer.alloc(0), cur = null, out = null, left = 0, pad = 0;
  const closing = [];
  const finish = () => { if (out) { const o = out; closing.push(new Promise((res, rej) => { o.on('finish', res); o.on('error', rej); })); o.end(); out = null; } };
  const target = (n) => { const p = path.resolve(dir, n); if (!p.startsWith(root) || /(^|\/)\.\.(\/|$)/.test(n)) throw new Error('unsafe path in backup: ' + n); return p; };
  const gz = fs.createReadStream(file).pipe(zlib.createGunzip());
  for await (const chunk of gz) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (cur === null) {
        if (buf.length < 512) break;
        const h = buf.subarray(0, 512); buf = buf.subarray(512);
        if (h.every((x) => x === 0)) continue;
        const name = (h.toString('utf8', 345, 500).replace(/\0.*$/, '') ? h.toString('utf8', 345, 500).replace(/\0.*$/, '') + '/' : '') + h.toString('utf8', 0, 100).replace(/\0.*$/, '');
        const size = parseInt(h.toString('latin1', 124, 136).replace(/\0.*$/, '').trim() || '0', 8); const type = String.fromCharCode(h[156] || 48);
        if (type === '5') { fs.mkdirSync(target(name), { recursive: true }); continue; }
        if (type !== '0') { left = size; pad = (512 - (size % 512)) % 512; cur = { skip: true }; continue; }
        const p = target(name); fs.mkdirSync(path.dirname(p), { recursive: true });
        out = fs.createWriteStream(p); left = size; pad = (512 - (size % 512)) % 512; cur = { skip: false };
        if (left === 0) { finish(); cur = null; if (pad) { cur = { padOnly: true }; } }
      }
      if (cur && cur.padOnly) { const n = Math.min(pad, buf.length); buf = buf.subarray(n); pad -= n; if (pad) break; cur = null; continue; }
      if (cur) {
        if (left > 0) { const n = Math.min(left, buf.length); if (!cur.skip) out.write(buf.subarray(0, n)); buf = buf.subarray(n); left -= n; if (left > 0) break; }
        finish();
        if (pad) { const n = Math.min(pad, buf.length); buf = buf.subarray(n); pad -= n; if (pad) { cur = { padOnly: true }; break; } }
        cur = null;
      }
    }
  }
  finish();
  await Promise.all(closing);
}
module.exports = { packDir, unpackTo };
