import fs from 'node:fs';
import path from 'node:path';
import { Db } from '../db/database';
import { AppError } from '../errors';
import { BillforceApp } from '../app';
import { completeSetup, type SetupInput } from '../modules/auth/service';
import type { AppHooks, Ctx, RegisterBusinessInput } from '../context';
import type { Platform } from '../platform';
import { todayISO, fyOf } from '../../shared/dates';

export interface RegisteredBusiness {
  id: string;
  name: string;
  dbPath: string;
  createdAt: string;
}

const NO_HOOKS: AppHooks = {
  startSession: () => {
    throw new Error('No session hooks while setting up a business');
  },
  endSession: () => {},
  endUserSessions: () => {},
  registerBusiness: () => {
    throw new Error('Not available here');
  },
  renameBusiness: () => {},
  replaceDatabase: () => {
    throw new Error('Not available here');
  },
  markDirty: () => {},
};

/**
 * The businesses on this server. Each has its own SQLite file
 * (<dataDir>/businesses/<id>.db); businesses.json maps the name people sign
 * in with to that file.
 */
export class BusinessManager {
  private dataDir: string;
  private platform: Platform;
  private registryFile: string;
  private businessesDir: string;
  private clock: () => Date;
  private version: string;
  private dbCache = new Map<string, Db>();
  private businesses: RegisteredBusiness[] = [];

  constructor(opts: { dataDir: string; platform: Platform; clock?: () => Date; version?: string }) {
    this.dataDir = opts.dataDir;
    this.platform = opts.platform;
    this.clock = opts.clock ?? (() => new Date());
    this.version = opts.version ?? '';
    this.registryFile = path.join(this.dataDir, 'businesses.json');
    this.businessesDir = path.join(this.dataDir, 'businesses');
    fs.mkdirSync(this.businessesDir, { recursive: true });
    this.loadRegistry();
  }

  private loadRegistry(forceScan = false): void {
    if (!forceScan && fs.existsSync(this.registryFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.registryFile, 'utf8'));
        if (Array.isArray(parsed)) {
          this.businesses = parsed.filter((b) => b && typeof b.id === 'string' && typeof b.name === 'string' && typeof b.dbPath === 'string');
          return;
        }
      } catch (e) {
        console.error('Failed to read businesses.json, scanning the data folder instead:', e);
      }
    }

    this.businesses = [];
    // A data folder from the single-business version: its billforce.db becomes the first business.
    const mainDb = path.join(this.dataDir, 'billforce.db');
    if (fs.existsSync(mainDb)) {
      const name = readBusinessName(mainDb, true);
      if (name) this.businesses.push({ id: this.slugify(name), name, dbPath: mainDb, createdAt: new Date().toISOString() });
    }
    for (const file of fs.readdirSync(this.businessesDir).filter((f) => f.endsWith('.db') && !/-before-update-v\d+\.db$/.test(f))) {
      const dbPath = path.join(this.businessesDir, file);
      if (this.businesses.some((b) => b.dbPath === dbPath)) continue;
      const name = readBusinessName(dbPath, false);
      if (name) this.businesses.push({ id: file.replace(/\.db$/, ''), name, dbPath, createdAt: new Date().toISOString() });
    }
    this.saveRegistry();
  }

  private saveRegistry(): void {
    // Write a temporary file and rename it, so a crash never leaves a half-written registry.
    const tmp = `${this.registryFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.businesses, null, 2), 'utf8');
    fs.renameSync(tmp, this.registryFile);
  }

  private slugify(name: string): string {
    return (
      name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || `biz-${Date.now()}`
    );
  }

  listBusinesses(): RegisteredBusiness[] {
    return [...this.businesses];
  }

  /** Rebuild the registry from the files in the data folder. */
  reload(): void {
    this.loadRegistry(true);
  }

  get(id: string): RegisteredBusiness | null {
    return this.businesses.find((b) => b.id === id) ?? null;
  }

  /** A business by the name people sign in with (any case) or by its id. */
  findBusiness(nameOrId: string): RegisteredBusiness | null {
    const q = nameOrId.trim().toLowerCase();
    if (!q) return null;
    return this.businesses.find((b) => b.name.trim().toLowerCase() === q || b.id.toLowerCase() === q) || null;
  }

  getDb(dbPath: string): Db {
    let db = this.dbCache.get(dbPath);
    if (!db) {
      db = BillforceApp.openDatabase(dbPath, this.clock());
      this.dbCache.set(dbPath, db);
    }
    return db;
  }

  /** A context for setting up a new business (no logged-in user yet). */
  private setupCtx(db: Db, business: RegisteredBusiness): Ctx {
    return {
      db,
      session: null,
      businessId: business.id,
      platform: this.platform,
      clock: this.clock,
      info: {
        version: this.version,
        dataDir: this.dataDir,
        dbPath: business.dbPath,
        defaultBackupDir: path.join(this.dataDir, 'backups', business.id),
        registrationOpen: true,
      },
      app: NO_HOOKS,
    };
  }

  /** Create the database of a new business, with its owner and opening balances. */
  registerBusiness(input: RegisterBusinessInput): { business: RegisteredBusiness; recoveryCode: string; ownerId: number } {
    const name = input.business.name.trim();
    if (!name) throw new AppError('VALIDATION', 'Business name is required', { name: 'Enter your business name' });
    if (this.findBusiness(name)) {
      throw new AppError('CONFLICT', `Business "${name}" is already registered. Please sign in instead.`, { name: 'This name is already registered' });
    }

    const base = this.slugify(name);
    let slug = base;
    for (let n = 2; fs.existsSync(path.join(this.businessesDir, `${slug}.db`)) || this.get(slug); n++) slug = `${base}-${n}`;
    const record: RegisteredBusiness = { id: slug, name, dbPath: path.join(this.businessesDir, `${slug}.db`), createdAt: new Date().toISOString() };

    const db = BillforceApp.openDatabase(record.dbPath, this.clock());
    const setupInput: SetupInput = {
      business: { name, address: input.business.address || '', phone: input.business.phone || '', email: input.business.email || '' },
      owner: { fullName: input.owner.fullName.trim(), username: input.owner.username.trim(), password: input.owner.password },
      booksStartDate: input.booksStartDate || fyOf(todayISO()).start,
      openingCash: input.openingCash ?? 0,
      openingBank: input.openingBank ?? 0,
      openingUpi: input.openingUpi ?? 0,
    };
    let result: ReturnType<typeof completeSetup>;
    try {
      result = db.tx(() => completeSetup(this.setupCtx(db, record), setupInput));
    } catch (e) {
      // Leave nothing behind for a registration that failed (e.g. a weak password).
      db.close();
      for (const suffix of ['', '-wal', '-shm']) fs.rmSync(record.dbPath + suffix, { force: true });
      throw e;
    }
    this.dbCache.set(record.dbPath, db);
    this.businesses.push(record);
    this.saveRegistry();
    return { business: record, recoveryCode: result.recoveryCode, ownerId: result.session.userId };
  }

  /** Change the name a business signs in with (names must stay unique). */
  rename(id: string, newName: string): void {
    const business = this.get(id);
    const name = newName.trim();
    if (!business || !name || business.name === name) return;
    const other = this.findBusiness(name);
    if (other && other.id !== id) {
      throw new AppError('VALIDATION', `Another business is already registered as "${name}". Choose a different name.`, { name: 'This name is already registered' });
    }
    business.name = name;
    this.saveRegistry();
  }

  /**
   * Replace a business's data with a backup file. The file is checked by
   * opening and updating a copy of it first; the live file is swapped only
   * when that works. The sign-in name follows the restored business's name
   * (when no other business uses it), so people sign in with the name they see.
   * Returns the business name to sign in with.
   */
  replaceDb(id: string, sourcePath: string): string {
    const business = this.get(id);
    if (!business) throw new AppError('NOT_FOUND', 'Business not found');
    const target = business.dbPath;
    const tmp = `${target}.restore-tmp`;
    fs.copyFileSync(sourcePath, tmp);
    try {
      BillforceApp.openDatabase(tmp, this.clock(), false).close();
    } catch (e) {
      for (const suffix of ['', '-wal', '-shm']) fs.rmSync(tmp + suffix, { force: true });
      throw new AppError('VALIDATION', `This backup cannot be restored: ${(e as Error).message}`);
    }
    for (const suffix of ['-wal', '-shm']) fs.rmSync(tmp + suffix, { force: true });
    this.dbCache.get(target)?.close();
    this.dbCache.delete(target);
    for (const suffix of ['-wal', '-shm']) fs.rmSync(target + suffix, { force: true });
    fs.renameSync(tmp, target);
    const restoredName = businessNameIn(this.getDb(target));
    if (restoredName && restoredName !== business.name) {
      try {
        this.rename(id, restoredName);
      } catch {
        /* Another business here uses that name: keep the registered one. */
      }
    }
    return business.name;
  }

  close(): void {
    for (const db of this.dbCache.values()) {
      try {
        db.close();
      } catch {
        /* Closing one business must not prevent closing the others. */
      }
    }
    this.dbCache.clear();
  }
}

/** The business name in an open database (null if it has none). */
function businessNameIn(db: Db): string | null {
  try {
    const row = db.get<{ value?: string }>("SELECT value FROM settings WHERE key = 'business'");
    const name = row?.value ? JSON.parse(row.value)?.name : null;
    return typeof name === 'string' && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

/** The business name stored in a data file (null if it is not a set-up Billforce database). */
function readBusinessName(dbPath: string, requireSetup: boolean): string | null {
  let db: Db | null = null;
  try {
    db = new Db(dbPath);
    if (requireSetup && db.get<{ value?: string }>("SELECT value FROM settings WHERE key = 'meta.setup_done'")?.value !== '1') return null;
    const row = db.get<{ value?: string }>("SELECT value FROM settings WHERE key = 'business'");
    const name = row?.value ? JSON.parse(row.value)?.name : null;
    return typeof name === 'string' && name.trim() ? name.trim() : null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}
