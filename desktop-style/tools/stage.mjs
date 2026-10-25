// Collects everything the Windows installer carries into desktop-style/stage/: the server (with its Windows node_modules), the app's
// pages, the database files, PostgreSQL, and the public licence key. Run on a Windows machine (the GitHub workflow does).
//   PG_DIR=<extracted PostgreSQL folder with bin, lib, share>  LICENCE_PUBLIC_KEY=<public key>  node tools/stage.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dd = path.resolve(here, '..'), root = path.resolve(dd, '..'), st = path.join(dd, 'stage');
fs.rmSync(st, { recursive: true, force: true }); fs.mkdirSync(st, { recursive: true });
const cp = (a, b, filter) => fs.cpSync(a, b, { recursive: true, filter });

cp(path.join(root, 'server'), path.join(st, 'server'), (s) => !/node_modules|[\\/]\.git/.test(s));
execSync('npm ci --omit=dev --no-audit --no-fund', { cwd: path.join(st, 'server'), stdio: 'inherit' });
cp(path.join(root, 'app', 'public'), path.join(st, 'app'));
cp(path.join(root, 'db'), path.join(st, 'db'), (s) => !/mannat/i.test(s));
const pub = (process.env.LICENCE_PUBLIC_KEY || '').trim();
if (!pub) throw new Error('LICENCE_PUBLIC_KEY is required (run tools/licence-keygen.mjs once and keep the public key)');
fs.writeFileSync(path.join(st, 'licence-public.txt'), pub);
if (process.env.PG_DIR) {
  for (const d of ['bin', 'lib', 'share']) if (fs.existsSync(path.join(process.env.PG_DIR, d))) cp(path.join(process.env.PG_DIR, d), path.join(st, 'pg', d));
} else console.warn('PG_DIR not set: PostgreSQL is not included (fine for a test run, not for an installer)');
fs.copyFileSync(path.join(root, 'app', 'public', 'icon-style-512.png'), path.join(dd, 'build', 'icon.png'));
console.log('staged in', st);
