import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { Ctx } from '../../context';
import { now, requireSession, today } from '../../context';
import { getSection, getMeta, updateSection } from '../../settings';
import { Db } from '../../db/database';
import { AppError, fail } from '../../errors';
import { logActivity } from '../../audit';
import { pathKey } from '../../platform';
import { diffDays, isValidISODate, toTimestamp } from '../../../shared/dates';
import { BACKUP_FREQUENCY_DAYS, type BackupFrequency, type BackupSettings } from '../../../shared/settings';
import type { BillforceApp } from '../../app';

export type BackupKind = 'auto' | 'manual' | 'safety';

export interface BackupInfo {
  path: string;
  fileName: string;
  backupAt: string;
  sizeBytes: number;
  kind: BackupKind;
  /** The chosen folder could not be used (pen drive removed, disk full): the backup was kept in Billforce's own folder. */
  fellBackFrom?: string;
}

export interface BackupInspection extends BackupInfo {
  businessName: string;
  healthy: boolean;
  lastBillDate: string | null;
  counts: { bills: number; customers: number; items: number; users: number };
}

export function isAbsoluteFile(p: string): boolean {
  return path.isAbsolute(p) || path.win32.isAbsolute(p) || /^\\\\/.test(p);
}

function backupPathProblem(p: string): string | null {
  if (!p || !isAbsoluteFile(p)) return 'Choose a full backup file path.';
  if (p.includes('\0')) return 'The backup file path is not valid.';
  if (!/\.bfbackup$/i.test(p)) return 'Choose a Billforce backup file (.bfbackup).';
  return null;
}

function assertBackupPath(p: string): void {
  const problem = backupPathProblem(p);
  if (problem) throw fail.validation(problem, { path: problem });
}

function slug(value: string): string {
  return value
    .trim()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60) || 'business';
}

/**
 * Where this business's backups are kept: the folder chosen in the Windows app, otherwise the
 * business's own folder (<backup root>/<business id>). A server never uses a folder from the settings.
 */
export function backupFolder(ctx: Ctx): string {
  if (ctx.platform.kind === 'electron') {
    const chosen = getSection(ctx, 'backup').folder;
    if (typeof chosen === 'string' && chosen && isAbsoluteFile(chosen)) return chosen;
  }
  return ctx.info.defaultBackupDir;
}

/** Is this file in one of this business's backup folders (the chosen one or its own)? */
export function isOwnBackupFile(ctx: Ctx, file: string): boolean {
  const dir = pathKey(path.dirname(path.resolve(file)));
  return dir === pathKey(backupFolder(ctx)) || dir === pathKey(ctx.info.defaultBackupDir);
}

function makeFileName(ctx: Ctx, kind: BackupKind): string {
  const business = getMeta(ctx, 'setup_done') ? getSection(ctx, 'business') : null;
  const name = typeof business?.name === 'string' ? business.name : 'billforce';
  const stamp = now(ctx).replace(/[^0-9]/g, '').slice(0, 14);
  return `billforce-${slug(name)}-${stamp}-${kind}.bfbackup`;
}

function pruneAutomaticBackups(ctx: Ctx): void {
  const keep = getSection(ctx, 'backup').keepCount;
  const rows = ctx.db.all<{ id: number; path: string }>('SELECT id, path FROM backup_history WHERE kind = ? ORDER BY at DESC, id DESC', ['auto']);
  for (const row of rows.slice(Math.max(0, keep))) {
    try {
      // Only files in this business's own folders (a restored backup may list another folder's files).
      if (isOwnBackupFile(ctx, row.path)) fs.rmSync(row.path, { force: true });
    } catch {
      /* A disconnected drive should not prevent the database from recording the prune. */
    }
    ctx.db.run('DELETE FROM backup_history WHERE id = ?', [row.id]);
  }
}

/** Write a consistent copy of the database into a folder ("<name>.partial" first, so a failure never leaves a cut-short backup). */
function writeBackupFile(ctx: Ctx, folder: string, kind: BackupKind): { target: string; size: number } {
  fs.mkdirSync(folder, { recursive: true });
  const base = makeFileName(ctx, kind).replace(/\.bfbackup$/i, '');
  let target = path.join(folder, `${base}.bfbackup`);
  for (let i = 2; fs.existsSync(target); i++) target = path.join(folder, `${base}-${i}.bfbackup`);
  const partial = `${target}.partial`;
  try {
    fs.rmSync(partial, { force: true });
    ctx.db.vacuumInto(partial);
    const size = fs.statSync(partial).size;
    if (!size) throw new AppError('VALIDATION', 'The backup file was empty, so it was not saved.');
    fs.renameSync(partial, target);
    return { target, size };
  } catch (e) {
    try {
      fs.rmSync(partial, { force: true });
    } catch {
      /* the folder may be gone (pen drive removed) */
    }
    throw e;
  }
}

/** Create a consistent SQLite backup and record it in the business database. */
export function createBackup(ctx: Ctx, kind: BackupKind, opts: { note?: string } = {}): BackupInfo {
  if (kind === 'manual') requireSession(ctx);
  const chosen = backupFolder(ctx);
  let written: { target: string; size: number };
  let fellBackFrom: string | undefined;
  try {
    try {
      written = writeBackupFile(ctx, chosen, kind);
    } catch (e) {
      // The chosen folder cannot be used (pen drive removed, disk full): keep the backup in Billforce's own folder.
      const own = ctx.info.defaultBackupDir;
      if (pathKey(chosen) === pathKey(own)) throw e;
      written = writeBackupFile(ctx, own, kind);
      fellBackFrom = chosen;
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('VALIDATION', `The backup could not be saved. ${(e as Error).message}`);
  }
  const { target, size } = written;
  const note = fellBackFrom ? `${opts.note ? `${opts.note}. ` : ''}Saved in Billforce's own backup folder because ${fellBackFrom} could not be used.` : opts.note ?? null;
  const backupAt = now(ctx);
  ctx.db.tx(() => {
    ctx.db.insert('backup_history', {
      at: backupAt,
      kind,
      path: target,
      size_bytes: size,
      user_id: ctx.session?.userId ?? null,
      note,
    });
    const before = getSection(ctx, 'backup');
    updateSection(ctx, 'backup', {
      lastBackupAt: backupAt,
      lastBackupPath: path.basename(target),
      ...(kind === 'auto' ? { lastAutoBackupAt: backupAt } : {}),
    });
    logActivity(ctx, kind === 'auto' ? 'backup.auto' : kind === 'safety' ? 'backup.safety' : 'backup.create', `Saved ${kind} backup`, {
      entityType: 'backup',
      details: { file: path.basename(target), sizeBytes: size, note, previous: before.lastBackupPath },
    });
    if (kind === 'auto') pruneAutomaticBackups(ctx);
  });
  return { path: target, fileName: path.basename(target), backupAt, sizeBytes: size, kind, ...(fellBackFrom ? { fellBackFrom } : {}) };
}

function tableExists(db: Db, table: string): boolean {
  return !!db.value<number>('SELECT COUNT(*) FROM sqlite_master WHERE type = ? AND name = ?', ['table', table], 0);
}

/** Read enough metadata to show a backup before the user restores it. */
export function inspectBackup(filePath: string): BackupInspection {
  assertBackupPath(filePath);
  if (!fs.existsSync(filePath)) throw fail.notFound('Backup file');
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw fail.validation('Choose a backup file, not a folder.', { path: 'Choose a backup file' });
  let db: Db | null = null;
  let probeDir: string | null = null;
  try {
    // Db enables WAL for normal operation. Probe a temporary copy so inspecting a backup
    // never writes sidecar files next to a read-only USB/network backup.
    probeDir = fs.mkdtempSync(path.join(tmpdir(), 'billforce-backup-inspect-'));
    const probePath = path.join(probeDir, 'backup.db');
    fs.copyFileSync(filePath, probePath);
    db = new Db(probePath);
    const integrity = db.value<string>('PRAGMA integrity_check', undefined, 'failed');
    const required = ['settings', 'users', 'bills', 'customers', 'items'];
    if (integrity !== 'ok' || required.some((t) => !tableExists(db!, t))) throw new Error('The file is not a complete Billforce database.');
    const businessRow = db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'business'");
    let businessName = 'Billforce data';
    try {
      const business = businessRow?.value ? JSON.parse(businessRow.value) : null;
      if (business?.name) businessName = String(business.name);
    } catch {
      /* Keep the fallback name for an older backup. */
    }
    const healthy = integrity === 'ok';
    return {
      path: filePath,
      fileName: path.basename(filePath),
      backupAt: toTimestamp(stat.mtime),
      sizeBytes: stat.size,
      kind: 'manual',
      businessName,
      healthy,
      lastBillDate: db.value<string | null>('SELECT MAX(date) FROM bills WHERE status = ?', ['active'], null),
      counts: {
        bills: db.value<number>('SELECT COUNT(*) FROM bills', undefined, 0),
        customers: db.value<number>('SELECT COUNT(*) FROM customers', undefined, 0),
        items: db.value<number>('SELECT COUNT(*) FROM items', undefined, 0),
        users: db.value<number>('SELECT COUNT(*) FROM users', undefined, 0),
      },
    };
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw fail.validation(`This file cannot be restored: ${(e as Error).message}`, { path: 'Choose a valid Billforce backup' });
  } finally {
    db?.close();
    if (probeDir) fs.rmSync(probeDir, { recursive: true, force: true });
  }
}

/**
 * Replace this business's data with a backup. A safety backup of the current data is made first,
 * so a wrong restore can be undone. Everyone of the business is logged out afterwards and signs in
 * again with signInName (the restored business's name, unless another business here uses it).
 */
export function restoreBackup(ctx: Ctx, filePath: string): { businessName: string; safetyBackup: string; signInName: string } {
  const s = requireSession(ctx);
  const info = inspectBackup(filePath);
  const safety = createBackup(ctx, 'safety', { note: `Before restoring a backup of ${info.businessName}` });
  const signInName = ctx.app.replaceDatabase(filePath);
  // Recorded in the restored data, which is what the business works with from now on.
  const restored = ctx.businessId ? ctx.appInstance?.businessCtx(ctx.businessId) : null;
  if (restored) {
    logActivity(restored, 'backup.restore', `${s.fullName} restored a backup of ${info.businessName} (made ${info.backupAt})`, {
      entityType: 'backup',
      details: { counts: info.counts, safetyBackup: safety.fileName },
    });
  }
  return { businessName: info.businessName, safetyBackup: safety.fileName, signInName };
}

/**
 * Is an automatic backup due? Yes when none was made yet, or the last one is at least a day, a week
 * or a month (30 days) old, as chosen. Days are calendar days: "every day" is the first change of each day.
 */
export function autoBackupDue(settings: BackupSettings, todayIso: string): boolean {
  if (!settings.autoBackup) return false;
  const last = settings.lastAutoBackupAt?.slice(0, 10);
  if (!last || !isValidISODate(last)) return true;
  const days = diffDays(last, todayIso);
  // A last backup "in the future" means the computer's clock was wrong then: back up again.
  return days < 0 || days >= (BACKUP_FREQUENCY_DAYS[settings.frequency] ?? 1);
}

const FREQUENCY_NOTES: Record<BackupFrequency, string> = {
  daily: 'Automatic daily backup',
  weekly: 'Automatic weekly backup',
  monthly: 'Automatic monthly backup',
};

/** Make the automatic backup of a business now, if one is due. Returns the backup made, or null. */
export function runAutoBackupIfDue(app: BillforceApp, businessId: string): BackupInfo | null {
  const ctx = app.businessCtx(businessId);
  if (!ctx) return null;
  const settings = getSection(ctx, 'backup');
  if (!autoBackupDue(settings, today(ctx))) return null;
  return createBackup(ctx, 'auto', { note: FREQUENCY_NOTES[settings.frequency] ?? 'Automatic backup' });
}

function runAutoBackupSafely(app: BillforceApp, businessId: string): void {
  try {
    runAutoBackupIfDue(app, businessId);
  } catch (e) {
    console.warn('[AutoBackup] Background backup notice:', (e as Error).message);
  }
}

interface PendingBackup {
  app: BillforceApp;
  businessId: string;
  timer: ReturnType<typeof setTimeout>;
}

/** Automatic backups waiting for changes to settle, by database file. */
const autoBackupTimers = new Map<string, PendingBackup>();

export function cancelAutoBackup(dbPath: string): void {
  const pending = autoBackupTimers.get(dbPath);
  if (pending) clearTimeout(pending.timer);
  autoBackupTimers.delete(dbPath);
}

/** After changes, keep an automatic copy of a business when one is due (the setting is on and the interval has passed). */
export function triggerAutoBackupDebounced(app: BillforceApp, businessId: string, dbPath: string, delayMs = 5000): void {
  cancelAutoBackup(dbPath);
  const timer = setTimeout(() => {
    autoBackupTimers.delete(dbPath);
    runAutoBackupSafely(app, businessId);
  }, delayMs);
  timer.unref?.();
  autoBackupTimers.set(dbPath, { app, businessId, timer });
}

/** Make now the automatic backups of this app that are still waiting (the app is about to quit). */
export function runPendingAutoBackups(app: BillforceApp): void {
  for (const [dbPath, pending] of [...autoBackupTimers]) {
    if (pending.app !== app) continue;
    cancelAutoBackup(dbPath);
    runAutoBackupSafely(app, pending.businessId);
  }
}
