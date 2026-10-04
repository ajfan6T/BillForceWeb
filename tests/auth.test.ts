import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, fails, makeApp, register, today } from './helpers';

test('each business sees only its own data, and calls without a login see nothing', async () => {
  const { app, close } = makeApp();
  try {
    const a = await register(app, 'Acme Stores');
    const b = await register(app, 'Beta Mart');
    await call(app, 'sales.create', { date: today, items: [{ itemName: 'Tea', qty: 2, rate: 1500 }], payments: [{ mode: 'cash', amount: 3000 }] }, a);

    assert.equal((await call(app, 'sales.list', { from: today, to: today }, a)).rows.length, 1);
    assert.equal((await call(app, 'sales.list', { from: today, to: today }, b)).rows.length, 0);

    // No token, or a made-up one: never someone else's session.
    assert.equal(await fails(app, 'sales.list', { from: today, to: today }), 'UNAUTHENTICATED');
    assert.equal(await fails(app, 'sales.list', { from: today, to: today }, 'not-a-real-token'), 'UNAUTHENTICATED');
    const status = await call(app, 'app.status');
    assert.equal(status.session, null);
    assert.equal(status.businessName, 'Billforce');
  } finally {
    close();
  }
});

test('login is per business; logout ends only that session', async () => {
  const { app, close } = makeApp();
  try {
    await register(app, 'Acme Stores', 'acme-pass');
    await register(app, 'Beta Mart', 'beta-pass');
    assert.equal(await fails(app, 'auth.login', { businessName: 'Beta Mart', username: 'owner', password: 'acme-pass' }), 'UNAUTHENTICATED');
    assert.equal(await fails(app, 'auth.login', { businessName: 'Nobody Ltd', username: 'owner', password: 'acme-pass' }), 'NOT_FOUND');

    const one = (await call(app, 'auth.login', { businessName: 'acme stores', username: 'OWNER', password: 'acme-pass' })).token;
    const two = (await call(app, 'auth.login', { businessName: 'acme-stores', username: 'owner', password: 'acme-pass' })).token;
    assert.equal((await call(app, 'app.status', undefined, one)).businessName, 'Acme Stores');

    await call(app, 'auth.logout', undefined, one);
    assert.equal(await fails(app, 'customers.list', {}, one), 'UNAUTHENTICATED');
    assert.ok(await call(app, 'customers.list', {}, two));
  } finally {
    close();
  }
});

test('sessions survive a restart of the server', async () => {
  const { app, dataDir, close } = makeApp();
  const token = await register(app, 'Acme Stores');
  app.close();
  const { BillforceApp } = await import('../src/core/app');
  const { WebPlatform } = await import('../src/core/web');
  const again = new BillforceApp({ dataDir, platform: new WebPlatform(dataDir), version: 'test' });
  try {
    assert.equal((await call(again, 'app.status', undefined, token)).session.username, 'owner');
  } finally {
    again.close();
    close();
  }
});

test('wrong passwords lock the login for longer and longer', async () => {
  const { app, close } = makeApp();
  try {
    await register(app, 'Acme Stores', 'right-pass');
    for (let i = 0; i < 4; i++) await fails(app, 'auth.login', { businessName: 'Acme Stores', username: 'owner', password: 'nope' });
    const fifth = await app.invoke('auth.login', { businessName: 'Acme Stores', username: 'owner', password: 'nope' });
    assert.ok(!fifth.ok && /wait/i.test(fifth.error.message));
    // Even the right password waits until the lock ends.
    const locked = await app.invoke('auth.login', { businessName: 'Acme Stores', username: 'owner', password: 'right-pass' });
    assert.ok(!locked.ok && /wait/i.test(locked.error.message));
    // A minute later it works again.
    const realNow = app.clock;
    app.clock = () => new Date(realNow().getTime() + 61_000);
    assert.ok((await call(app, 'auth.login', { businessName: 'Acme Stores', username: 'owner', password: 'right-pass' })).token);
  } finally {
    close();
  }
});

test('the lock screen checks the password without ending the session', async () => {
  const { app, close } = makeApp();
  try {
    const token = await register(app, 'Acme Stores', 'right-pass');
    assert.equal(await fails(app, 'auth.unlock', { password: 'wrong' }, token), 'VALIDATION');
    await call(app, 'auth.unlock', { password: 'right-pass' }, token);
    assert.ok(await call(app, 'customers.list', {}, token));
  } finally {
    close();
  }
});

test('deactivating a user or resetting their password logs them out', async () => {
  const { app, close } = makeApp();
  try {
    const owner = await register(app, 'Acme Stores');
    const user = await call(app, 'users.create', { username: 'ravi', fullName: 'Ravi', role: 'cashier', password: 'cash1' }, owner);
    const ravi = (await call(app, 'auth.login', { businessName: 'Acme Stores', username: 'ravi', password: 'cash1' })).token;
    assert.ok(await call(app, 'customers.list', {}, ravi));
    // A cashier cannot see financial reports.
    assert.equal(await fails(app, 'reports.trialBalance', { to: today }, ravi), 'FORBIDDEN');

    await call(app, 'users.resetPassword', { id: user.id, newPassword: 'cash2' }, owner);
    assert.equal(await fails(app, 'customers.list', {}, ravi), 'UNAUTHENTICATED');

    const again = (await call(app, 'auth.login', { businessName: 'Acme Stores', username: 'ravi', password: 'cash2' })).token;
    await call(app, 'users.update', { id: user.id, fullName: 'Ravi', role: 'cashier', isActive: false }, owner);
    assert.equal(await fails(app, 'customers.list', {}, again), 'UNAUTHENTICATED');
  } finally {
    close();
  }
});

test('owner password recovery works per business with its recovery code', async () => {
  const { app, close } = makeApp();
  try {
    const reg = await call(app, 'business.register', { business: { name: 'Acme Stores' }, owner: { fullName: 'Asha', username: 'owner', password: 'old-pass' } });
    await register(app, 'Beta Mart');
    assert.equal(await fails(app, 'auth.recover', { businessName: 'Beta Mart', recoveryCode: reg.recoveryCode, newPassword: 'new-pass' }), 'VALIDATION');
    const res = await call(app, 'auth.recover', { businessName: 'Acme Stores', recoveryCode: reg.recoveryCode, newPassword: 'new-pass' });
    assert.notEqual(res.recoveryCode, reg.recoveryCode);
    // The old session ended; the new password works.
    assert.equal(await fails(app, 'customers.list', {}, reg.token), 'UNAUTHENTICATED');
    assert.ok((await call(app, 'auth.login', { businessName: 'Acme Stores', username: 'owner', password: 'new-pass' })).token);
  } finally {
    close();
  }
});

test('registration checks its input, names stay unique, and renaming the business keeps sign-in working', async () => {
  const { app, close } = makeApp();
  try {
    assert.equal(await fails(app, 'business.register', { business: { name: 'X' }, owner: { fullName: 'A', username: 'a b', password: 'secret1' } }), 'VALIDATION');
    const token = await register(app, 'Acme Stores');
    assert.equal(await fails(app, 'business.register', { business: { name: 'ACME STORES' }, owner: { fullName: 'A', username: 'owner', password: 'secret1' } }), 'CONFLICT');
    await register(app, 'Beta Mart');

    assert.equal(await fails(app, 'settings.update', { section: 'business', values: { name: 'Beta Mart' } }, token), 'VALIDATION');
    await call(app, 'settings.update', { section: 'business', values: { name: 'Acme Superstore' } }, token);
    assert.ok((await call(app, 'auth.login', { businessName: 'Acme Superstore', username: 'owner', password: 'secret1' })).token);
  } finally {
    close();
  }
});

test('registration can be closed on the server', async () => {
  const { app, close } = makeApp({ registrationOpen: false });
  try {
    assert.equal(await fails(app, 'business.register', { business: { name: 'Acme' }, owner: { fullName: 'A', username: 'owner', password: 'secret1' } }), 'FORBIDDEN');
    assert.equal((await call(app, 'app.status')).registrationOpen, false);
  } finally {
    close();
  }
});
