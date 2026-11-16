import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config';
import { up as migration001 } from './migrations/001_initial';

let dbInstance: DatabaseSync | null = null;

export function getDb(customPath?: string): DatabaseSync {
  if (dbInstance && !customPath) {
    return dbInstance;
  }
  const targetPath = customPath || config.databasePath;
  if (targetPath !== ':memory:') {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  }
  const db = new DatabaseSync(targetPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  if (!customPath) {
    dbInstance = db;
  }
  return db;
}

export function resetDbForTests(db: DatabaseSync): void {
  dbInstance = db;
}

export function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const migrations: Array<{ version: string; up: (d: DatabaseSync) => void }> = [
    { version: '001_initial', up: migration001 },
  ];

  for (const mig of migrations) {
    const existing = db
      .prepare('SELECT version FROM schema_migrations WHERE version = ?')
      .get(mig.version);
    if (!existing) {
      db.exec('BEGIN IMMEDIATE;');
      try {
        mig.up(db);
        db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(mig.version);
        db.exec('COMMIT;');
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }
    }
  }
}

export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // ignore rollback error if transaction already aborted
    }
    throw err;
  }
}
