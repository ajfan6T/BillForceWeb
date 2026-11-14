import fs from 'node:fs';
import path from 'node:path';
import { Db } from './db/database';
import { LATEST_SCHEMA_VERSION, migrate, schemaVersion } from './db/migrate';
import { seedReferenceData } from './seed';
import type { AppHooks, AppInfo, Ctx, Session } from './context';
import { withSafeguards, type Platform } from './platform';
import { dispatch } from './api/router';
import { routes } from './api/routes';
import { AppError, serializeError, type SerializedError } from './errors';
import { toTimestamp } from '../shared/dates';
import { whatsappNumber } from '../shared/whatsapp';
import { isEmail } from '../shared/contact';
import { cancelAutoSync, triggerAutoSyncDebounced } from './supabase/syncService';
import { BusinessManager, type RegisteredBusiness } from './business/manager';
import { cancelAutoBackup, runPendingAutoBackups, triggerAutoBackupDebounced } from './modules/data/backup';
import { SessionStore } from './sessions';
import { permissionsForRole, type UserRow } from './modules/auth/service';
import { sharedBillHtml } from './modules/sales/service';
import { AdminSessions, describeBusiness, temporaryPassword, type AdminBusiness, type AdminCredentials } from './admin';
import { hashPassword } from './modules/auth/passwords';

export type ApiResult = { ok: true; data: unknown } | { ok: false; error: SerializedError };

export interface AppOptions {
  /** Folder for business databases, logins and backups. */
  dataDir: string;
  platform: Platform;
  version: string;
  clock?: () => Date;
  /** Allow visitors to register new businesses (default true). */
  registrationOpen?: boolean;
  /** A new business must give a mobile number and an email address (online billing; default false). */
  registrationContactRequired?: boolean;
  /** Keep automatic backups of each business after changes, as often as its settings say (default true). */
  autoBackup?: boolean;
  /** Folder holding each business's backup folder (default <dataDir>/backups). */
  backupRoot?: string;
  /** The server's admin login (online billing); no admin when not given. */
  admin?: AdminCredentials | null;
}

/** Online registration: the business's mobile number and email address are required. */
function checkRegistrationContact(phone: string | null | undefined, email: string | null | undefined): void {
  const fields: Record<string, string> = {};
  if (!phone?.trim()) fields['business.phone'] = 'Enter your mobile number';
  else if (!whatsappNumber(phone)) fields['business.phone'] = 'Enter a 10-digit mobile number, or + and the country code for a number outside India';
  if (!email?.trim()) fields['business.email'] = 'Enter your email address';
  else if (!isEmail(email)) fields['business.email'] = 'Enter a valid email address, e.g. name@example.com';
  const problems = Object.values(fields);
  if (problems.length) throw new AppError('VALIDATION', problems.length > 1 ? 'Enter your mobile number and email address.' : problems[0], fields);
}

/** Routes that sign in to a business chosen by name, before anyone is logged in. */
const BUSINESS_LOGIN_ROUTES = new Set(['auth.login', 'auth.recover']);

/**
 * One running Billforce server: the registered businesses, the logins
 * (session tokens) and the API. Every call names its business through its
 * session token; nothing about one login is visible to another.
 */
export class BillforceApp {
  /** Empty in-memory database used for calls made before login. */
  readonly db: Db;
  readonly businessManager: BusinessManager;
  readonly sessions: SessionStore;
  readonly platform: Platform;
  readonly info: AppInfo;
  clock: () => Date;
  private closed = false;
  private readonly autoBackup: boolean;
  private readonly backupRoot: string;

  constructor(opts: AppOptions) {
    this.autoBackup = opts.autoBackup ?? true;
    this.backupRoot = opts.backupRoot ?? path.join(opts.dataDir, 'backups');
    // Every service sees the platform through the same safeguards (saved-file registry, printer check).
    this.platform = withSafeguards(opts.platform);
    this.clock = opts.clock ?? (() => new Date());
    fs.mkdirSync(opts.dataDir, { recursive: true });
    this.info = {
      version: opts.version,
      dataDir: opts.dataDir,
      dbPath: ':memory:',
      defaultBackupDir: this.backupRoot,
      registrationOpen: opts.registrationOpen ?? true,
      registrationContactRequired: opts.registrationContactRequired ?? false,
    };
    this.db = BillforceApp.openDatabase(':memory:', this.clock());
    this.sessions = new SessionStore(path.join(opts.dataDir, 'system.db'), this.clock);
    this.businessManager = new BusinessManager({ dataDir: opts.dataDir, platform: this.platform, clock: this.clock, version: opts.version });
    this.adminSessions = new AdminSessions(opts.admin ?? null, this.clock);
  }

  /* ----------------------------------- The server's admin ----------------------------------- */

  readonly adminSessions: AdminSessions;

  /** Every business on this server, newest first, with how to reach its owner and how much it is used. */
  adminBusinesses(): AdminBusiness[] {
    return this.businessManager
      .listBusinesses()
      .map((b) => describeBusiness(b, () => this.businessManager.getDb(b.dbPath)))
      .sort((a, b) => b.registeredAt.localeCompare(a.registeredAt));
  }

  private adminBusiness(id: string): RegisteredBusiness {
    const business = this.businessManager.get(id);
    if (!business) throw new AppError('NOT_FOUND', 'This business is not on the server any more. Refresh the list.');
    return business;
  }

  /** Turn a business off (its people are signed out and cannot sign in) or on again. */
  adminSetDisabled(id: string, disabled: boolean): AdminBusiness {
    const business = this.adminBusiness(id);
    this.businessManager.setDisabled(id, disabled);
    if (disabled) this.sessions.revokeBusiness(id);
    return describeBusiness(business, () => this.businessManager.getDb(business.dbPath));
  }

  /** Give the owner a temporary password (they choose a new one at their next sign-in). */
  adminResetOwnerPassword(id: string): { username: string; fullName: string; password: string } {
    const business = this.adminBusiness(id);
    const db = this.businessManager.getDb(business.dbPath);
    const owner = db.get<{ id: number; username: string; full_name: string }>("SELECT id, username, full_name FROM users WHERE role = 'owner' AND is_active = 1 ORDER BY id LIMIT 1");
    if (!owner) throw new AppError('NOT_FOUND', 'This business has no active owner login.');
    const password = temporaryPassword();
    const at = toTimestamp(this.clock());
    db.tx(() => {
      db.run('UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?', [hashPassword(password), at, owner.id]);
      db.run("INSERT INTO activity_log (at, action, entity_type, entity_id, summary) VALUES (?, 'user.password_reset', 'user', ?, ?)", [
        at,
        owner.id,
        `The server admin gave ${owner.full_name} a temporary password`,
      ]);
    });
    this.sessions.revokeUser(id, owner.id);
    return { username: owner.username, fullName: owner.full_name, password };
  }

  /** A backup file of a business, as the app makes it (it can be restored in any edition). */
  adminBackup(id: string): { fileName: string; data: Buffer } {
    const business = this.adminBusiness(id);
    const db = this.businessManager.getDb(business.dbPath);
    const tmpDir = path.join(this.info.dataDir, 'tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmp = path.join(tmpDir, `${business.id}-${Date.now()}.bfbackup`);
    try {
      db.vacuumInto(tmp);
      const stamp = toTimestamp(this.clock()).slice(0, 16).replace(/[^0-9]/g, '');
      return { fileName: `${business.id}-${stamp}.bfbackup`, data: fs.readFileSync(tmp) };
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  /**
   * Remove a business from this server. The name typed must match it. A copy of its data is kept in
   * <data folder>/deleted first, so a mistake can be undone by restoring that file.
   */
  adminDeleteBusiness(id: string, confirmName: string): { keptCopy: string } {
    const business = this.adminBusiness(id);
    if (confirmName.trim().toLowerCase() !== business.name.trim().toLowerCase()) {
      throw new AppError('VALIDATION', `Type the business name exactly ("${business.name}") to remove it.`, { confirmName: 'The name does not match' });
    }
    const keptDir = path.join(this.info.dataDir, 'deleted');
    fs.mkdirSync(keptDir, { recursive: true });
    const stamp = toTimestamp(this.clock()).replace(/[^0-9]/g, '').slice(0, 14);
    const keptCopy = path.join(keptDir, `${business.id}-${stamp}.bfbackup`);
    this.businessManager.getDb(business.dbPath).vacuumInto(keptCopy);
    this.sessions.revokeBusiness(id);
    cancelAutoSync(business.dbPath);
    cancelAutoBackup(business.dbPath);
    this.businessManager.remove(id);
    return { keptCopy };
  }

  /** Open a data file, bringing it up to the latest schema (keeps a copy first unless keepCopy is false). */
  static openDatabase(dbPath: string, at: Date, keepCopy = true): Db {
    const db = new Db(dbPath);
    try {
      if (keepCopy) keepCopyBeforeUpdate(db, dbPath);
      migrate(db);
      seedReferenceData(db, toTimestamp(at));
    } catch (e) {
      db.close();
      throw e;
    }
    return db;
  }

  /** The business and user behind a session token, or null when it is not a valid login. */
  private resolveToken(token: string | null | undefined): { business: RegisteredBusiness; db: Db; session: Session } | null {
    if (!token) return null;
    const stored = this.sessions.resolve(token);
    if (!stored) return null;
    const business = this.businessManager.get(stored.businessId);
    const db = business ? this.businessManager.getDb(business.dbPath) : null;
    const user = db?.get<UserRow>('SELECT * FROM users WHERE id = ?', [stored.userId]);
    if (!business || business.disabled || !db || !user || !user.is_active) {
      this.sessions.revoke(token);
      return null;
    }
    // Role and permissions are read on every call, so changes by the owner apply at once.
    const session: Session = {
      userId: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
      permissions: permissionsForRole(db, user.role),
      loginAt: toTimestamp(new Date(stored.createdAt)),
    };
    return { business, db, session };
  }

  private makeCtx(db: Db, session: Session | null, business: RegisteredBusiness | null, token: string | null): Ctx {
    const requireBusiness = () => {
      if (!business) throw new AppError('UNAUTHENTICATED', 'Please log in to continue');
      return business;
    };
    const hooks: AppHooks = {
      startSession: (userId) => this.sessions.create(requireBusiness().id, userId),
      endSession: () => {
        if (token) this.sessions.revoke(token);
      },
      endUserSessions: (userId, keepCurrent) => this.sessions.revokeUser(requireBusiness().id, userId, keepCurrent ? token : null),
      registerBusiness: (input) => {
        if (!this.info.registrationOpen) throw new AppError('FORBIDDEN', 'Registration of new businesses is closed on this server.');
        if (this.info.registrationContactRequired) checkRegistrationContact(input.business.phone, input.business.email);
        const result = this.businessManager.registerBusiness(input);
        return {
          businessId: result.business.id,
          businessName: result.business.name,
          recoveryCode: result.recoveryCode,
          token: this.sessions.create(result.business.id, result.ownerId),
        };
      },
      renameBusiness: (name) => this.businessManager.rename(requireBusiness().id, name),
      replaceDatabase: (sourcePath) => {
        const b = requireBusiness();
        cancelAutoSync(b.dbPath);
        cancelAutoBackup(b.dbPath);
        const signInName = this.businessManager.replaceDb(b.id, sourcePath);
        this.sessions.revokeBusiness(b.id);
        return signInName;
      },
      markDirty: () => {},
    };
    return {
      db,
      session,
      businessId: business?.id ?? null,
      platform: this.platform,
      clock: this.clock,
      info: {
        ...this.info,
        dbPath: business?.dbPath ?? ':memory:',
        defaultBackupDir: business ? path.join(this.backupRoot, business.id) : this.backupRoot,
      },
      app: hooks,
      appInstance: this,
    };
  }

  /** A context for one API call: the logged-in user's business, or no business before login. */
  ctx(token?: string | null): Ctx {
    const r = this.resolveToken(token);
    return r ? this.makeCtx(r.db, r.session, r.business, token ?? null) : this.makeCtx(this.db, null, null, null);
  }

  /** A context for background work on one business (no user). */
  businessCtx(businessId: string): Ctx | null {
    const business = this.businessManager.get(businessId);
    return business ? this.makeCtx(this.businessManager.getDb(business.dbPath), null, business, null) : null;
  }

  /** A bill opened from its online link (sent on WhatsApp): its receipt HTML, or null. No login needed. */
  sharedBill(businessId: string, token: string): string | null {
    try {
      if (this.businessManager.get(businessId)?.disabled) return null;
      const ctx = this.businessCtx(businessId);
      return ctx ? sharedBillHtml(ctx, token) : null;
    } catch {
      return null;
    }
  }

  /** Call an API route. Never throws; errors come back as { ok: false }. */
  async invoke(name: string, input?: unknown, token?: string | null): Promise<ApiResult> {
    try {
      let ctx: Ctx;
      if (BUSINESS_LOGIN_ROUTES.has(name)) {
        const businessName = String((input as { businessName?: unknown } | null)?.businessName ?? '').trim();
        if (!businessName) throw new AppError('VALIDATION', 'Enter your registered business name', { businessName: 'Enter your business name' });
        const business = this.businessManager.findBusiness(businessName);
        if (business?.disabled) {
          throw new AppError('FORBIDDEN', `${business.name} has been turned off on this server. Please contact BILLFORCE support.`);
        }
        if (!business) {
          throw new AppError('NOT_FOUND', `Business "${businessName}" was not found. Check the name, or register your business.`, {
            businessName: 'Business not found',
          });
        }
        ctx = this.makeCtx(this.businessManager.getDb(business.dbPath), null, business, null);
      } else {
        ctx = this.ctx(token);
      }
      const data = await dispatch(routes, ctx, name, input);

      // Keep the cloud copy and the automatic backup up to date after changes.
      if ((routes as Record<string, { mutation?: boolean }>)[name]?.mutation && ctx.businessId && !name.startsWith('supabase.')) {
        triggerAutoSyncDebounced(ctx.db, 1500);
        if (this.autoBackup) triggerAutoBackupDebounced(this, ctx.businessId, ctx.db.path);
      }
      return { ok: true, data: data === undefined ? null : data };
    } catch (e) {
      const error = serializeError(e);
      if (error.code === 'INTERNAL') console.error(`[api] ${name} failed:`, e);
      return { ok: false, error };
    }
  }

  /** Make the automatic backups that are waiting for changes to settle (call before close() when the app quits). */
  finishPendingBackups(): void {
    if (!this.closed) runPendingAutoBackups(this);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const b of this.businessManager.listBusinesses()) {
      cancelAutoSync(b.dbPath);
      cancelAutoBackup(b.dbPath);
    }
    this.db.close();
    this.sessions.close();
    this.businessManager.close();
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
  const base = path.basename(dbPath).replace(/\.db$/i, '');
  const copy = path.join(path.dirname(dbPath), `${base}-before-update-v${version}.db`);
  if (fs.existsSync(copy)) return copy;
  db.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
  return copy;
}
