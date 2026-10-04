import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BillforceApp } from '../src/core/app';
import { TestPlatform } from '../src/core/platform';
import { WebPlatform } from '../src/core/web';
import { autoBackupDue } from '../src/core/modules/data/backup';
import { updateSection } from '../src/core/settings';
import { defaultSettings } from '../src/shared/settings';
import { call, callWithActions, fails, register } from './helpers';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'billforce-test-'));
const login = async (app: BillforceApp) => (await call(app, 'auth.login', { businessName: 'Acme Stores', username: 'owner', password: 'secret1' })).token as string;
const autoBackups = (app: BillforceApp, token: string) => app.ctx(token).db.value<number>('SELECT COUNT(*) FROM backup_history WHERE kind = ?', ['auto'], 0);

test('automatic backups are due after a day, a week or a month', () => {
  const base = defaultSettings('2026-01-01').backup;
  const at = (frequency: 'daily' | 'weekly' | 'monthly', last: string | null, today: string) => autoBackupDue({ ...base, frequency, lastAutoBackupAt: last }, today);
  assert.equal(at('daily', null, '2026-01-10'), true, 'never backed up');
  assert.equal(at('daily', '2026-01-10 18:30:00', '2026-01-10'), false);
  assert.equal(at('daily', '2026-01-10 18:30:00', '2026-01-11'), true, 'first change of the next day');
  assert.equal(at('weekly', '2026-01-10 09:00:00', '2026-01-16'), false);
  assert.equal(at('weekly', '2026-01-10 09:00:00', '2026-01-17'), true);
  assert.equal(at('monthly', '2026-01-10 09:00:00', '2026-02-08'), false);
  assert.equal(at('monthly', '2026-01-10 09:00:00', '2026-02-09'), true);
  assert.equal(at('daily', '2027-05-01 09:00:00', '2026-01-10'), true, 'a clock that was wrong does not stop backups');
  assert.equal(autoBackupDue({ ...base, autoBackup: false, lastAutoBackupAt: null }, '2026-01-10'), false, 'switched off');
});

test('the app keeps automatic backups as often as chosen, and makes a waiting one before it quits', async () => {
  const dataDir = tempDir();
  let clock = new Date(2026, 0, 10, 10, 0, 0);
  const app = new BillforceApp({ dataDir, platform: new WebPlatform(dataDir), version: 'test', clock: () => clock });
  try {
    let t = await register(app, 'Acme Stores');
    await call(app, 'settings.update', { section: 'backup', values: { frequency: 'weekly' } }, t);
    assert.equal(autoBackups(app, t), 0, 'waits for changes to settle');
    app.finishPendingBackups();
    assert.equal(autoBackups(app, t), 1);

    clock = new Date(2026, 0, 14, 11, 0, 0);
    t = await login(app);
    await call(app, 'settings.update', { section: 'backup', values: { keepCount: 31 } }, t);
    app.finishPendingBackups();
    assert.equal(autoBackups(app, t), 1, 'not again within the week');

    clock = new Date(2026, 0, 17, 9, 0, 0);
    t = await login(app);
    await call(app, 'settings.update', { section: 'backup', values: { keepCount: 32 } }, t);
    app.finishPendingBackups();
    assert.equal(autoBackups(app, t), 2, 'a week later');
    const note = app.ctx(t).db.value<string>("SELECT note FROM backup_history WHERE kind = 'auto' ORDER BY id DESC LIMIT 1", undefined, '');
    assert.equal(note, 'Automatic weekly backup');

    await call(app, 'settings.update', { section: 'backup', values: { autoBackup: false } }, t);
    app.finishPendingBackups();
    clock = new Date(2026, 1, 20, 9, 0, 0);
    t = await login(app);
    await call(app, 'settings.update', { section: 'backup', values: { keepCount: 33 } }, t);
    app.finishPendingBackups();
    assert.equal(autoBackups(app, t), 2, 'switched off');

    assert.equal(await fails(app, 'settings.update', { section: 'backup', values: { frequency: 'hourly' } }, t), 'VALIDATION');
  } finally {
    app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

// The Windows app works on real files; the browser engine keeps files in memory, where folders cannot fail.
test('Windows app: backups go to the chosen folder, and to Billforce\'s own folder when it cannot be used', { skip: process.env.BILLFORCE_TEST_ENGINE === 'browser' }, async () => {
  const dataDir = tempDir();
  const docs = tempDir();
  const platform = new TestPlatform(docs);
  (platform as { kind: string }).kind = 'electron';
  const ownFolder = path.join(docs, 'Billforce Backups', 'acme-stores');
  const app = new BillforceApp({ dataDir, platform, version: 'test', backupRoot: path.join(docs, 'Billforce Backups') });
  try {
    const t = await register(app, 'Acme Stores');
    assert.deepEqual(await call(app, 'backup.folder', undefined, t), { folder: ownFolder, isDefault: true, canChoose: true });

    // Back up now: kept in the folder on this computer, no download and no save dialog.
    const first = await callWithActions(app, 'backup.create', undefined, t);
    assert.equal(first.data.folder, ownFolder);
    assert.equal(first.actions.length, 0);
    assert.equal(platform.saved.length, 0);
    assert.ok(fs.existsSync(path.join(ownFolder, first.data.fileName)));

    // Choose a pen drive folder.
    const pen = path.join(docs, 'PenDrive');
    platform.nextPickFolder = path.join(pen, 'Backups');
    const chosen = await call(app, 'backup.chooseFolder', undefined, t);
    assert.deepEqual(chosen, { folder: path.join(pen, 'Backups'), isDefault: false, canChoose: true, changed: true });
    const second = await call(app, 'backup.create', undefined, t);
    assert.equal(second.folder, path.join(pen, 'Backups'));
    assert.equal(second.fellBackFrom, null);
    assert.ok(fs.existsSync(path.join(pen, 'Backups', second.fileName)));

    // The pen drive is gone: the backup is still made, in Billforce's own folder, and the user is told.
    fs.rmSync(pen, { recursive: true, force: true });
    fs.writeFileSync(pen, 'not a folder any more');
    const third = await call(app, 'backup.create', undefined, t);
    assert.equal(third.folder, ownFolder);
    assert.equal(third.fellBackFrom, path.join(pen, 'Backups'));
    assert.ok(fs.existsSync(path.join(ownFolder, third.fileName)));
    assert.equal(await fails(app, 'backup.openFolder', undefined, t), 'VALIDATION');

    // Save a copy of a backup somewhere else (the save dialog).
    const list = await call(app, 'backup.list', undefined, t);
    const copy = await call(app, 'backup.download', { id: list[0].id }, t);
    assert.equal(copy.savedTo, path.join(docs, third.fileName));
    assert.equal(platform.saved.length, 1);
    await call(app, 'backup.showInFolder', { id: list[0].id }, t);

    // A folder Billforce cannot write to is refused; going back to the own folder works.
    platform.nextPickFolder = path.join(pen, 'inside-a-file');
    assert.equal(await fails(app, 'backup.chooseFolder', undefined, t), 'VALIDATION');
    assert.deepEqual(await call(app, 'backup.useDefaultFolder', undefined, t), { folder: ownFolder, isDefault: true, canChoose: true });

    // The folder is never changed through the normal settings form.
    assert.equal(await fails(app, 'settings.update', { section: 'backup', values: { folder: docs } }, t), 'VALIDATION');
    const about = await call(app, 'settings.about', undefined, t);
    assert.equal(about.dataFile, path.join(dataDir, 'businesses', 'acme-stores.db'));
  } finally {
    app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(docs, { recursive: true, force: true });
  }
});

test('a server never uses a backup folder from the settings', async () => {
  const dataDir = tempDir();
  const elsewhere = path.join(tempDir(), 'elsewhere');
  const app = new BillforceApp({ dataDir, platform: new WebPlatform(dataDir), version: 'test' });
  try {
    const t = await register(app, 'Acme Stores');
    assert.deepEqual(await call(app, 'backup.folder', undefined, t), { folder: null, isDefault: true, canChoose: false });
    assert.equal(await fails(app, 'backup.chooseFolder', undefined, t), 'VALIDATION');
    assert.equal(await fails(app, 'backup.openFolder', undefined, t), 'VALIDATION');
    assert.equal(await fails(app, 'settings.update', { section: 'backup', values: { folder: elsewhere } }, t), 'VALIDATION');
    assert.equal((await call(app, 'settings.about', undefined, t)).dataFile, null, 'server paths are not shown');

    // Even a folder that came with a backup made in the Windows app is ignored here.
    updateSection(app.ctx(t), 'backup', { folder: elsewhere });
    const made = await callWithActions(app, 'backup.create', undefined, t);
    assert.equal(made.data.folder, null);
    assert.equal(made.actions[0]?.type, 'download');
    assert.ok(fs.existsSync(path.join(dataDir, 'backups', 'acme-stores', made.data.fileName)));
    assert.equal(fs.existsSync(elsewhere), false);
  } finally {
    app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(path.dirname(elsewhere), { recursive: true, force: true });
  }
});
