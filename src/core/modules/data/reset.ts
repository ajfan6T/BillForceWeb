/**
 * Reset a business's data (Settings > Backup & recovery, owner only, with the owner's password).
 *
 * A fresh database is built next to the live one and filled from an allow-list of what is kept,
 * so nothing outside the list survives: the business settings, users and permissions, the chart of
 * accounts and the partners always; items, menu recipes, customers, suppliers and employees when the owner
 * keeps the lists. Every bill, purchase, payment, return, quotation, order, expense, salary, loan,
 * stock movement and accounts entry is gone, and document numbers start again. A safety backup of
 * the old data is made first, so a reset can be undone with Restore.
 */
import fs from 'node:fs';
import type { Ctx } from '../../context';
import { now, requireSession, today } from '../../context';
import { AppError, fail } from '../../errors';
import { logActivity } from '../../audit';
import { Db } from '../../db/database';
import { migrate } from '../../db/migrate';
import { seedReferenceData } from '../../seed';
import { getSection } from '../../settings';
import { ensureFinancialYear } from '../../accounting/periods';
import { confirmPassword } from '../auth/service';
import { createBackup } from './backup';

export const RESET_KEEPS = ['lists', 'nothing'] as const;
export type ResetKeep = (typeof RESET_KEEPS)[number];

/** Always kept, in an order that respects foreign keys. */
const SETUP_TABLES = ['settings', 'users', 'role_permissions', 'account_groups', 'accounts', 'partners', 'backup_history'];
/** Kept with "keep my lists". Opening balances are accounts entries, so they start again at zero. */
const LIST_TABLES = ['items', 'recipe_items', 'customers', 'suppliers', 'employees'];
const OPENING_ENTRY_TABLES = new Set(['customers', 'suppliers', 'employees']);

function columns(db: Db, table: string): string[] {
  return db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name);
}

/** Copy every row of a table, column by column (the two databases have the same schema version). */
function copyTable(from: Db, to: Db, table: string): number {
  const fromCols = new Set(columns(from, table));
  const cols = columns(to, table).filter((c) => fromCols.has(c));
  const list = cols.map((c) => `"${c}"`).join(', ');
  const rows = from.all<Record<string, unknown>>(`SELECT ${list} FROM ${table}`);
  const sql = `INSERT INTO ${table} (${list}) VALUES (${cols.map(() => '?').join(', ')})`;
  for (const row of rows) {
    to.run(
      sql,
      cols.map((c) => (c === 'opening_entry_id' && OPENING_ENTRY_TABLES.has(table) ? null : (row[c] as never))),
    );
  }
  return rows.length;
}

function removeDbFiles(file: string): void {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
}

export interface ResetResult {
  /** A new session for the owner: every other login of the business has ended. */
  token: string;
  safetyBackup: string;
  signInName: string;
  kept: { items: number; customers: number; suppliers: number; employees: number; users: number };
}

export function resetBusinessData(ctx: Ctx, input: { password: string; keep: ResetKeep }): ResetResult {
  const s = requireSession(ctx);
  if (s.role !== 'owner') throw fail.forbidden('Only the owner can reset the data of the business.');
  if (!ctx.businessId || !ctx.info.dbPath || ctx.info.dbPath === ':memory:') throw new AppError('VALIDATION', 'This business cannot be reset here.');
  // Outside a transaction on purpose: a wrong password is recorded (and locks the login after a few tries).
  confirmPassword(ctx, input.password);

  const keepLists = input.keep === 'lists';
  const safety = createBackup(ctx, 'safety', { note: keepLists ? 'Before resetting the data (lists kept)' : 'Before resetting all data' });

  const old = ctx.db;
  const booksStart = getSection(ctx, 'accounts').booksStartDate;
  const ts = now(ctx);
  const todayIso = today(ctx);
  const tmp = `${ctx.info.dbPath}.reset-tmp`;
  removeDbFiles(tmp);
  const kept = { items: 0, customers: 0, suppliers: 0, employees: 0, users: 0 };
  let fresh: Db | null = new Db(tmp);
  try {
    migrate(fresh);
    seedReferenceData(fresh, ts);
    const db = fresh;
    db.tx(() => {
      // The new database comes with the default chart of accounts and permissions: use the business's own.
      for (const t of ['accounts', 'account_groups', 'role_permissions', 'settings', 'backup_history']) db.run(`DELETE FROM ${t}`);
      for (const t of SETUP_TABLES) {
        const n = copyTable(old, db, t);
        if (t === 'users') kept.users = n;
      }
      if (keepLists) {
        for (const t of LIST_TABLES) {
          const n = copyTable(old, db, t);
          if (t in kept) kept[t as keyof typeof kept] = n;
        }
      }
      const freshCtx: Ctx = { ...ctx, db, session: null };
      ensureFinancialYear(freshCtx, booksStart);
      if (todayIso >= booksStart) ensureFinancialYear(freshCtx, todayIso);
    });
    fresh.close();
    fresh = null;
    // Swapped in by the same checked path as a restore; it ends every login of the business.
    const signInName = ctx.app.replaceDatabase(tmp);
    removeDbFiles(tmp);
    const after = ctx.appInstance?.businessCtx(ctx.businessId);
    if (after) {
      const what = keepLists
        ? 'deleted all bills, purchases, payments, stock and accounts entries; kept items, customers, suppliers and employees'
        : 'deleted all data; kept the business settings and logins';
      logActivity(after, 'data.reset', `${s.fullName} reset the business data: ${what}`, {
        entityType: 'backup',
        details: { kept: keepLists ? 'lists' : 'settings and logins', safetyBackup: safety.fileName },
      });
    }
    return { token: ctx.app.startSession(s.userId), safetyBackup: safety.fileName, signInName, kept };
  } catch (e) {
    fresh?.close();
    removeDbFiles(tmp);
    throw e;
  }
}
