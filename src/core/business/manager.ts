import fs from 'node:fs';
import path from 'node:path';
import { Db } from '../db/database';
import { AppError } from '../errors';
import { BillforceApp } from '../app';
import { completeSetup, login, type SetupInput, type SessionInfo } from '../modules/auth/service';
import type { Ctx, Session } from '../context';
import type { Platform } from '../platform';
import { todayISO, fyOf } from '../../shared/dates';

export interface RegisteredBusiness {
  id: string;
  name: string;
  dbPath: string;
  createdAt: string;
}

export class BusinessManager {
  private dataDir: string;
  private platform: Platform;
  private registryFile: string;
  private businessesDir: string;
  private clock: () => Date;
  private dbCache = new Map<string, Db>();
  private businesses: RegisteredBusiness[] = [];

  constructor(opts: { dataDir: string; platform: Platform; clock?: () => Date }) {
    this.dataDir = opts.dataDir;
    this.platform = opts.platform;
    this.clock = opts.clock ?? (() => new Date());
    this.registryFile = path.join(this.dataDir, 'businesses.json');
    this.businessesDir = path.join(this.dataDir, 'businesses');
    fs.mkdirSync(this.businessesDir, { recursive: true });
    this.loadRegistry();
  }

  private loadRegistry(): void {
    if (fs.existsSync(this.registryFile)) {
      try {
        const raw = fs.readFileSync(this.registryFile, 'utf8');
        this.businesses = JSON.parse(raw);
        return;
      } catch (e) {
        console.error('Failed to parse businesses.json, falling back to scanning:', e);
      }
    }

    // Auto-discover initial default database if it exists (e.g. Diet factory in billforce.db)
    this.businesses = [];
    const mainDb = path.join(this.dataDir, 'billforce.db');
    if (fs.existsSync(mainDb)) {
      try {
        const db = new Db(mainDb);
        const row = db.get<{ value?: string }>("SELECT value FROM settings WHERE key = 'business'");
        const meta = db.get<{ value?: string }>("SELECT value FROM settings WHERE key = 'meta.setup_done'");
        db.close();
        if (meta?.value === '1' && row?.value) {
          const biz = JSON.parse(row.value);
          if (biz.name) {
            const slug = this.slugify(biz.name);
            this.businesses.push({
              id: slug,
              name: biz.name,
              dbPath: mainDb,
              createdAt: new Date().toISOString(),
            });
          }
        }
      } catch {
        /* ignore */
      }
    }

    // Also scan businesses directory
    if (fs.existsSync(this.businessesDir)) {
      const files = fs.readdirSync(this.businessesDir).filter((f) => f.endsWith('.db'));
      for (const file of files) {
        const dbPath = path.join(this.businessesDir, file);
        if (this.businesses.some((b) => b.dbPath === dbPath)) continue;
        try {
          const db = new Db(dbPath);
          const row = db.get<{ value?: string }>("SELECT value FROM settings WHERE key = 'business'");
          db.close();
          if (row?.value) {
            const biz = JSON.parse(row.value);
            if (biz.name) {
              const id = file.replace(/\.db$/, '');
              this.businesses.push({
                id,
                name: biz.name,
                dbPath,
                createdAt: new Date().toISOString(),
              });
            }
          }
        } catch {
          /* ignore unreadable db */
        }
      }
    }

    this.saveRegistry();
  }

  private saveRegistry(): void {
    try {
      fs.writeFileSync(this.registryFile, JSON.stringify(this.businesses, null, 2), 'utf8');
    } catch (e) {
      console.error('Failed to write businesses.json:', e);
    }
  }

  private slugify(name: string): string {
    return (
      name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || `biz-${Date.now()}`
    );
  }

  listBusinesses(): RegisteredBusiness[] {
    return [...this.businesses];
  }

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

  createCtx(db: Db, session: Session | null = null): Ctx {
    return {
      db,
      session,
      platform: this.platform,
      clock: this.clock,
      info: {
        version: '1.2.0-supabase',
        dataDir: this.dataDir,
        dbPath: (db as any).filename || '',
        defaultBackupDir: path.join(this.platform.documentsDir(), 'Billforce Backups'),
      },
      app: {
        setSession: () => {},
        replaceDatabase: () => {},
        markDirty: () => {},
      },
    };
  }

  registerBusiness(input: {
    business: { name: string; address?: string | null; phone?: string | null; email?: string | null };
    owner: { fullName: string; username: string; password: string };
    booksStartDate?: string | null;
    openingCash?: number | null;
    openingBank?: number | null;
    openingUpi?: number | null;
  }): { business: RegisteredBusiness; recoveryCode: string; session: SessionInfo; token: string } {
    const name = input.business.name.trim();
    if (!name) throw new AppError('VALIDATION', 'Business name is required', { name: 'Enter your business name' });

    const existing = this.findBusiness(name);
    if (existing) {
      throw new AppError('CONFLICT', `Business "${name}" is already registered. Please sign in instead.`);
    }

    let slug = this.slugify(name);
    let candidatePath = path.join(this.businessesDir, `${slug}.db`);
    let counter = 2;
    while (fs.existsSync(candidatePath)) {
      slug = `${this.slugify(name)}-${counter++}`;
      candidatePath = path.join(this.businessesDir, `${slug}.db`);
    }

    const booksStartDate = input.booksStartDate || fyOf(todayISO()).start;
    const db = BillforceApp.openDatabase(candidatePath, this.clock());
    this.dbCache.set(candidatePath, db);

    const ctx = this.createCtx(db, null);
    const setupInput: SetupInput = {
      business: {
        name,
        address: input.business.address || '',
        phone: input.business.phone || '',
        email: input.business.email || '',
      },
      owner: {
        fullName: input.owner.fullName.trim(),
        username: input.owner.username.trim(),
        password: input.owner.password,
      },
      booksStartDate,
      openingCash: input.openingCash ?? 0,
      openingBank: input.openingBank ?? 0,
      openingUpi: input.openingUpi ?? 0,
    };

    const setupResult = completeSetup(ctx, setupInput);

    const record: RegisteredBusiness = {
      id: slug,
      name,
      dbPath: candidatePath,
      createdAt: new Date().toISOString(),
    };

    this.businesses.push(record);
    this.saveRegistry();

    const token = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `bf_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    return {
      business: record,
      recoveryCode: setupResult.recoveryCode,
      session: setupResult.session,
      token,
    };
  }
}
