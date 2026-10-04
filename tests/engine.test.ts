import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Db } from '../src/core/db/database';

// npm run test:browser-engine runs every test on the GitHub Pages engine (sql.js + files kept in memory).
// This makes sure that run really uses it, and the normal run really uses Node's SQLite on disk.
test('the tests run on the intended database engine', () => {
  const browser = process.env.BILLFORCE_TEST_ENGINE === 'browser';
  const realFs = process.getBuiltinModule('node:fs');
  const file = `/tmp/billforce-engine-check-${process.pid}.db`;
  realFs.rmSync(file, { force: true });
  const db = new Db(file);
  db.exec('CREATE TABLE t (x INTEGER)');
  db.run('INSERT INTO t (x) VALUES (?)', [1]);
  db.close();
  assert.equal(fs.existsSync(file), true);
  assert.equal(realFs.existsSync(file), !browser, browser ? 'the browser engine must not write to disk' : 'Node SQLite writes to disk');
  realFs.rmSync(file, { force: true });
});
