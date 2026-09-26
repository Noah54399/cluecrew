import fs from 'node:fs';
import path from 'node:path';
import type { ServerConfig } from '../config.js';
import { openDatabase, type Db } from './driver.js';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.js';

export type { Db } from './driver.js';

export function openAppDatabase(config: Pick<ServerConfig, 'databasePath'>): Db {
  if (config.databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  }
  const db = openDatabase(config.databasePath);
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  db.exec(SCHEMA_SQL);
  // Additive migrations for databases created before schema v2.
  ensureColumn(db, 'users', 'preferred_source', "TEXT NOT NULL DEFAULT 'auto'");
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    'schema_version',
    String(SCHEMA_VERSION),
  );
}

function ensureColumn(db: Db, table: string, column: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = rows.some((row) => String(row.name) === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
