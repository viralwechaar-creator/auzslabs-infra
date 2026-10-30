// AUZsLedger cash drawer (db/309): notes and coins on sales and purchases, deposits, withdrawals, loans, owner cash,
// opening/closing counts. Every cash movement must leave the drawer equal to the ledger Cash account.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx, fullView } from '../../lib/common.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, PASSWORD, USERS } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Cash drawer', 'Cash sales and purchases counted by note, bank deposit and withdrawal, loans, owner cash and drawer counts stay equal to the books.');
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const [owner, cashier] = await Promise.all([USERS.acctOwner, USERS.acctCashier].map(login));
  const call = async (tok, fn, args) => { const r = await rpc(stack, fn, args || {}, tok); return { ok: r.status === 200, status: r.status, data: r.data && r.data.data, error: r.data && r.data.error }; };
  const ok = async (tok, fn, args) => { const r = await call(tok, fn, args); assert(r.ok, `${fn}: ${r.status} ${r.error}`); return r.data; };
  const fails = async (tok, fn, args, re) => { const r = await call(tok, fn, args); assert(!r.ok, `${fn} should have been refused`); if (re) assert(re.test(r.error || ''), `${fn} wrong message: ${r.error}`); };
  const tid = (await q("select id from tenants where slug='testacct'"))[0].id;
  await q("update tenant_settings set features = features || '{\"accounting\":true}' where tenant_id=$1", [tid]);
  await ok(owner, 'acc_bootstrap');
  const cash = (await q('select id from acc_accounts where tenant_id=$1 and is_cash and not is_bank limit 1', [tid]))[0].id;
  const bank = (await q('select id from acc_accounts where tenant_id=$1 and is_bank limit 1', [tid]))[0].id;
  const cust = (await ok(owner, 'acc_save_party', { p: { kind: 'customer', name: 'Drawer Customer' } })).id;
  const supp = (await ok(owner, 'acc_save_party', { p: { kind: 'supplier', name: 'Drawer Supplier' } })).id;
  const st = async () => ok(owner, 'acc_drawer_status', { p: {} });
  const bookBal = async () => Number((await q("select coalesce(sum(jl.debit-jl.credit),0) b from acc_journal_lines jl join acc_accounts a on a.id=jl.account_id where a.tenant_id=$1 and a.is_cash and not a.is_bank", [tid]))[0].b);

  await s.check('A cash sale counted by notes: received minus change must equal the cash paid', async () => {
    const inv = await ok(owner, 'acc_save_document', { p: { doc_type: 'invoice', party_id: cust, post: true, lines: [{ description: 'Item', qty: 1, rate: 730 }], payments: [{ account_id: cash, amount: 730, mode: 'Cash' }] } });
    await fails(owner, 'acc_drawer_record', { p: { doc_id: inv.id, notes_in: { 500: 1, 100: 2 }, notes_out: {} } }, /received|match|cash/i);
    const r = await ok(owner, 'acc_drawer_record', { p: { doc_id: inv.id, notes_in: { 500: 1, 200: 1, 20: 1, 10: 1 }, notes_out: {}, op: 'drw-1' } });
    assert(r, 'no result');
    const again = await ok(owner, 'acc_drawer_record', { p: { doc_id: inv.id, notes_in: { 500: 1, 200: 1, 20: 1, 10: 1 }, notes_out: {}, op: 'drw-1' } });
    const n = (await q("select count(*)::int n from acc_drawer_moves where tenant_id=$1 and ref_id=$2", [tid, inv.id]))[0].n; assert(n === 1, 'replay made ' + n);
    const d = await st(); assert(Number(d.notes['500']) === 1 && Number(d.notes['200']) === 1 && Number(d.notes['20']) === 1, JSON.stringify(d.notes));
    assert(Math.abs(Number(d.balance) - (await bookBal())) < 0.01, 'drawer ' + d.balance + ' vs books ' + await bookBal());
  }, 'critical');

  await s.check('A sale with change given: notes in 1000, change out 270 for a 730 bill', async () => {
    const inv = await ok(owner, 'acc_save_document', { p: { doc_type: 'invoice', party_id: cust, post: true, lines: [{ description: 'Item 2', qty: 1, rate: 730 }], payments: [{ account_id: cash, amount: 730, mode: 'Cash' }] } });
    await ok(owner, 'acc_drawer_record', { p: { doc_id: inv.id, notes_in: { 500: 2 }, notes_out: { 200: 1, 50: 1, 20: 1 }, op: 'drw-2' } });
    const d = await st(); assert(Number(d.notes['500']) === 3, JSON.stringify(d.notes));
  });

  await s.check('A cash purchase takes notes out of the drawer', async () => {
    const bill = await ok(owner, 'acc_save_document', { p: { doc_type: 'bill', party_id: supp, post: true, lines: [{ description: 'Stock', qty: 1, rate: 300 }], payments: [{ account_id: cash, amount: 300, mode: 'Cash' }] } });
    await ok(owner, 'acc_drawer_record', { p: { doc_id: bill.id, notes_in: {}, notes_out: { 100: 3 }, op: 'drw-3' } });
    const d = await st(); assert(Math.abs(Number(d.balance) - (await bookBal())) < 0.01, 'drawer vs books');
  });

  await s.check('Deposit to bank, withdrawal, loans and owner cash move the books and the notes', async () => {
    const before = await bookBal(); const bb = Number((await q("select coalesce(sum(jl.debit-jl.credit),0) b from acc_journal_lines jl join acc_accounts a on a.id=jl.account_id where a.id=$1", [bank]))[0].b);
    await ok(owner, 'acc_drawer_move', { p: { kind: 'owner_in', amount: 1000, notes_in: { 500: 2 }, who: 'Owner', op: 'm1' } });
    await ok(owner, 'acc_drawer_move', { p: { kind: 'deposit', amount: 500, bank_account_id: bank, notes_out: { 500: 1 }, op: 'm2' } });
    await ok(owner, 'acc_drawer_move', { p: { kind: 'loan_taken', amount: 200, who: 'Ramesh', notes_in: { 100: 2 }, op: 'm3' } });
    await ok(owner, 'acc_drawer_move', { p: { kind: 'loan_given', amount: 100, who: 'Suresh', notes_out: { 100: 1 }, op: 'm4' } });
    await ok(owner, 'acc_drawer_move', { p: { kind: 'loan_collected', amount: 50, who: 'Suresh', notes_in: { 50: 1 }, op: 'm5' } });
    await ok(owner, 'acc_drawer_move', { p: { kind: 'loan_repaid', amount: 20, who: 'Ramesh', notes_out: { 20: 1 }, op: 'm6' } });
    await ok(owner, 'acc_drawer_move', { p: { kind: 'owner_out', amount: 10, notes_out: { 10: 1 }, op: 'm7' } });
    await ok(owner, 'acc_drawer_move', { p: { kind: 'withdraw', amount: 100, bank_account_id: bank, notes_in: { 100: 1 }, op: 'm8' } });
    const d = await st(); assert(Math.abs(Number(d.balance) - (await bookBal())) < 0.01, 'drawer ' + d.balance + ' vs books ' + await bookBal());
    assert(Math.abs((await bookBal()) - before - (1000 - 500 + 200 - 100 + 50 - 20 - 10 + 100)) < 0.01, 'cash delta wrong');
    const bb2 = Number((await q("select coalesce(sum(jl.debit-jl.credit),0) b from acc_journal_lines jl join acc_accounts a on a.id=jl.account_id where a.id=$1", [bank]))[0].b);
    assert(Math.abs(bb2 - bb - (500 - 100)) < 0.01, 'bank delta ' + (bb2 - bb));
    const dup = await ok(owner, 'acc_drawer_move', { p: { kind: 'owner_in', amount: 1000, notes_in: { 500: 2 }, op: 'm1' } });
    assert((await q("select count(*)::int n from acc_drawer_moves where tenant_id=$1 and client_op='m1'", [tid]))[0].n === 1, 'replay duplicated');
  }, 'critical');

  await s.check('Refusals: more than the drawer holds, notes that do not add up, unknown note, staff without permission', async () => {
    await fails(owner, 'acc_drawer_move', { p: { kind: 'deposit', amount: 99999999, bank_account_id: bank } }, /drawer|enough|more/i);
    await fails(owner, 'acc_drawer_move', { p: { kind: 'owner_in', amount: 500, notes_in: { 100: 1 } } }, /notes|match|add up/i);
    await fails(owner, 'acc_drawer_move', { p: { kind: 'owner_in', amount: 300, notes_in: { 300: 1 } } }, /note|coin|denomination/i);
    await fails(owner, 'acc_drawer_move', { p: { kind: 'deposit', amount: 10 } }, /bank/i);
    await fails(cashier, 'acc_drawer_move', { p: { kind: 'owner_in', amount: 10 } }, /does not allow|permission/i);
  });

  await s.check('Closing count: shortage is shown, optionally booked to Cash short and excess, and the drawer equals the books again', async () => {
    const d0 = await st();
    const counted = {}; for (const k of Object.keys(d0.notes)) counted[k] = Math.max(0, Number(d0.notes[k]));
    const total = Object.entries(counted).reduce((a, [k, v]) => a + Number(k) * v, 0);
    const c = await ok(owner, 'acc_drawer_count', { p: { kind: 'close', counted, adjust: true, note: 'test' } });
    assert(c && Math.abs(Number(c.diff) - (total - Number(d0.balance))) < 0.01, JSON.stringify(c));
    const d1 = await st(); assert(Math.abs(Number(d1.balance) - (await bookBal())) < 0.01, 'after adjust'); assert(d1.last_count && d1.last_count.kind === 'close', 'last count');
    assert(Math.abs(Number(d1.balance) - total) < 0.01, 'balance should equal counted ' + total + ' got ' + d1.balance);
  }, 'critical');

  await s.check('A voided movement is reversed in the books', async () => {
    const m = (await q("select id from acc_drawer_moves where tenant_id=$1 and client_op='m7'", [tid]))[0].id;
    const before = await bookBal();
    await ok(owner, 'acc_drawer_void', { p_id: m, p_reason: 'test' });
    assert(Math.abs((await bookBal()) - before - 10) < 0.01, 'void did not restore 10');
    const b2 = await bookBal(); await ok(owner, 'acc_drawer_void', { p_id: m, p_reason: 'again' }); assert(Math.abs((await bookBal()) - b2) < 0.01, 'second void changed the books');
  });

  await s.check('Activity lists tracked and untracked cash payments together', async () => {
    const inv = await ok(owner, 'acc_save_document', { p: { doc_type: 'invoice', party_id: cust, post: true, lines: [{ description: 'Untracked', qty: 1, rate: 55 }], payments: [{ account_id: cash, amount: 55, mode: 'Cash' }] } });
    const d = await st(); assert(d.activity.some((a) => a.amount == 55 && a.counted === false), 'untracked cash sale missing');
    assert(d.activity.some((a) => a.kind === 'owner_in'), 'owner_in missing');
  });
  for (const [label, o] of [['desktop', { w: 1280, h: 900 }], ['phone', { w: 390, h: 844, mobile: true }]]) {
    await s.check('In the browser (' + label + '): the Cash drawer page shows the balance by note, move buttons and activity; a cash sale is counted by notes', async () => {
      await ok(owner, 'acc_drawer_move', { p: { kind: 'owner_in', amount: 2000, who: 'Owner' } });
      const ctx = await newCtx(browser, stack, o); const page = await ctx.newPage(); const errs = watch(page);
      await page.goto(stack.url('testacct', '/accounts.html')); await page.waitForSelector('input[type=password]');
      await page.fill('input[type=email]', USERS.acctOwner); await page.fill('input[type=password]', PASSWORD);
      await page.locator('button', { hasText: /^Sign in$/ }).click(); await page.waitForSelector('.shell', { timeout: 15000 });
      await page.evaluate(() => { location.hash = '#/drawer'; });
      await page.waitForSelector('.dr-notes', { timeout: 10000 });
      const txt = await page.locator('main, .content, body').first().innerText();
      assert(/Cash in the books/.test(txt) && /Deposit to bank/.test(txt) && /₹500 note/.test(txt) && /Owner/i.test(txt), 'page text: ' + txt.slice(0, 300));
      const sw = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert(sw <= 1, 'sideways scroll ' + sw);
      // counter sheet from a move form
      await page.locator('.dr-moves button', { hasText: 'Deposit to bank' }).click();
      await page.fill('input[aria-label=Amount]', '300');
      await page.locator('button', { hasText: /Count notes/ }).click();
      await page.waitForSelector('.dn-in');
      await page.locator('.dn-row', { hasText: '₹100 note' }).first().locator('input').fill('3');
      await page.locator('button', { hasText: /^Save count$/ }).click();
      await page.waitForSelector('.dn-in', { state: 'detached', timeout: 5000 });
      await page.locator('button', { hasText: /^Save$/ }).click();
      let d; for (let i = 0; i < 20; i++) { d = await st(); if (d.activity.some((a) => a.kind === 'deposit' && a.amount == 300)) break; await page.waitForTimeout(300); }
      assert(d.activity.some((a) => a.kind === 'deposit' && a.amount == 300), 'deposit not saved');
      const real = errs.filter((e) => !/sentry/i.test(e)); assert(!real.length, 'script errors: ' + real.slice(0, 2).join(' | '));
      await ctx.close();
    }, 'major');
  }
  return s;
}
