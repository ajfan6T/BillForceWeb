/**
 * The server's admin: one login (set by the person running the server, e.g. BILLFORCE_ADMIN_PASSWORD)
 * that sees every business registered on it and can turn one off, reset its owner's password, take
 * a backup of it or remove it. Admins never see a business's bills or accounts in detail: only who
 * registered it, how to reach them and how much it is used.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import type { Db } from './db/database';
import type { RegisteredBusiness } from './business/manager';

export interface AdminCredentials {
  username: string;
  password: string;
}

/** One business as the admin sees it. */
export interface AdminBusiness {
  id: string;
  name: string;
  registeredAt: string;
  disabled: boolean;
  owner: { fullName: string; username: string; lastLoginAt: string | null } | null;
  phone: string;
  email: string;
  address: string;
  users: number;
  bills: number;
  /** Total of the bills that are not cancelled, in paise. */
  sales: number;
  lastBillDate: string | null;
  /** Last time anyone did anything in it (the activity log). */
  lastActiveAt: string | null;
  /** Size of its database file, in bytes. */
  sizeBytes: number;
  /** The database could not be read (damaged or missing file). */
  problem: string | null;
}

const SESSION_HOURS = 8;

/** Admin sign-ins kept in memory (a restart signs the admin out). */
export class AdminSessions {
  private sessions = new Map<string, number>();

  constructor(
    private readonly credentials: AdminCredentials | null,
    private readonly clock: () => Date,
  ) {}

  get enabled(): boolean {
    return !!this.credentials;
  }

  /** A token for the right username and password, or null. */
  login(username: string, password: string): string | null {
    if (!this.credentials) return null;
    const ok = sameText(username.trim().toLowerCase(), this.credentials.username.trim().toLowerCase()) && sameText(password, this.credentials.password);
    if (!ok) return null;
    const token = randomBytes(32).toString('hex');
    this.sessions.set(token, this.clock().getTime() + SESSION_HOURS * 3600_000);
    return token;
  }

  valid(token: string | null | undefined): boolean {
    if (!token || !this.credentials) return false;
    const until = this.sessions.get(token);
    if (!until) return false;
    if (until < this.clock().getTime()) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  logout(token: string | null | undefined): void {
    if (token) this.sessions.delete(token);
  }
}

/** Compare secrets in constant time (both are hashed first, so their lengths never show). */
function sameText(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** What the admin list shows about one business, read from its database. */
export function describeBusiness(business: RegisteredBusiness, open: () => Db): AdminBusiness {
  const base: AdminBusiness = {
    id: business.id,
    name: business.name,
    registeredAt: business.createdAt,
    disabled: !!business.disabled,
    owner: null,
    phone: '',
    email: '',
    address: '',
    users: 0,
    bills: 0,
    sales: 0,
    lastBillDate: null,
    lastActiveAt: null,
    sizeBytes: fileSize(business.dbPath),
    problem: null,
  };
  try {
    const db = open();
    const settings = db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'business'");
    const info = settings ? (JSON.parse(settings.value) as Record<string, unknown>) : {};
    const owner = db.get<{ full_name: string; username: string; last_login_at: string | null }>(
      "SELECT full_name, username, last_login_at FROM users WHERE role = 'owner' AND is_active = 1 ORDER BY id LIMIT 1",
    );
    const bills = db.get<{ n: number; total: number; last: string | null }>(
      "SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END), 0) AS total, MAX(date) AS last FROM bills",
    );
    return {
      ...base,
      name: typeof info.name === 'string' && info.name ? info.name : business.name,
      owner: owner ? { fullName: owner.full_name, username: owner.username, lastLoginAt: owner.last_login_at } : null,
      phone: typeof info.phone === 'string' ? info.phone : '',
      email: typeof info.email === 'string' ? info.email : '',
      address: typeof info.address === 'string' ? info.address : '',
      users: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE is_active = 1')?.n ?? 0,
      bills: bills?.n ?? 0,
      sales: bills?.total ?? 0,
      lastBillDate: bills?.last ?? null,
      lastActiveAt: db.get<{ at: string | null }>('SELECT MAX(at) AS at FROM activity_log')?.at ?? null,
    };
  } catch (e) {
    return { ...base, problem: (e as Error).message || 'Its data could not be read' };
  }
}

function fileSize(file: string): number {
  try {
    return fs.statSync(file).size + (fs.existsSync(`${file}-wal`) ? fs.statSync(`${file}-wal`).size : 0);
  } catch {
    return 0;
  }
}

/** A temporary password that is easy to read out on the phone, e.g. "kite-4827". */
export function temporaryPassword(): string {
  const words = ['mango', 'river', 'tiger', 'lotus', 'cloud', 'pearl', 'maple', 'coral', 'amber', 'cedar', 'delta', 'ember', 'falcon', 'grape', 'hazel', 'ivory'];
  return `${words[randomInt(words.length)]}-${randomInt(1000, 10000)}`;
}
