import { z } from 'zod';
import { route } from '../../api/router';
import { requireSession } from '../../context';
import { fail } from '../../errors';
import { getMeta } from '../../settings';
import { backupFolder, createBackup, inspectBackup, restoreBackup } from './backup';

const zBackupPath = z.object({ path: z.string().trim().min(1).max(2000) });

function requireFirstRun(ctx: Parameters<typeof getMeta>[0]): void {
  if (getMeta(ctx, 'setup_done') === '1') throw fail.conflict('Backup restore is available only during first-run setup.');
}

export const dataRoutes = {
  'backup.create': route({
    access: 'data.backup',
    handler: (ctx) => createBackup(ctx, 'manual'),
  }),

  'backup.list': route({
    access: 'data.backup',
    handler: (ctx) => {
      requireSession(ctx);
      return ctx.db.all<{ id: number; at: string; kind: string; path: string; size_bytes: number | null; note: string | null }>(
        'SELECT id, at, kind, path, size_bytes, note FROM backup_history ORDER BY at DESC, id DESC',
      );
    },
  }),

  'backup.openFolder': route({
    access: 'user',
    handler: async (ctx) => {
      const folder = backupFolder(ctx);
      await ctx.platform.openPath(folder);
      return { path: folder };
    },
  }),

  'setup.pickBackup': route({
    access: 'public',
    handler: async (ctx) => {
      requireFirstRun(ctx);
      const path = await ctx.platform.pickFile({ title: 'Choose a Billforce backup', filters: [{ name: 'Billforce backup', extensions: ['bfbackup'] }] });
      return path ? { path, fileName: path.split(/[\\/]/).pop() ?? path } : null;
    },
  }),

  'setup.inspectBackup': route({
    access: 'public',
    input: zBackupPath,
    handler: (ctx, input) => {
      requireFirstRun(ctx);
      return inspectBackup(input.path);
    },
  }),

  'setup.restoreBackup': route({
    access: 'public',
    input: zBackupPath,
    handler: (ctx, input) => restoreBackup(ctx, input.path),
  }),
};
