import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { Ctx } from '../../context';
import { now, requireSession } from '../../context';
import { getSection, getMeta, updateSection } from '../../settings';
import { Db } from '../../db/database';
import { AppError, fail } from '../../errors';
import { logActivity } from '../../audit';
import { toTimestamp } from '../../../shared/dates';
import type { BillforceApp } from '../../app';

export type BackupKind = 'auto' | 'manual' | 'safety';

export interface BackupInfo {
  path: string;
  fileName: string;
  backupAt: string;
  sizeBytes: number;
  kind: BackupKind;
}

export interface BackupInspection extends BackupInfo {
  businessName: string;
  healthy: boolean;
  lastBillDate: string | null;
  counts: { bills: number; customers: number; items: number; users: number };
}

function isAbsoluteFile(p: string): boolean {
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

/** The configured backup folder, falling back to the platform's Documents folder. */
export function backupFolder(ctx: Ctx): string {
  const configured = getSection(ctx, 'backup').folder.trim();
  return configured || ctx.info.defaultBackupDir;
}

function ensureBackupFolder(ctx: Ctx): string {
  const folder = backupFolder(ctx);
  fs.mkdirSync(folder, { recursive: true });
  return folder;
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
      fs.rmSync(row.path, { force: true });
    } catch {
      /* A disconnected drive should not prevent the database from recording the prune. */
    }
    ctx.db.run('DELETE FROM backup_history WHERE id = ?', [row.id]);
  }
}

/** Create a consistent SQLite backup and record it in the business database. */
export function createBackup(ctx: Ctx, kind: BackupKind, opts: { note?: string } = {}): BackupInfo {
  if (kind === 'manual') requireSession(ctx);
  const folder = ensureBackupFolder(ctx);
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
    const backupAt = now(ctx);
    ctx.db.tx(() => {
      ctx.db.insert('backup_history', {
        at: backupAt,
        kind,
        path: target,
        size_bytes: size,
        user_id: ctx.session?.userId ?? null,
        note: opts.note ?? null,
      });
      const before = getSection(ctx, 'backup');
      updateSection(ctx, 'backup', {
        lastBackupAt: backupAt,
        lastBackupPath: target,
        ...(kind === 'auto' ? { lastAutoBackupAt: backupAt } : {}),
      });
      logActivity(ctx, kind === 'auto' ? 'backup.auto' : kind === 'safety' ? 'backup.safety' : 'backup.create', `Saved ${kind} backup`, {
        entityType: 'backup',
        details: { path: target, sizeBytes: size, note: opts.note ?? null, previous: before.lastBackupPath },
      });
      if (kind === 'auto') pruneAutomaticBackups(ctx);
    });
    return { path: target, fileName: path.basename(target), backupAt, sizeBytes: size, kind };
  } catch (e) {
    fs.rmSync(partial, { force: true });
    if (e instanceof AppError) throw e;
    throw new AppError('VALIDATION', `The backup could not be saved. ${(e as Error).message}`);
  }
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

/** Restore a backup during first-run setup. The app validates it again before replacement. */
export function restoreBackup(ctx: Ctx, filePath: string): { path: string; businessName: string } {
  if (getMeta(ctx, 'setup_done') === '1') throw fail.conflict('This computer is already set up. Restore from the logged-in business instead.');
  const info = inspectBackup(filePath);
  ctx.app.replaceDatabase(filePath);
  return { path: info.path, businessName: info.businessName };
}

const autoBackupTimers = new WeakMap<BillforceApp, ReturnType<typeof setTimeout>>();

export function cancelAutoBackup(app: BillforceApp): void {
  const timer = autoBackupTimers.get(app);
  if (timer) clearTimeout(timer);
  autoBackupTimers.delete(app);
}

/** Keep one daily automatic copy after normal ERP mutations when the setting is enabled. */
export function triggerAutoBackupDebounced(app: BillforceApp, token: string | null | undefined, db: Db, delayMs = 5000): void {
  cancelAutoBackup(app);
  const timer = setTimeout(() => {
    autoBackupTimers.delete(app);
    try {
      const ctx = app.ctx(token, db);
      const settings = getSection(ctx, 'backup');
      if (!settings.autoBackup) return;
      const last = settings.lastAutoBackupAt ? new Date(settings.lastAutoBackupAt.replace(' ', 'T')).getTime() : 0;
      if (last && app.clock().getTime() - last < 24 * 60 * 60 * 1000) return;
      createBackup(ctx, 'auto', { note: 'Automatic daily backup' });
    } catch (e) {
      console.warn('[AutoBackup] Background backup notice:', (e as Error).message);
    }
  }, delayMs);
  autoBackupTimers.set(app, timer);
}
