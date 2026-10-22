// One-off: makes the small picture copies (see storage.js makeThumbs) for pictures uploaded before they existed.
// Run on the server:  docker compose exec api node src/tools/make-thumbs.js
// Safe to run again: it skips pictures that already have both copies. It works two at a time and does not interrupt the app.
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeThumbs, THUMB_WIDTHS } from '../storage.js';

const ROOT = (process.env.UPLOAD_ROOT || '/data/uploads') + '/site';
let seen = 0, made = 0, failed = 0;
async function walk(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { await walk(p); continue; }
    if (!/\.(jpe?g|png|webp)$/i.test(e.name) || /\.w\d+\.webp$/i.test(e.name)) continue;
    seen++;
    const base = p.replace(/\.[a-z0-9]+$/i, '');
    const have = await Promise.all(THUMB_WIDTHS.map((w) => fs.stat(`${base}.w${w}.webp`).then(() => true, () => false)));
    if (have.every(Boolean)) continue;
    (await makeThumbs(p)) ? made++ : failed++;
    if ((made + failed) % 50 === 0) console.log(`... ${made} made, ${failed} failed`);
  }
}
await walk(ROOT);
console.log(`Done. ${seen} pictures checked, ${made} got small copies, ${failed} could not be read.`);
process.exit(0);
