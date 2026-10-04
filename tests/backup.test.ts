import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { call, callWithActions, fails, makeApp, register, today } from './helpers';
import { takeDownload } from '../src/core/web';
import { saveUpload } from '../src/core/modules/data/uploads';

const keyOf = (url: string) => url.split('/').pop()!;

test('a backup downloads to the browser and restores into the business that uploads it', async () => {
  const { app, dataDir, close } = makeApp();
  try {
    const a = await register(app, 'Acme Stores');
    const b = await register(app, 'Beta Mart', 'beta-pass');
    await call(app, 'sales.create', { date: today, items: [{ itemName: 'Tea', qty: 1, rate: 1000 }], payments: [{ mode: 'cash', amount: 1000 }] }, a);

    // The first backup is recorded in Acme's history, so the second one (restored below) lists it.
    await callWithActions(app, 'backup.create', undefined, a);
    const backup = await callWithActions(app, 'backup.create', undefined, a);
    const action = backup.actions.find((x) => x.type === 'download') as { url: string; fileName: string };
    assert.ok(action && action.fileName.endsWith('.bfbackup'));
    const file = takeDownload(keyOf(action.url))!;
    assert.equal(file.data.subarray(0, 15).toString(), 'SQLite format 3');
    assert.equal(takeDownload(keyOf(action.url)), null, 'download links work once');
    // Kept on the server in the business's own folder.
    assert.ok(fs.readdirSync(path.join(dataDir, 'backups', 'acme-stores')).some((f) => f.endsWith('-manual.bfbackup')));

    // Beta Mart restores Acme's backup: its own data is replaced (after a safety copy), Acme is untouched.
    const ctxB = app.ctx(b);
    const uploadId = saveUpload(dataDir, ctxB.businessId!, file.data);
    const info = await call(app, 'backup.inspectUpload', { uploadId }, b);
    assert.equal(info.businessName, 'Acme Stores');
    assert.equal(info.counts.bills, 1);
    assert.equal(await fails(app, 'backup.inspectUpload', { uploadId }, a), 'VALIDATION', 'another business cannot use the upload');
    const restored = await call(app, 'backup.restoreUpload', { uploadId }, b);
    assert.equal(restored.signInName, 'Beta Mart', 'Acme Stores is taken here, so Beta Mart keeps its sign-in name');
    assert.equal(await fails(app, 'customers.list', {}, b), 'UNAUTHENTICATED', 'everyone is logged out after a restore');
    assert.ok(fs.readdirSync(path.join(dataDir, 'backups', 'beta-mart')).some((f) => f.endsWith('-safety.bfbackup')));

    const b2 = (await call(app, 'auth.login', { businessName: 'Beta Mart', username: 'owner', password: 'secret1' })).token;
    assert.equal((await call(app, 'sales.list', { from: today, to: today }, b2)).rows.length, 1);
    assert.equal((await call(app, 'sales.list', { from: today, to: today }, a)).rows.length, 1);

    // The restored history lists Acme's backup file, which Beta Mart can never download.
    const list = await call(app, 'backup.list', undefined, b2);
    const acmeCopy = list.find((r: any) => r.kind === 'manual');
    assert.ok(acmeCopy);
    assert.equal(await fails(app, 'backup.download', { id: acmeCopy.id }, b2), 'NOT_FOUND');
  } finally {
    close();
  }
});

test('moving to another computer: restoring a backup there signs in with the business name from the backup', async () => {
  const oldPc = makeApp();
  const newPc = makeApp();
  try {
    const a = await register(oldPc.app, 'Acme Stores');
    await call(oldPc.app, 'sales.create', { date: today, items: [{ itemName: 'Tea', qty: 1, rate: 1000 }], payments: [{ mode: 'cash', amount: 1000 }] }, a);
    const made = await callWithActions(oldPc.app, 'backup.create', undefined, a);
    const file = takeDownload(keyOf((made.actions[0] as { url: string }).url))!;

    // On the new computer someone registers a placeholder business and restores the backup into it.
    const t = await register(newPc.app, 'New Computer', 'temp-pass');
    const uploadId = saveUpload(newPc.dataDir, newPc.app.ctx(t).businessId!, file.data);
    const restored = await call(newPc.app, 'backup.restoreUpload', { uploadId }, t);
    assert.equal(restored.signInName, 'Acme Stores');
    assert.equal(await fails(newPc.app, 'auth.login', { businessName: 'New Computer', username: 'owner', password: 'temp-pass' }), 'NOT_FOUND');
    const t2 = (await call(newPc.app, 'auth.login', { businessName: 'Acme Stores', username: 'owner', password: 'secret1' })).token;
    assert.equal((await call(newPc.app, 'sales.list', { from: today, to: today }, t2)).rows.length, 1);
  } finally {
    oldPc.close();
    newPc.close();
  }
});

test('a cashier cannot back up or restore', async () => {
  const { app, close } = makeApp();
  try {
    const owner = await register(app, 'Acme Stores');
    await call(app, 'users.create', { username: 'ravi', fullName: 'Ravi', role: 'cashier', password: 'cash1' }, owner);
    const ravi = (await call(app, 'auth.login', { businessName: 'Acme Stores', username: 'ravi', password: 'cash1' })).token;
    assert.equal(await fails(app, 'backup.create', undefined, ravi), 'FORBIDDEN');
    assert.equal(await fails(app, 'backup.restoreUpload', { uploadId: 'x'.repeat(24) }, ravi), 'FORBIDDEN');
  } finally {
    close();
  }
});

test('printing and exporting become browser actions', async () => {
  const { app, close } = makeApp();
  try {
    const t = await register(app, 'Acme Stores');
    const bill = await call(app, 'sales.create', { date: today, items: [{ itemName: 'Samosa', qty: 3, rate: 2000 }], payments: [{ mode: 'cash', amount: 6000 }] }, t);
    const printed = await callWithActions(app, 'sales.print', { id: bill.id }, t);
    assert.equal(printed.data.printed, true);
    assert.equal(printed.actions[0].type, 'print');
    assert.match((printed.actions[0] as { html: string }).html, /Samosa/);

    const report = { title: 'Test <report>', columns: [{ key: 'a', label: 'A' }], rows: [{ cells: { a: '<script>x</script>' } }] };
    const csv = await callWithActions(app, 'files.exportReport', { report, format: 'csv' }, t);
    assert.equal(csv.actions[0].type, 'download');
    const pdf = await callWithActions(app, 'files.exportReport', { report, format: 'pdf' }, t);
    assert.equal(pdf.data.printed, true, 'PDF is made with the browser print dialog');
    const html = (pdf.actions[0] as { html: string }).html;
    assert.ok(!html.includes('<script>x</script>'), 'report text is escaped');
  } finally {
    close();
  }
});
