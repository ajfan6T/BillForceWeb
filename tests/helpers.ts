import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BillforceApp } from '../src/core/app';
import { WebPlatform, withClientActions, type ClientAction } from '../src/core/web';
import { todayISO } from '../src/shared/dates';

export const today = todayISO();

/** A Billforce server in a fresh temporary data folder (call close() when done). */
export function makeApp(opts: { registrationOpen?: boolean } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'billforce-test-'));
  const app = new BillforceApp({ dataDir, platform: new WebPlatform(dataDir), version: 'test', registrationOpen: opts.registrationOpen });
  return {
    app,
    dataDir,
    close() {
      app.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** Call a route like the browser does; throws on an error result. */
export async function call<T = any>(app: BillforceApp, name: string, input?: unknown, token?: string | null): Promise<T> {
  const r = await app.invoke(name, input, token);
  if (!r.ok) throw Object.assign(new Error(`${name}: ${r.error.message}`), { code: r.error.code, fields: r.error.fields });
  return r.data as T;
}

/** Call a route and also return what the browser would be asked to do (print, download). */
export async function callWithActions<T = any>(app: BillforceApp, name: string, input: unknown, token: string): Promise<{ data: T; actions: ClientAction[] }> {
  const { result, actions } = await withClientActions(() => app.invoke(name, input, token));
  if (!result.ok) throw new Error(`${name}: ${result.error.message}`);
  return { data: result.data as T, actions };
}

/** Expect a call to fail; returns the error code. */
export async function fails(app: BillforceApp, name: string, input?: unknown, token?: string | null): Promise<string> {
  const r = await app.invoke(name, input, token);
  if (r.ok) throw new Error(`${name} was expected to fail`);
  return r.error.code;
}

export async function register(app: BillforceApp, name: string, password = 'secret1', extra: Record<string, unknown> = {}): Promise<string> {
  const r = await call<{ token: string }>(app, 'business.register', {
    business: { name },
    owner: { fullName: `${name} Owner`, username: 'owner', password },
    ...extra,
  });
  return r.token;
}

/** Every journal entry of a business has equal debits and credits. */
export function unbalancedEntries(app: BillforceApp, token: string): number {
  const ctx = app.ctx(token);
  return ctx.db.value<number>(
    'SELECT COUNT(*) FROM (SELECT entry_id, SUM(debit) - SUM(credit) AS d FROM journal_lines GROUP BY entry_id HAVING d <> 0)',
    undefined,
    0,
  );
}

/** Balance of a system account (debit - credit) in a business, ignoring voided entries. */
export function accountBalance(app: BillforceApp, token: string, systemKey: string): number {
  const ctx = app.ctx(token);
  return ctx.db.value<number>(
    `SELECT COALESCE(SUM(l.debit - l.credit), 0) FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      JOIN accounts a ON a.id = l.account_id WHERE a.system_key = ? AND e.is_void = 0`,
    [systemKey],
    0,
  );
}

/** Quantity of an item in stock now (sum of its stock movements). */
export function stockQty(app: BillforceApp, token: string, itemId: number): number {
  return app.ctx(token).db.value<number>('SELECT COALESCE(SUM(qty), 0) FROM stock_moves WHERE item_id = ?', [itemId], 0);
}
