import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export type SqlPrimitive = null | number | bigint | string | Uint8Array;

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface DbStatement {
  run(...params: unknown[]): RunResult;
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Array<Record<string, unknown>>;
}

export interface Db {
  readonly kind: 'node:sqlite' | 'better-sqlite3';
  exec(sql: string): void;
  prepare(sql: string): DbStatement;
  transaction<T>(fn: () => T): T;
  close(): void;
}

interface RawStatement {
  run(...params: SqlPrimitive[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: SqlPrimitive[]): unknown;
  all(...params: SqlPrimitive[]): unknown[];
}

interface RawDb {
  exec(sql: string): void;
  prepare(sql: string): RawStatement;
  close(): void;
}

function normalizeParams(params: unknown[]): SqlPrimitive[] {
  return params.map((param) => {
    if (param === undefined || param === null) return null;
    if (typeof param === 'boolean') return param ? 1 : 0;
    if (param instanceof Date) return param.toISOString();
    if (param instanceof Uint8Array) return param;
    if (typeof param === 'number' || typeof param === 'bigint' || typeof param === 'string') {
      return param;
    }
    return String(param);
  });
}

class DbImpl implements Db {
  readonly kind: 'node:sqlite' | 'better-sqlite3';
  private raw: RawDb;
  private inTransaction = false;

  constructor(raw: RawDb, kind: 'node:sqlite' | 'better-sqlite3') {
    this.raw = raw;
    this.kind = kind;
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  prepare(sql: string): DbStatement {
    const statement = this.raw.prepare(sql);
    return {
      run: (...params: unknown[]) => {
        const result = statement.run(...normalizeParams(params));
        return {
          changes: Number(result.changes),
          lastInsertRowid: Number(result.lastInsertRowid),
        };
      },
      get: (...params: unknown[]) =>
        statement.get(...normalizeParams(params)) as Record<string, unknown> | undefined,
      all: (...params: unknown[]) =>
        statement.all(...normalizeParams(params)) as Array<Record<string, unknown>>,
    };
  }

  transaction<T>(fn: () => T): T {
    if (this.inTransaction) return fn();
    this.exec('BEGIN IMMEDIATE');
    this.inTransaction = true;
    try {
      const result = fn();
      this.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.exec('ROLLBACK');
      } catch {
        // ignore rollback failures
      }
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  close(): void {
    this.raw.close();
  }
}

export function openDatabase(filePath: string): Db {
  let raw: RawDb;
  let kind: 'node:sqlite' | 'better-sqlite3';

  try {
    const sqlite = require('node:sqlite') as { DatabaseSync: new (path: string) => RawDb };
    raw = new sqlite.DatabaseSync(filePath);
    kind = 'node:sqlite';
  } catch {
    try {
      const BetterSqlite3 = require('better-sqlite3') as new (path: string) => RawDb;
      raw = new BetterSqlite3(filePath);
      kind = 'better-sqlite3';
    } catch {
      throw new Error(
        'No SQLite driver available. Use Node 22.13+ (built-in node:sqlite) or install the optional dependency better-sqlite3.',
      );
    }
  }

  const db = new DbImpl(raw, kind);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  if (filePath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
  }
  return db;
}
