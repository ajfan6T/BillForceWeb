/**
 * The browser edition (GitHub Pages): the Billforce core runs inside the page.
 * Data is kept in this browser (IndexedDB); see ./storage.ts and ./node/*.
 */
import { Buffer } from 'buffer';
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import type { BillforceApp } from '../core/app';
import type { SerializedError } from '../core/errors';
import { can } from '../core/context';
import { saveUpload } from '../core/modules/data/uploads';
import { APP_VERSION } from '../shared/version';
import { flushDatabases, setSqlJs } from './node/sqlite';
import { loadSavedFiles, saveChanges } from './storage';
import { BrowserPlatform } from './platform';

// The core's password code uses Buffer, which browsers do not have.
const g = globalThis as { Buffer?: unknown };
if (!g.Buffer) g.Buffer = Buffer;

type ApiResult = { ok: true; data: unknown } | { ok: false; error: SerializedError };

const DATA_DIR = '/data';
let starting: Promise<BillforceApp> | null = null;

/** Only one tab may work on the data at a time, or the tabs would overwrite each other's changes. */
function holdTabLock(): Promise<void> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks?.request) return Promise.resolve();
  return new Promise((resolve, reject) => {
    void locks.request('billforce-erp-data', { ifAvailable: true }, (lock) => {
      if (!lock) {
        reject(new Error('Billforce is already open in another tab or window of this browser. Use that one, or close it and reload this page.'));
        return undefined;
      }
      resolve();
      // Keep the lock for as long as this page is open.
      return new Promise<void>(() => {});
    });
  });
}

function start(): Promise<BillforceApp> {
  return (starting ??= (async () => {
    await holdTabLock();
    void navigator.storage?.persist?.().catch(() => false);
    setSqlJs(await initSqlJs({ locateFile: () => wasmUrl }));
    await loadSavedFiles();
    const { BillforceApp } = await import('../core/app');
    // Automatic copies would only fill this browser's storage: backups are downloaded instead.
    return new BillforceApp({ dataDir: DATA_DIR, platform: new BrowserPlatform(), version: APP_VERSION, autoBackup: false });
  })());
}

let warnedSaveFailure = false;

/** Save what changed; a failure (e.g. the browser's storage is full) is shown once. */
async function save(): Promise<void> {
  try {
    flushDatabases();
    await saveChanges();
    warnedSaveFailure = false;
  } catch (e) {
    console.error('[Billforce] Saving data failed:', e);
    if (!warnedSaveFailure) {
      warnedSaveFailure = true;
      window.alert(`Billforce could not save your latest changes in this browser (${(e as Error)?.message ?? e}). Free some disk space, then download a backup from Settings > Backup.`);
    }
  }
}

export async function invokeLocal(name: string, input: unknown, token: string | null): Promise<ApiResult> {
  let app: BillforceApp;
  try {
    app = await start();
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: (e as Error)?.message ?? String(e) } };
  }
  const result = await app.invoke(name, input, token);
  await save();
  return result;
}

/** Keep a backup file chosen on this computer for backup.inspectUpload / backup.restoreUpload. */
export async function uploadLocal(bytes: Uint8Array, token: string | null): Promise<ApiResult> {
  const app = await start();
  const ctx = app.ctx(token);
  if (!ctx.session || !ctx.businessId) return { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Please log in to continue' } };
  if (!can(ctx, 'data.restore')) return { ok: false, error: { code: 'FORBIDDEN', message: 'You do not have permission to restore backups.' } };
  try {
    return { ok: true, data: { uploadId: saveUpload(DATA_DIR, ctx.businessId, bytes) } };
  } catch (e) {
    return { ok: false, error: { code: 'VALIDATION', message: (e as Error).message } };
  }
}

// Last chance to save when the page is hidden or closed (writes are normally saved after every action).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && starting) void save();
});
