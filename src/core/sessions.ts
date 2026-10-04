import crypto from 'node:crypto';
import { Db } from './db/database';

/** A login ends after this long without use ... */
export const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
/** ... and after this long in any case. */
export const SESSION_MAX_MS = 30 * 24 * 60 * 60 * 1000;
/** last_seen_at is written at most this often per session. */
const TOUCH_MS = 5 * 60 * 1000;

export interface StoredSession {
  businessId: string;
  userId: number;
  createdAt: number;
}

interface SessionRow {
  token_hash: string;
  business_id: string;
  user_id: number;
  created_at: number;
  last_seen_at: number;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Logins of every business, kept in <dataDir>/system.db so they survive a
 * restart. Only a hash of each token is stored. Business data never lives
 * here, so a backup or restore of a business does not carry logins with it.
 */
export class SessionStore {
  private db: Db;

  constructor(
    dbPath: string,
    private clock: () => Date,
  ) {
    this.db = new Db(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        business_id TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (business_id, user_id);
    `);
  }

  private nowMs(): number {
    return this.clock().getTime();
  }

  /** Start a login; returns the token the browser sends with every request. */
  create(businessId: string, userId: number): string {
    const token = crypto.randomBytes(32).toString('base64url');
    const t = this.nowMs();
    this.db.run('INSERT INTO sessions (token_hash, business_id, user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)', [
      hashToken(token),
      businessId,
      userId,
      t,
      t,
    ]);
    this.db.run('DELETE FROM sessions WHERE last_seen_at < ? OR created_at < ?', [t - SESSION_IDLE_MS, t - SESSION_MAX_MS]);
    return token;
  }

  /** The login behind a token, or null when it is unknown, logged out or expired. */
  resolve(token: string | null | undefined): StoredSession | null {
    if (!token || token.length > 200) return null;
    const key = hashToken(token);
    const row = this.db.get<SessionRow>('SELECT * FROM sessions WHERE token_hash = ?', [key]);
    if (!row) return null;
    const t = this.nowMs();
    if (t - row.last_seen_at > SESSION_IDLE_MS || t - row.created_at > SESSION_MAX_MS) {
      this.db.run('DELETE FROM sessions WHERE token_hash = ?', [key]);
      return null;
    }
    if (t - row.last_seen_at > TOUCH_MS) this.db.run('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?', [t, key]);
    return { businessId: row.business_id, userId: row.user_id, createdAt: row.created_at };
  }

  revoke(token: string): void {
    this.db.run('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
  }

  /** Log a user out everywhere, optionally keeping one session (the one making the change). */
  revokeUser(businessId: string, userId: number, keepToken?: string | null): void {
    this.db.run('DELETE FROM sessions WHERE business_id = ? AND user_id = ? AND token_hash <> ?', [businessId, userId, keepToken ? hashToken(keepToken) : '']);
  }

  /** Log everyone of a business out (after its data was replaced by a restore). */
  revokeBusiness(businessId: string): void {
    this.db.run('DELETE FROM sessions WHERE business_id = ?', [businessId]);
  }

  close(): void {
    this.db.close();
  }
}
