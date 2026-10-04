import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { route, zId } from '../../api/router';
import type { Ctx } from '../../context';
import { requireSession } from '../../context';
import { fail } from '../../errors';
import { logActivity } from '../../audit';
import { pathKey } from '../../platform';
import { getSection, updateSection } from '../../settings';
import { backupFolder, createBackup, inspectBackup, isAbsoluteFile, isOwnBackupFile, restoreBackup } from './backup';
import { removeUpload, uploadedFile } from './uploads';

const zUpload = z.object({ uploadId: z.string().trim().min(1).max(100) });

function businessOf(ctx: Ctx): string {
  requireSession(ctx);
  if (!ctx.businessId) throw fail.forbidden();
  return ctx.businessId;
}

const isDesktop = (ctx: Ctx) => ctx.platform.kind === 'electron';

/**
 * Send a backup file of this business to the browser (it downloads it). In the Windows app the
 * user chooses where to save a copy (a pen drive, another folder); savedTo is null if cancelled.
 */
async function downloadBackup(ctx: Ctx, file: string): Promise<{ fileName: string; savedTo: string | null }> {
  if (!isOwnBackupFile(ctx, file) || !fs.existsSync(file)) throw fail.notFound('Backup file');
  const fileName = path.basename(file);
  const saved = await ctx.platform.saveFile({ defaultName: fileName, data: fs.readFileSync(file), filters: [{ name: 'Billforce backup', extensions: ['bfbackup'] }] });
  return { fileName, savedTo: isDesktop(ctx) ? saved : null };
}

/** Where backups are kept. Only the Windows app shows the folder: server paths mean nothing in a browser. */
function folderInfo(ctx: Ctx): { folder: string | null; isDefault: boolean; canChoose: boolean } {
  const folder = backupFolder(ctx);
  return { folder: isDesktop(ctx) ? folder : null, isDefault: pathKey(folder) === pathKey(ctx.info.defaultBackupDir), canChoose: isDesktop(ctx) };
}

function requireDesktop(ctx: Ctx): void {
  if (!isDesktop(ctx)) throw fail.validation('Backup folders can only be chosen in the Billforce Windows app.');
}

/** Can Billforce save backups in this folder? Throws a plain message when it cannot. */
function checkBackupFolder(folder: string): void {
  if (!isAbsoluteFile(folder)) throw fail.validation('Choose a folder on this computer or on a pen drive.');
  try {
    fs.mkdirSync(folder, { recursive: true });
    const probe = path.join(folder, `.billforce-check-${process.pid}-${Date.now()}.tmp`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    throw fail.validation(`Billforce cannot save backups in ${folder}${code ? ` (${code})` : ''}. Choose another folder.`);
  }
}

function setBackupFolder(ctx: Ctx, folder: string | null): void {
  const before = getSection(ctx, 'backup').folder ?? null;
  if (before === folder) return;
  ctx.db.tx(() => {
    updateSection(ctx, 'backup', { folder });
    logActivity(ctx, 'settings.update', folder ? `Backups will be saved in ${folder}` : "Backups will be saved in Billforce's own folder", {
      entityType: 'settings',
      details: { section: 'backup', before: { folder: before }, after: { folder } },
    });
  });
}

export const dataRoutes = {
  /** Make a backup on the server and download a copy to this computer (the Windows app keeps it in its backup folder). */
  'backup.create': route({
    access: 'data.backup',
    handler: async (ctx) => {
      const info = createBackup(ctx, 'manual');
      if (!isDesktop(ctx)) await downloadBackup(ctx, info.path);
      return {
        fileName: info.fileName,
        backupAt: info.backupAt,
        sizeBytes: info.sizeBytes,
        folder: isDesktop(ctx) ? path.dirname(info.path) : null,
        fellBackFrom: info.fellBackFrom ?? null,
      };
    },
  }),

  /** Where backups are kept (the folder is shown only in the Windows app). */
  'backup.folder': route({
    access: 'data.backup',
    handler: (ctx) => folderInfo(ctx),
  }),

  /** Windows app: choose the folder for backups (for example a pen drive or a OneDrive / Google Drive folder). */
  'backup.chooseFolder': route({
    access: 'data.backup',
    handler: async (ctx) => {
      requireDesktop(ctx);
      const current = backupFolder(ctx);
      const picked = await ctx.platform.pickFolder({ title: 'Choose where to keep Billforce backups', defaultPath: current });
      if (!picked) return { ...folderInfo(ctx), changed: false };
      checkBackupFolder(picked);
      setBackupFolder(ctx, pathKey(picked) === pathKey(ctx.info.defaultBackupDir) ? null : picked);
      return { ...folderInfo(ctx), changed: true };
    },
  }),

  /** Windows app: go back to Billforce's own backup folder. */
  'backup.useDefaultFolder': route({
    access: 'data.backup',
    handler: (ctx) => {
      requireDesktop(ctx);
      setBackupFolder(ctx, null);
      return folderInfo(ctx);
    },
  }),

  /** Windows app: open the backup folder in File Explorer. */
  'backup.openFolder': route({
    access: 'data.backup',
    handler: async (ctx) => {
      requireDesktop(ctx);
      const folder = backupFolder(ctx);
      try {
        fs.mkdirSync(folder, { recursive: true });
      } catch {
        throw fail.validation(`The backup folder ${folder} is not available (was a pen drive removed?).`);
      }
      await ctx.platform.openPath(folder);
      return null;
    },
  }),

  /** Windows app: show one backup file in File Explorer. */
  'backup.showInFolder': route({
    access: 'data.backup',
    input: z.object({ id: zId }),
    handler: (ctx, input) => {
      requireDesktop(ctx);
      const row = ctx.db.get<{ path: string }>('SELECT path FROM backup_history WHERE id = ?', [input.id]);
      if (!row || !isOwnBackupFile(ctx, row.path) || !fs.existsSync(row.path)) throw fail.notFound('Backup file');
      ctx.platform.showInFolder(row.path);
      return null;
    },
  }),

  'backup.list': route({
    access: 'data.backup',
    handler: (ctx) =>
      ctx.db.all<{ id: number; at: string; kind: string; size_bytes: number | null; note: string | null }>(
        'SELECT id, at, kind, size_bytes, note FROM backup_history ORDER BY at DESC, id DESC LIMIT 100',
      ),
  }),

  /** Download one of the backups kept on the server (Windows app: save a copy where the user chooses). */
  'backup.download': route({
    access: 'data.backup',
    input: z.object({ id: zId }),
    handler: (ctx, input) => {
      const row = ctx.db.get<{ path: string }>('SELECT path FROM backup_history WHERE id = ?', [input.id]);
      if (!row) throw fail.notFound('Backup');
      return downloadBackup(ctx, row.path);
    },
  }),

  /** What an uploaded backup file contains, shown before restoring it. */
  'backup.inspectUpload': route({
    access: 'data.restore',
    input: zUpload,
    handler: (ctx, input) => {
      const info = inspectBackup(uploadedFile(ctx.info.dataDir, businessOf(ctx), input.uploadId));
      return { businessName: info.businessName, healthy: info.healthy, sizeBytes: info.sizeBytes, lastBillDate: info.lastBillDate, counts: info.counts };
    },
  }),

  /** Replace this business's data with an uploaded backup (a safety backup is made first). */
  'backup.restoreUpload': route({
    access: 'data.restore',
    input: zUpload,
    handler: (ctx, input) => {
      const businessId = businessOf(ctx);
      const result = restoreBackup(ctx, uploadedFile(ctx.info.dataDir, businessId, input.uploadId));
      removeUpload(ctx.info.dataDir, businessId, input.uploadId);
      return result;
    },
  }),
};
