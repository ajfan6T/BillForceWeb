import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, fails, makeApp, register, today, unbalancedEntries } from './helpers';
import { inspectBackup } from '../src/core/modules/data/backup';

/** A business with a bit of everything: settings, a cashier, lists, bills, a purchase and an expense. */
async function busyBusiness(app: Parameters<typeof call>[0]) {
  const owner = await register(app, 'Reset Stores', 'secret1');
  await call(app, 'settings.update', { section: 'business', values: { address: 'MG Road, Pune', upiId: 'reset@okaxis' } }, owner);
  await call(app, 'settings.update', { section: 'billing', values: { prefixes: { bill: 'RS' } } }, owner);
  await call(app, 'users.create', { username: 'cashier', fullName: 'Cashier One', role: 'cashier', password: 'cash1234' }, owner);
  const cashier = (await call<{ token: string }>(app, 'auth.login', { businessName: 'Reset Stores', username: 'cashier', password: 'cash1234' })).token;
  const item = await call(app, 'items.create', { name: 'Tea', unit: 'cup', rate: 1500 }, owner);
  const customer = await call(app, 'customers.create', { name: 'Anita', phone: '98200 11111', creditLimit: 1000000, openingBalance: { amount: 50000, direction: 'receivable' } }, owner);
  const supplier = await call(app, 'suppliers.create', { name: 'Leaf Traders', phone: '98200 22222' }, owner);
  await call(app, 'sales.create', { date: today, customerId: customer.id, items: [{ itemId: item.id, itemName: 'Tea', qty: 4, rate: 1500 }], payments: [] }, owner);
  await call(app, 'sales.create', { date: today, items: [{ itemId: item.id, itemName: 'Tea', qty: 2, rate: 1500 }], payments: [{ mode: 'cash', amount: 3000 }] }, owner);
  await call(app, 'purchases.create', { date: today, supplierId: supplier.id, items: [{ description: 'Tea leaves', qty: 1, rate: 40000 }] }, owner);
  return { owner, cashier, item, customer, supplier };
}

test('resetting with "keep my lists" deletes every transaction and keeps settings, logins and lists', async () => {
  const { app, close } = makeApp();
  try {
    const { owner, cashier, customer } = await busyBusiness(app);
    assert.equal((await call(app, 'sales.list', { from: today, to: today }, owner)).rows.length, 2);

    // Owner only, and only with the right password; a wrong one is recorded (it counts towards the lock-out).
    assert.equal(await fails(app, 'data.reset', { password: 'cash1234', keep: 'lists' }, cashier), 'FORBIDDEN');
    const wrong = await app.invoke('data.reset', { password: 'nope', keep: 'lists' }, owner);
    assert.equal(wrong.ok, false);
    if (!wrong.ok) {
      assert.equal(wrong.error.code, 'VALIDATION');
      assert.ok(wrong.error.fields?.password);
    }
    assert.equal(app.ctx(owner).db.value('SELECT failed_attempts FROM users WHERE username = ?', ['owner'], 0), 1);
    assert.equal((await call(app, 'sales.list', { from: today, to: today }, owner)).rows.length, 2, 'nothing was deleted');

    const r = await call(app, 'data.reset', { password: 'secret1', keep: 'lists' }, owner);
    assert.deepEqual(r.kept, { items: 1, customers: 1, suppliers: 1, employees: 0, users: 2 });
    assert.equal(r.signInName, 'Reset Stores');

    // Every login ended; the owner carries on with the new one.
    assert.equal(await fails(app, 'settings.get', undefined, owner), 'UNAUTHENTICATED');
    assert.equal(await fails(app, 'settings.get', undefined, cashier), 'UNAUTHENTICATED');
    const t = r.token;
    const settings = await call(app, 'settings.get', undefined, t);
    assert.equal(settings.business.address, 'MG Road, Pune');
    assert.equal(settings.business.upiId, 'reset@okaxis');
    assert.equal(settings.billing.prefixes.bill, 'RS');

    // Transactions are gone, numbering starts again, lists are kept with nothing owed.
    assert.equal((await call(app, 'sales.list', { from: today, to: today }, t)).rows.length, 0);
    assert.match((await call(app, 'sales.nextNumber', {}, t)).billNo, /^RS\/\d\d-\d\d\/0001$/);
    const ctx = app.ctx(t);
    for (const table of ['bills', 'bill_items', 'purchases', 'journal_entries', 'journal_lines', 'stock_moves', 'document_revisions']) {
      assert.equal(ctx.db.value(`SELECT COUNT(*) FROM ${table}`, undefined, -1), 0, table);
    }
    assert.deepEqual((await call<any[]>(app, 'items.list', {}, t)).map((i) => i.name), ['Tea']);
    const anita = await call(app, 'customers.get', { id: customer.id }, t);
    assert.equal(anita.name, 'Anita');
    assert.equal(anita.balance, 0);
    assert.equal(anita.creditLimit, 1000000);

    // The cashier signs in again with the same password; the business works as before.
    await call(app, 'auth.login', { businessName: 'Reset Stores', username: 'cashier', password: 'cash1234' });
    await call(app, 'sales.create', { date: today, customerId: customer.id, items: [{ itemName: 'Coffee', qty: 1, rate: 2000 }], payments: [{ mode: 'upi', amount: 2000 }] }, t);
    assert.equal(unbalancedEntries(app, t), 0);

    // The safety backup holds the old data and is in the list of backups; the reset is logged.
    const backups = await call<any[]>(app, 'backup.list', undefined, t);
    assert.ok(backups.some((b) => b.kind === 'safety'));
    const file = ctx.db.value<string>("SELECT path FROM backup_history WHERE kind = 'safety' ORDER BY id DESC LIMIT 1", undefined, '');
    assert.equal(inspectBackup(file).counts.bills, 2);
    const log = ctx.db.get<{ summary: string }>("SELECT summary FROM activity_log WHERE action = 'data.reset'");
    assert.match(log!.summary, /reset the business data: deleted all bills/);
  } finally {
    close();
  }
});

test('resetting with "delete everything" keeps only the settings and the logins', async () => {
  const { app, close } = makeApp();
  try {
    const { owner } = await busyBusiness(app);
    const r = await call(app, 'data.reset', { password: 'secret1', keep: 'nothing' }, owner);
    assert.deepEqual(r.kept, { items: 0, customers: 0, suppliers: 0, employees: 0, users: 2 });
    const ctx = app.ctx(r.token);
    for (const table of ['items', 'customers', 'suppliers', 'bills', 'purchases', 'journal_entries']) {
      assert.equal(ctx.db.value(`SELECT COUNT(*) FROM ${table}`, undefined, -1), 0, table);
    }
    assert.equal((await call(app, 'settings.get', undefined, r.token)).business.address, 'MG Road, Pune');
    assert.equal(ctx.db.value('SELECT COUNT(*) FROM users', undefined, 0), 2);
    // Other businesses on the server are not touched.
    const other = await register(app, 'Other Shop');
    assert.equal((await call(app, 'settings.get', undefined, other)).business.name, 'Other Shop');
    assert.equal(await fails(app, 'data.reset', { password: 'secret1', keep: 'everything' }, r.token), 'VALIDATION');
  } finally {
    close();
  }
});
