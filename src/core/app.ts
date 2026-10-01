import fs from 'node:fs';
import path from 'node:path';
import { Db } from './db/database';
import { LATEST_SCHEMA_VERSION, migrate, schemaVersion } from './db/migrate';
import { seedReferenceData } from './seed';
import type { AppHooks, AppInfo, Ctx, Session } from './context';
import { withSafeguards, type Platform } from './platform';
import { dispatch } from './api/router';
import { routes } from './api/routes';
import { serializeError, type SerializedError } from './errors';
import { toTimestamp } from '../shared/dates';
import { triggerAutoSyncDebounced } from './supabase/syncService';

export type ApiResult = { ok: true; data: unknown } | { ok: false; error: SerializedError };

export interface AppOptions {
  /** Folder for the database and logs (e.g. %APPDATA%\Billforce). */
  dataDir: string;
  /** Database file; defaults to <dataDir>/billforce.db. Use ':memory:' in tests. */
  dbPath?: string;
  platform: Platform;
  version: string;
  clock?: () => Date;
  /** Default backup folder; defaults to <Documents>/Billforce Backups. */
  backupDir?: string;
}

/**
 * One running instance of Billforce: the open database, the logged-in user
 * and the API. The Electron main process creates exactly one.
 */
export class BillforceApp {
  db: Db;
  session: Session | null = null;
  private sessionsByToken = new Map<string, Session>();
  readonly platform: Platform;
  readonly info: AppInfo;
  clock: () => Date;
  /** Time of the last data change, used to decide whether a backup is needed. */
  lastChangeAt: number | null = null;
  private listeners = new Set<(event: string) => void>();

  constructor(opts: AppOptions) {
    // Every service sees the platform through the same safeguards (saved-file registry, printer check).
    this.platform = withSafeguards(opts.platform);
    this.clock = opts.clock ?? (() => new Date());
    const dbPath = opts.dbPath ?? path.join(opts.dataDir, 'billforce.db');
    if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.info = {
      version: opts.version,
      dataDir: opts.dataDir,
      dbPath,
      defaultBackupDir: opts.backupDir ?? path.join(opts.platform.documentsDir(), 'Billforce Backups'),
    };
    this.db = BillforceApp.openDatabase(dbPath, this.clock());
  }

  static openDatabase(dbPath: string, at: Date): Db {
    const db = new Db(dbPath);
    try {
      keepCopyBeforeUpdate(db, dbPath);
      migrate(db);
      seedReferenceData(db, toTimestamp(at));
    } catch (e) {
      db.close();
      throw e;
    }
    return db;
  }

  private hooks(token?: string | null): AppHooks {
    return {
      setSession: (s) => {
        if (token) {
          if (s) this.sessionsByToken.set(token, s);
          else this.sessionsByToken.delete(token);
        }
        this.session = s;
      },
      replaceDatabase: (sourcePath) => this.replaceDatabase(sourcePath),
      markDirty: () => {
        this.lastChangeAt = Date.now();
      },
    };
  }

  /** A context for one API call or background job. */
  ctx(token?: string | null): Ctx {
    const activeSession = token ? (this.sessionsByToken.get(token) || null) : this.session;
    return {
      db: this.db,
      session: activeSession,
      platform: this.platform,
      clock: this.clock,
      info: this.info,
      app: this.hooks(token),
      appInstance: this,
    };
  }

  /** Call an API route. Never throws; errors come back as { ok: false }. */
  async invoke(name: string, input?: unknown, token?: string | null): Promise<ApiResult> {
    try {
      const activeCtx = this.ctx(token);
      const data = await dispatch(routes, activeCtx, name, input);
      if (name === 'auth.login' && data && typeof data === 'object' && 'token' in (data as any)) {
        const issuedToken = (data as any).token as string;
        if (activeCtx.session) {
          this.sessionsByToken.set(issuedToken, activeCtx.session);
        }
      } else if (name === 'auth.logout' && token) {
        this.sessionsByToken.delete(token);
      }

      // Trigger background sync for mutations
      if ((routes as Record<string, any>)[name]?.mutation && !name.startsWith('supabase.')) {
        triggerAutoSyncDebounced(this, 1500);
      }
      return { ok: true, data: data === undefined ? null : data };
    } catch (e) {
      const error = serializeError(e);
      if (error.code === 'INTERNAL') console.error(`[api] ${name} failed:`, e);
      return { ok: false, error };
    }
  }

  onEvent(fn: (event: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event: string): void {
    for (const fn of this.listeners) fn(event);
  }

  /**
   * Swap the open database for a copy of sourcePath (restore from backup).
   * The file is validated by opening and migrating it before it replaces the
   * live database; the user is logged out afterwards.
   */
  replaceDatabase(sourcePath: string): void {
    const target = this.info.dbPath;
    if (target === ':memory:') throw new Error('Cannot restore into an in-memory database');
    // Validate first: this throws if the file is not a usable Billforce database.
    const tmp = `${target}.restore-tmp`;
    fs.copyFileSync(sourcePath, tmp);
    try {
      const probe = BillforceApp.openDatabase(tmp, this.clock());
      probe.close();
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw e;
    }
    this.db.close();
    try {
      for (const suffix of ['-wal', '-shm']) fs.rmSync(target + suffix, { force: true });
      fs.renameSync(tmp, target);
    } catch (e) {
      // Put the original database back in service before reporting the failure.
      this.db = BillforceApp.openDatabase(target, this.clock());
      throw e;
    }
    this.db = BillforceApp.openDatabase(target, this.clock());
    this.session = null;
    this.lastChangeAt = Date.now();
    this.emit('database-replaced');
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Before an update changes an older data file, keep a copy of it next to the file
 * (billforce-before-update-v<data version>.db), so the shop can always go back.
 */
export function keepCopyBeforeUpdate(db: Db, dbPath: string): string | null {
  if (dbPath === ':memory:') return null;
  const version = schemaVersion(db);
  if (version === 0 || version >= LATEST_SCHEMA_VERSION) return null;
  const copy = path.join(path.dirname(dbPath), `billforce-before-update-v${version}.db`);
  if (fs.existsSync(copy)) return copy;
  db.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
  return copy;
}
