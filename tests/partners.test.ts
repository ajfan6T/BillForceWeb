import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, fails, makeApp, register, today, unbalancedEntries } from './helpers';
import { addDays, fyOf } from '../src/shared/dates';

const thisYear = fyOf(today);
const lastYear = fyOf(addDays(thisYear.start, -1));
const d = (n: number) => addDays(lastYear.start, n);

test('partners invest, pay expenses from their own money, take money out and share the profit at year end', async () => {
  const { app, close } = makeApp();
  try {
    const t = await register(app, 'Twin Cafe', 'secret1', { booksStartDate: lastYear.start });
    const asha = await call(app, 'partners.create', { name: 'Asha', phone: '98200 11111', sharePct: 60, joinedOn: lastYear.start }, t);
    const bilal = await call(app, 'partners.create', { name: 'Bilal', sharePct: 40 }, t);
    // Each partner has a capital and a drawings account of their own.
    const accounts = await call<any[]>(app, 'accounts.list', { groups: ['capital', 'drawings'] }, t);
    for (const name of ['Asha - Capital', 'Asha - Drawings', 'Bilal - Capital', 'Bilal - Drawings']) assert.ok(accounts.some((a) => a.name === name), name);

    // Shares can never add up to more than 100%.
    assert.equal(await fails(app, 'partners.create', { name: 'Chetan', sharePct: 10 }, t), 'VALIDATION');
    assert.equal(await fails(app, 'partners.create', { name: 'asha', sharePct: 0 }, t), 'VALIDATION');

    await call(app, 'partners.invest', { partnerId: asha.id, date: d(1), amount: 100000, mode: 'cash' }, t);
    await call(app, 'partners.invest', { partnerId: bilal.id, date: d(1), amount: 50000, mode: 'upi' }, t);
    await call(app, 'sales.create', { date: d(10), items: [{ itemName: 'Coffee', qty: 3, rate: 10000 }], payments: [{ mode: 'cash', amount: 30000 }] }, t);
    const heads = await call<any[]>(app, 'accounts.list', { types: ['expense'] }, t);
    const rent = heads.find((h) => /rent/i.test(h.name));
    // Bilal paid the rent himself: nothing leaves the cash box; the business owes it to him.
    const exp = await call(app, 'expenses.create', { date: d(15), accountId: rent.id, amount: 20000, mode: 'credit', partnerId: bilal.id, payee: 'Landlord' }, t);
    assert.equal(exp.partnerName, 'Bilal');
    assert.equal(exp.mode, 'credit');
    assert.deepEqual(exp.posting.map((l: any) => [l.accountName, l.debit, l.credit]), [
      [rent.name, 20000, 0],
      ['Bilal - Capital', 0, 20000],
    ]);
    await call(app, 'partners.withdraw', { partnerId: asha.id, date: d(20), amount: 5000, mode: 'cash' }, t);

    const list = await call(app, 'expenses.list', { from: lastYear.start, to: lastYear.end, partnerId: bilal.id }, t);
    assert.equal(list.rows.length, 1);
    assert.equal(list.totals.partner, 20000);
    assert.equal(list.totals.credit, 0);
    const summary = await call(app, 'expenses.summary', { from: lastYear.start, to: lastYear.end }, t);
    assert.ok(summary.summary.some((s: any) => s.label === 'Paid by partners' && s.value === 20000));

    let overview = await call(app, 'partners.list', undefined, t);
    assert.equal(overview.totalShare, 100);
    const before = (id: number) => overview.partners.find((p: any) => p.id === id).totals;
    assert.deepEqual(before(asha.id), { invested: 100000, paidForBusiness: 0, withdrawn: 5000, profitShare: 0, other: 0, balance: 95000 });
    assert.deepEqual(before(bilal.id), { invested: 50000, paidForBusiness: 20000, withdrawn: 0, profitShare: 0, other: 0, balance: 70000 });

    // The year cannot be closed while the shares do not add up to 100%.
    await call(app, 'partners.update', { id: bilal.id, name: 'Bilal', sharePct: 30 }, t);
    let year = (await call<any[]>(app, 'yearEnd.list', undefined, t)).find((y) => y.start === lastYear.start);
    assert.equal(year.canClose, false);
    assert.match(year.closeBlockedReason, /add up to 90%/);
    await call(app, 'partners.update', { id: bilal.id, name: 'Bilal', sharePct: 40 }, t);
    year = (await call<any[]>(app, 'yearEnd.list', undefined, t)).find((y) => y.start === lastYear.start);
    assert.equal(year.canClose, true, year.closeBlockedReason);
    assert.equal(year.netProfit, 10000);

    // Closing: the ₹100 profit goes 60 / 40, and each partner's drawings into their own capital.
    const preview = await call(app, 'yearEnd.preview', { fyStart: lastYear.start, transferDrawings: true }, t);
    assert.equal(preview.capitalAccountName, "the partners' capital accounts");
    await call(app, 'yearEnd.close', { fyStart: lastYear.start, transferDrawings: true }, t);
    overview = await call(app, 'partners.list', undefined, t);
    const after = (id: number) => overview.partners.find((p: any) => p.id === id).totals;
    assert.deepEqual(after(asha.id), { invested: 100000, paidForBusiness: 0, withdrawn: 5000, profitShare: 6000, other: 0, balance: 101000 });
    assert.deepEqual(after(bilal.id), { invested: 50000, paidForBusiness: 20000, withdrawn: 0, profitShare: 4000, other: 0, balance: 74000 });
    assert.equal(unbalancedEntries(app, t), 0);

    // The balance sheet lists each partner's capital; the statement shows every movement.
    const bs = JSON.stringify(await call(app, 'reports.balanceSheet', { asOf: lastYear.end }, t));
    assert.ok(bs.includes('Asha - Capital') && bs.includes('Bilal - Capital'));
    const st = await call(app, 'partners.statement', { id: asha.id, from: lastYear.start, to: lastYear.end }, t);
    assert.deepEqual(st.rows.slice(1, -1).map((r: any) => [r.cells.kind, r.cells.added, r.cells.withdrawn]), [
      ['Investment', 100000, null],
      ['Withdrawal', null, 5000],
      ['Year-end closing', 6000, null],
    ]);
    assert.equal(st.rows.at(-1).cells.balance, 101000);

    // Renaming a partner renames their accounts; a partner who left keeps their balance.
    await call(app, 'partners.update', { id: asha.id, name: 'Asha Rao', sharePct: 60 }, t);
    const renamed = await call<any[]>(app, 'accounts.list', { groups: ['capital'] }, t);
    assert.ok(renamed.some((a) => a.name === 'Asha Rao - Capital'));
    await call(app, 'partners.update', { id: bilal.id, name: 'Bilal', sharePct: 40, isActive: false }, t);
    assert.equal(await fails(app, 'partners.invest', { partnerId: bilal.id, amount: 1000, mode: 'cash' }, t), 'VALIDATION');
    assert.equal((await call(app, 'partners.get', { id: bilal.id }, t)).totals.balance, 74000);
    assert.deepEqual((await call<any[]>(app, 'partners.options', undefined, t)).map((p) => [p.name, p.isActive]), [
      ['Asha Rao', true],
      ['Bilal', false],
    ]);
  } finally {
    close();
  }
});

test('a business without partners closes the year into the owner\'s capital as before, and a reset keeps the partners', async () => {
  const { app, close } = makeApp();
  try {
    const t = await register(app, 'Solo Shop', 'secret1', { booksStartDate: lastYear.start });
    await call(app, 'sales.create', { date: d(5), items: [{ itemName: 'Tea', qty: 1, rate: 5000 }], payments: [{ mode: 'cash', amount: 5000 }] }, t);
    const preview = await call(app, 'yearEnd.preview', { fyStart: lastYear.start, transferDrawings: true }, t);
    assert.equal(preview.capitalAccountName, "Owner's Capital");
    assert.ok(preview.lines.some((l: any) => l.accountName === "Owner's Capital" && l.credit === 5000));

    const p = await call(app, 'partners.create', { name: 'Ravi', sharePct: 100 }, t);
    await call(app, 'partners.invest', { partnerId: p.id, date: today, amount: 70000, mode: 'cash' }, t);
    const r = await call(app, 'data.reset', { password: 'secret1', keep: 'nothing' }, t);
    const kept = await call(app, 'partners.list', undefined, r.token);
    assert.deepEqual(kept.partners.map((x: any) => [x.name, x.sharePct, x.totals.balance]), [['Ravi', 100, 0]]);
  } finally {
    close();
  }
});
