/**
 * Keeps the files under /data (databases, business list, backups) in IndexedDB,
 * so the browser edition still has the data after the page is closed.
 */
import { loadFile, onFileChange } from './node/fs';

const ROOT = '/data/';
/** Uploaded backups only live until they are restored. */
const TEMPORARY = '/data/uploads/';
const DB_NAME = 'billforce-erp';
const STORE = 'files';

interface Saved {
  data: Uint8Array;
  mtimeMs: number;
}

let opening: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  return (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('This browser does not allow saving data (IndexedDB)'));
    req.onblocked = () => reject(new Error('Close other BILLFORCE tabs and reload this page'));
  }));
}

const pending = new Map<string, Saved | null>();
let writing: Promise<void> = Promise.resolve();

/** Load every saved file into the virtual file system, then start recording changes. */
export async function loadSavedFiles(): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const cursor = tx.objectStore(STORE).openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      const v = c.value as Saved;
      loadFile(String(c.key), v.data, v.mtimeMs);
      c.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  onFileChange((path, data) => {
    if (path.startsWith(ROOT) && !path.startsWith(TEMPORARY)) pending.set(path, data ? { data, mtimeMs: Date.now() } : null);
  });
}

/** Write the changes recorded so far; resolves when they are safely stored. */
export function saveChanges(): Promise<void> {
  if (!pending.size) return writing;
  const batch = [...pending];
  pending.clear();
  writing = writing
    .catch(() => undefined)
    .then(async () => {
      const db = await database();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        for (const [path, saved] of batch) {
          if (saved) store.put(saved, path);
          else store.delete(path);
        }
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new Error('Saving was stopped'));
        tx.onerror = () => reject(tx.error);
      });
    });
  return writing;
}
