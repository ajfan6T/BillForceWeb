import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { route, zId } from '../../api/router';
import type { Ctx } from '../../context';
import { requireSession } from '../../context';
import { fail } from '../../errors';
import { offerDownload } from '../../web';
import { backupFolder, createBackup, inspectBackup, restoreBackup } from './backup';
import { removeUpload, uploadedFile } from './uploads';

const zUpload = z.object({ uploadId: z.string().trim().min(1).max(100) });

function businessOf(ctx: Ctx): string {
  requireSession(ctx);
  if (!ctx.businessId) throw fail.forbidden();
  return ctx.businessId;
}

/** Send a backup file of this business to the browser. */
function downloadBackup(ctx: Ctx, file: string): { fileName: string } {
  const folder = path.resolve(backupFolder(ctx));
  const resolved = path.resolve(file);
  if (path.dirname(resolved) !== folder || !fs.existsSync(resolved)) throw fail.notFound('Backup file');
  const fileName = path.basename(resolved);
  offerDownload(fileName, fs.readFileSync(resolved));
  return { fileName };
}

export const dataRoutes = {
  /** Make a backup on the server and download a copy to this computer. */
  'backup.create': route({
    access: 'data.backup',
    handler: (ctx) => {
      const info = createBackup(ctx, 'manual');
      downloadBackup(ctx, info.path);
      return { fileName: info.fileName, backupAt: info.backupAt, sizeBytes: info.sizeBytes };
    },
  }),

  'backup.list': route({
    access: 'data.backup',
    handler: (ctx) =>
      ctx.db.all<{ id: number; at: string; kind: string; size_bytes: number | null; note: string | null }>(
        'SELECT id, at, kind, size_bytes, note FROM backup_history ORDER BY at DESC, id DESC LIMIT 100',
      ),
  }),

  /** Download one of the backups kept on the server. */
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
