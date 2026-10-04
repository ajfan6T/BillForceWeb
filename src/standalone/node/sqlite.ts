/**
 * Browser stand-in for node:sqlite (DatabaseSync / StatementSync) on top of
 * sql.js (SQLite compiled to WebAssembly). A database "file" is read from and
 * written back to the virtual file system (./fs), which ../storage.ts keeps in
 * IndexedDB. The Billforce core runs on it unchanged.
 */
import type { BindParams, Database as SqlJsDatabase, SqlJsStatic, SqlValue, Statement } from 'sql.js';
import fs from './fs';

let SQL: SqlJsStatic | null = null;

/** Give the loaded sql.js module (initSqlJs is asynchronous; opening a database is not). */
export function setSqlJs(sqlJs: SqlJsStatic): void {
  SQL = sqlJs;
}

const openDatabases = new Set<DatabaseSync>();

/** Write every database changed since the last flush to its file. */
export function flushDatabases(): void {
  for (const db of openDatabases) db.flush();
}

/** Settings for files on disk; meaningless for an in-memory database. */
const IGNORED = /^\s*PRAGMA\s+(journal_mode|synchronous|wal_checkpoint|busy_timeout)\b/i;
const VACUUM_INTO = /^\s*VACUUM\s+INTO\s+'((?:[^']|'')*)'\s*;?\s*$/i;
const NO_CHANGE = /^\s*(PRAGMA\s+foreign_keys\b|BEGIN\b|COMMIT\b|END\b|ROLLBACK\b|SAVEPOINT\b|RELEASE\b)/i;

/** node:sqlite takes positional values, or one object of named values (":name" in the SQL, "name" as key). */
function toBindParams(params: unknown[]): BindParams | null {
  if (!params.length) return null;
  const first = params[0];
  if (params.length === 1 && first !== null && typeof first === 'object' && !Array.isArray(first) && !ArrayBuffer.isView(first)) {
    const named: Record<string, SqlValue> = {};
    for (const [key, value] of Object.entries(first as Record<string, unknown>)) named[/^[:@$]/.test(key) ? key : `:${key}`] = value as SqlValue;
    return named;
  }
  return params as SqlValue[];
}

export class StatementSync {
  constructor(
    private owner: DatabaseSync,
    readonly sourceSQL: string,
  ) {}

  all(...params: unknown[]): Array<Record<string, SqlValue>> {
    return this.owner.withStatement(this.sourceSQL, params, (s) => {
      const rows: Array<Record<string, SqlValue>> = [];
      while (s.step()) rows.push(s.getAsObject());
      return rows;
    });
  }

  get(...params: unknown[]): Record<string, SqlValue> | undefined {
    return this.owner.withStatement(this.sourceSQL, params, (s) => (s.step() ? s.getAsObject() : undefined));
  }

  run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
    this.owner.withStatement(this.sourceSQL, params, (s) => {
      while (s.step()) {
        /* run to the end */
      }
    });
    return this.owner.afterWrite();
  }
}

export class DatabaseSync {
  private db: SqlJsDatabase;
  private statements = new Map<string, Statement>();
  private dirty: boolean;
  private inTransaction = false;
  private closed = false;

  constructor(readonly path: string) {
    if (!SQL) throw new Error('The database engine is not loaded yet');
    const bytes = path !== ':memory:' && fs.existsSync(path) ? (fs.readFileSync(path) as Uint8Array) : null;
    this.db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    this.dirty = !bytes && path !== ':memory:';
    openDatabases.add(this);
  }

  exec(sql: string): void {
    if (IGNORED.test(sql)) return;
    const vacuum = VACUUM_INTO.exec(sql);
    if (vacuum) {
      fs.writeFileSync(vacuum[1].replace(/''/g, "'"), this.snapshot());
      return;
    }
    this.db.exec(sql);
    if (/^\s*BEGIN\b/i.test(sql)) this.inTransaction = true;
    else if (/^\s*(COMMIT|END)\b/i.test(sql) || /^\s*ROLLBACK\s*;?\s*$/i.test(sql)) this.inTransaction = false;
    if (!NO_CHANGE.test(sql)) this.dirty = true;
  }

  prepare(sql: string): StatementSync {
    return new StatementSync(this, sql);
  }

  /** @internal Run a cached prepared statement with fresh parameters. */
  withStatement<T>(sql: string, params: unknown[], fn: (s: Statement) => T): T {
    let s = this.statements.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.statements.set(sql, s);
    }
    try {
      const bind = toBindParams(params);
      if (bind) s.bind(bind);
      return fn(s);
    } finally {
      s.reset();
    }
  }

  /** @internal After INSERT / UPDATE / DELETE: what node:sqlite's run() returns. */
  afterWrite(): { changes: number; lastInsertRowid: number } {
    this.dirty = true;
    const changes = this.db.getRowsModified();
    const lastInsertRowid = this.withStatement('SELECT last_insert_rowid() AS id', [], (s) => (s.step() ? Number(s.getAsObject().id) : 0));
    return { changes, lastInsertRowid };
  }

  /**
   * The database as file bytes. sql.js reopens the database to export it, which frees prepared
   * statements and resets PRAGMAs, so those are set up again (statements lazily, on next use).
   */
  private snapshot(): Uint8Array {
    if (this.inTransaction) throw new Error('The database cannot be copied in the middle of a change');
    for (const s of this.statements.values()) s.free();
    this.statements.clear();
    const bytes = this.db.export();
    this.db.exec('PRAGMA foreign_keys = ON');
    return bytes;
  }

  /** Save the database to its file if it changed (never in the middle of a transaction). */
  flush(): void {
    if (this.closed || this.inTransaction || this.path === ':memory:' || !this.dirty) return;
    fs.writeFileSync(this.path, this.snapshot());
    this.dirty = false;
  }

  close(): void {
    if (this.closed) return;
    this.flush();
    for (const s of this.statements.values()) s.free();
    this.statements.clear();
    this.db.close();
    this.closed = true;
    openDatabases.delete(this);
  }
}

export default { DatabaseSync, StatementSync };
