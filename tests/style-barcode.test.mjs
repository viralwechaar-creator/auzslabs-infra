import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

test('Style accepts equivalent UPC-A and EAN-13 without overriding existing codes', () => {
  const context = createContext({ window: {}, S: { cat: [] }, addEventListener() {} });
  for (const file of ['ds/scanner.js', 'style/data.js']) {
    runInContext(readFileSync(new URL('../app/public/' + file, import.meta.url), 'utf8'), context);
  }

  const lookup = (code) => context.findBarcode(code)?.variant.id;
  const styles = context.S.cat;
  const upc = '036000291452';
  const ean = '0036000291452';
  styles.push({ variants: [{ id: 'ean', barcode: ean }, { id: 'sku', sku: 'ABC' }] });
  assert.equal(lookup(upc), 'ean');
  assert.equal(lookup(' abc '), 'sku');

  styles.push({ variants: [{ id: 'upc', barcode: upc }] });
  assert.equal(lookup(upc), 'upc');
  styles.pop();

  styles.push({ code: upc, variants: [] });
  assert.equal(lookup(upc), undefined);
  styles.pop();

  const duplicate = { id: 'duplicate', barcode: ean };
  styles.push({ variants: [duplicate] });
  assert.equal(lookup(upc), undefined);
  duplicate.active = false;
  assert.equal(lookup(upc), 'ean');

  context.S.cat = [{ variants: [{ id: 'upc', barcode: upc }] }];
  assert.equal(lookup(ean), 'upc');
});
