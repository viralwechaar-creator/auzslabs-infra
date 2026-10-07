import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBrain } from '../lib/brain.js';
import { containsSecret, redactSecrets } from '../lib/secrets.js';

function tmpBrain() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-'));
  const root = path.join(tmp, 'brain'); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'Products.md'), '# Products\nPOS');
  fs.writeFileSync(path.join(tmp, 'outside.md'), 'secret outside');
  return { tmp, root, brain: createBrain(root) };
}

test('reads inside the brain work; traversal, absolute, hidden and non-md paths are refused', () => {
  const { brain } = tmpBrain();
  assert.equal(brain.readNote('Products.md'), '# Products\nPOS');
  for (const bad of ['../outside.md', '/etc/passwd', 'a/../../outside.md', '.hidden.md', 'x\0.md', 'Products.txt', 'C:/x.md', 'a\\b.md', '', 'sub//x.md']) {
    assert.throws(() => brain.readNote(bad), /not allowed|Only \.md|Outside/i, 'should refuse: ' + JSON.stringify(bad));
  }
});

test('a symlink pointing outside the brain cannot be read or listed', () => {
  const { tmp, root, brain } = tmpBrain();
  fs.symlinkSync(path.join(tmp, 'outside.md'), path.join(root, 'link.md'));
  fs.symlinkSync(tmp, path.join(root, 'linkdir'));
  assert.throws(() => brain.readNote('link.md'), /Outside/);
  assert.throws(() => brain.readNote('linkdir/outside.md'), /Outside/);
  assert.deepEqual(brain.listNotes().map((n) => n.rel), ['Products.md']);
});

test('writes are allowed only inside "Agents Office/" and only .md', () => {
  const { root, brain } = tmpBrain();
  assert.equal(brain.writeNote('Agents Office/x.md', 'hi'), 'Agents Office/x.md');
  assert.equal(fs.readFileSync(path.join(root, 'Agents Office/x.md'), 'utf8'), 'hi');
  for (const bad of ['Products.md', 'CLAUDE.md', 'Other/x.md', '../x.md', 'Agents Office/../Products.md', 'Agents Office/x.txt', 'Agents Office/.x.md']) {
    assert.throws(() => brain.writeNote(bad, 'x'), /allowed|inside|Outside/i, 'should refuse: ' + bad);
  }
  assert.equal(fs.readFileSync(path.join(root, 'Products.md'), 'utf8'), '# Products\nPOS');
});

test('a symlinked Agents Office folder or file cannot be used to escape on write', () => {
  const { tmp, root, brain } = tmpBrain();
  const out = path.join(tmp, 'elsewhere'); fs.mkdirSync(out);
  fs.symlinkSync(out, path.join(root, 'Agents Office'));
  assert.throws(() => brain.writeNote('Agents Office/x.md', 'x'), /Outside/);
  assert.equal(fs.readdirSync(out).length, 0);
  const b2 = tmpBrain();
  fs.mkdirSync(path.join(b2.root, 'Agents Office'));
  fs.symlinkSync(path.join(b2.tmp, 'outside.md'), path.join(b2.root, 'Agents Office', 'y.md'));
  assert.throws(() => b2.brain.writeNote('Agents Office/y.md', 'overwrite'), /Outside/);
  assert.equal(fs.readFileSync(path.join(b2.tmp, 'outside.md'), 'utf8'), 'secret outside');
});

test('keys and passwords are redacted on write and detected on scan', () => {
  const { root, brain } = tmpBrain();
  brain.writeNote('Agents Office/k.md', 'my key is sk-ant-api03-abcdefghijklmnop and password: hunter2hunter2');
  const saved = fs.readFileSync(path.join(root, 'Agents Office/k.md'), 'utf8');
  assert.ok(!/sk-ant|hunter2/.test(saved), saved);
  fs.writeFileSync(path.join(root, 'bad.md'), 'ANTHROPIC key sk-ant-api03-abcdefghijklmnop');
  assert.deepEqual(brain.scanForSecrets(), ['bad.md']);
  assert.ok(containsSecret('rzp_live_abcdef123456') && !containsSecret('plain text'));
  assert.equal(redactSecrets('a sk-ant-zzzzzzzzzzzz b'), 'a [REDACTED] b');
});

test('the seed brain contains no secrets', () => {
  const brain = createBrain(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../brain'));
  assert.deepEqual(brain.scanForSecrets(), []);
});
