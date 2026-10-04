import type { Db } from './db/database';
import type { Platform } from './platform';
import type { BillforceApp } from './app';
import type { Role } from '../shared/constants';
import type { Permission } from '../shared/permissions';
import { toISODate, toTimestamp } from '../shared/dates';
import { AppError } from './errors';

export interface Session {
  userId: number;
  username: string;
  fullName: string;
  role: Role;
  permissions: Permission[];
  loginAt: string;
}

export interface AppInfo {
  version: string;
  dataDir: string;
  dbPath: string;
  /** Folder for this business's backups (<dataDir>/backups/<business id>). */
  defaultBackupDir: string;
  /** Can visitors register a new business (BILLFORCE_REGISTRATION is not "closed")? */
  registrationOpen: boolean;
}

/**
 * Everything a service function needs. A fresh Ctx is built for every API
 * call; services must not keep references to it.
 */
export interface Ctx {
  db: Db;
  session: Session | null;
  /** The business this call works on (null before login). */
  businessId: string | null;
  platform: Platform;
  /** Current time. Injectable so tests can control dates. */
  clock: () => Date;
  info: AppInfo;
  /** Hooks into the running app (logins, database swap on restore). */
  app: AppHooks;
  appInstance?: BillforceApp;
}

export interface RegisterBusinessInput {
  business: { name: string; address?: string | null; phone?: string | null; email?: string | null };
  owner: { fullName: string; username: string; password: string };
  booksStartDate?: string | null;
  openingCash?: number | null;
  openingBank?: number | null;
  openingUpi?: number | null;
}

export interface AppHooks {
  /** Log a user of this business in; returns the new session token. */
  startSession(userId: number): string;
  /** Log the current session out. */
  endSession(): void;
  /** Log a user out on every device, optionally keeping the session making this call. */
  endUserSessions(userId: number, keepCurrent?: boolean): void;
  /** Create a new business with its owner, and log the owner in. */
  registerBusiness(input: RegisterBusinessInput): { businessId: string; businessName: string; recoveryCode: string; token: string };
  /** Change the name this business signs in with. */
  renameBusiness(name: string): void;
  /** Replace this business's database with the given file (used by restore). */
  replaceDatabase(sourcePath: string): void;
  /** Note that data changed (used to decide when to back up). */
  markDirty(): void;
}

/** Local timestamp "YYYY-MM-DD HH:MM:SS". */
export function now(ctx: Ctx): string {
  return toTimestamp(ctx.clock());
}

/** Today's date "YYYY-MM-DD". */
export function today(ctx: Ctx): string {
  return toISODate(ctx.clock());
}

export function requireSession(ctx: Ctx): Session {
  if (!ctx.session) throw new AppError('UNAUTHENTICATED', 'Please log in to continue');
  return ctx.session;
}

export function can(ctx: Ctx, permission: Permission): boolean {
  const s = ctx.session;
  if (!s) return false;
  return s.role === 'owner' || s.permissions.includes(permission);
}

export function assertCan(ctx: Ctx, permission: Permission, message?: string): void {
  requireSession(ctx);
  if (!can(ctx, permission)) {
    throw new AppError('FORBIDDEN', message ?? 'You do not have permission to do this. Ask the owner to allow it.');
  }
}

export function currentUserId(ctx: Ctx): number | null {
  return ctx.session?.userId ?? null;
}
