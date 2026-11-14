import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { call, fails, makeApp, register, today } from './helpers';

const ADMIN = { username: 'admin', password: 'super-secret-1' };
// The admin manages a server's data files; the browser edition keeps its data inside the browser.
const onDisk = { skip: process.env.BILLFORCE_TEST_ENGINE === 'browser' };

test('the server admin signs in with its own login, and only then', () => {
  const { app, close } = makeApp({ admin: ADMIN });
  try {
    assert.equal(app.adminSessions.enabled, true);
    assert.equal(app.adminSessions.login('admin', 'wrong'), null);
    assert.equal(app.adminSessions.login('someone', ADMIN.password), null);
    const token = app.adminSessions.login('Admin ', ADMIN.password);
    assert.ok(token && app.adminSessions.valid(token));
    assert.equal(app.adminSessions.valid('not-a-token'), false);
    app.adminSessions.logout(token);
    assert.equal(app.adminSessions.valid(token), false);
  } finally {
    close();
  }
  // Without a password set, there is no admin at all.
  const none = makeApp();
  try {
    assert.equal(none.app.adminSessions.enabled, false);
    assert.equal(none.app.adminSessions.login('admin', ''), null);
  } finally {
    none.close();
  }
});

test('the admin sees every business, turns one off, resets its owner password, backs it up and removes it', onDisk, async () => {
  const { app, dataDir, close } = makeApp({ admin: ADMIN });
  try {
    const t1 = await register(app, 'Corner Shop', 'secret1');
    await call(app, 'sales.create', { date: today, items: [{ itemName: 'Tea', qty: 2, rate: 1500 }], payments: [{ mode: 'cash', amount: 3000 }] }, t1);
    await register(app, 'Hill Cafe', 'secret2');

    // The list: owner, contact details and how much each is used.
    const list = app.adminBusinesses();
    assert.deepEqual(list.map((b) => b.name).sort(), ['Corner Shop', 'Hill Cafe']);
    const corner = list.find((b) => b.name === 'Corner Shop')!;
    assert.equal(corner.owner?.username, 'owner');
    assert.equal(corner.bills, 1);
    assert.equal(corner.sales, 3000);
    assert.equal(corner.lastBillDate, today);
    assert.equal(corner.users, 1);
    assert.ok(corner.sizeBytes > 0);
    assert.equal(corner.disabled, false);
    assert.equal(corner.problem, null);

    // Turned off: signed out at once, cannot sign in; turned on again: works.
    assert.equal(app.adminSetDisabled(corner.id, true).disabled, true);
    assert.equal((await app.invoke('auth.me', undefined, t1)).ok && (await call(app, 'auth.me', undefined, t1)), null);
    const blocked = await app.invoke('auth.login', { businessName: 'Corner Shop', username: 'owner', password: 'secret1' });
    assert.ok(!blocked.ok && blocked.error.code === 'FORBIDDEN' && /turned off/.test(blocked.error.message));
    app.adminSetDisabled(corner.id, false);
    const back = await call(app, 'auth.login', { businessName: 'Corner Shop', username: 'owner', password: 'secret1' });
    assert.ok(back.token);

    // Owner password reset: the old one stops working, the temporary one must be changed at sign-in.
    const reset = app.adminResetOwnerPassword(corner.id);
    assert.equal(reset.username, 'owner');
    assert.match(reset.password, /^[a-z]+-\d{4}$/);
    assert.equal(await fails(app, 'auth.login', { businessName: 'Corner Shop', username: 'owner', password: 'secret1' }), 'UNAUTHENTICATED');
    const again = await call(app, 'auth.login', { businessName: 'Corner Shop', username: 'owner', password: reset.password });
    assert.equal((await call(app, 'auth.me', undefined, again.token)).mustChangePassword, true);

    // A backup is a whole database file.
    const backup = app.adminBackup(corner.id);
    assert.match(backup.fileName, /^corner-shop-\d+\.bfbackup$/);
    assert.equal(backup.data.subarray(0, 15).toString(), 'SQLite format 3');

    // Removing needs the exact name; a copy is kept; the other business is untouched.
    assert.throws(() => app.adminDeleteBusiness(corner.id, 'corner'), /Type the business name exactly/);
    const removed = app.adminDeleteBusiness(corner.id, 'corner shop');
    assert.ok(fs.existsSync(removed.keptCopy) && removed.keptCopy.startsWith(path.join(dataDir, 'deleted')));
    assert.deepEqual(app.adminBusinesses().map((b) => b.name), ['Hill Cafe']);
    assert.equal(await fails(app, 'auth.login', { businessName: 'Corner Shop', username: 'owner', password: reset.password }), 'NOT_FOUND');
    assert.ok((await call(app, 'auth.login', { businessName: 'Hill Cafe', username: 'owner', password: 'secret2' })).token);
  } finally {
    close();
  }
});
