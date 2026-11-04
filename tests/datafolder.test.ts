import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BillforceApp } from '../src/core/app';
import { WebPlatform } from '../src/core/web';
import { call, register, today } from './helpers';

// Moving or copying a data folder on disk is a server (and Windows app) matter: the browser edition keeps its
// data inside the browser, and its file stand-in has no folder copy or rename.
const onDisk = { skip: process.env.BILLFORCE_TEST_ENGINE === 'browser' };

const open = (dataDir: string) => new BillforceApp({ dataDir, platform: new WebPlatform(dataDir), version: 'test' });
const login = async (app: BillforceApp) => (await call<{ token: string }>(app, 'auth.login', { businessName: 'Moving Shop', username: 'owner', password: 'secret1' })).token;
const billCount = async (app: BillforceApp, t: string) => (await call(app, 'sales.list', { from: today, to: today }, t)).rows.length;
const sale = (app: BillforceApp, t: string) => call(app, 'sales.create', { date: today, items: [{ itemName: 'Tea', qty: 1, rate: 1500 }], payments: [{ mode: 'cash', amount: 1500 }] }, t);

/** A data folder with one business, one bill and one backup. */
async function makeFolder(root: string): Promise<string> {
  const dir = path.join(root, 'original');
  const app = open(dir);
  const t = await register(app, 'Moving Shop', 'secret1');
  await sale(app, t);
  await call(app, 'backup.create', undefined, t);
  app.close();
  return dir;
}

test('a copy of the data folder works on its own files, never on the folder it was copied from', onDisk, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'billforce-folder-'));
  try {
    const original = await makeFolder(root);
    const id = JSON.parse(fs.readFileSync(path.join(original, 'businesses.json'), 'utf8'))[0].id;

    // Work in a copy: the original is not touched.
    const copy = path.join(root, 'copy');
    fs.cpSync(original, copy, { recursive: true });
    const b = open(copy);
    const tb = await login(b);
    await sale(b, tb);
    assert.equal(await billCount(b, tb), 2);
    b.close();
    // The copy's registry now names its own files (full paths, which older versions understand).
    assert.equal(JSON.parse(fs.readFileSync(path.join(copy, 'businesses.json'), 'utf8'))[0].dbPath, path.join(copy, 'businesses', `${id}.db`));
    const a = open(original);
    assert.equal(await billCount(a, await login(a)), 1, 'the original still has its one bill');
    a.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a moved data folder still works, and nothing is written to the old location', onDisk, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'billforce-folder-'));
  try {
    const original = await makeFolder(root);
    const id = JSON.parse(fs.readFileSync(path.join(original, 'businesses.json'), 'utf8'))[0].id;

    // Move the folder: the old location is gone.
    const moved = path.join(root, 'moved');
    fs.renameSync(original, moved);
    const app = open(moved);
    const t = await login(app);
    assert.equal(await billCount(app, t), 1);
    await sale(app, t);
    assert.equal(await billCount(app, t), 2);
    // The registry now names the files where they are.
    assert.equal(JSON.parse(fs.readFileSync(path.join(moved, 'businesses.json'), 'utf8'))[0].dbPath, path.join(moved, 'businesses', `${id}.db`));
    // The backup listed in the history (kept with the old full path) is found in the moved folder.
    const [backup] = await call<any[]>(app, 'backup.list', undefined, t);
    const download = await call(app, 'backup.download', { id: backup.id }, t);
    assert.match(download.fileName, /\.bfbackup$/);
    app.close();
    assert.equal(fs.existsSync(original), false, 'nothing was written to the old location');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
