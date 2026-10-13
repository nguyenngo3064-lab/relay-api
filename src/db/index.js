// src/db/index.js
// SQLite persistence using Node 24's built-in node:sqlite (zero native deps).
//
// Persistent data:
//  - admin account (argon2id password hash)
//  - providers (configuration) and encrypted credentials
//  - client relay-key hashes + metadata
//  - application settings
//  - usage history and diagnostic events
//  - sessions (hashed ids)
//
// We never persist full prompts/completions by default.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRATIONS } from './schema.js';

export { MIGRATIONS };

export function createDatabase(dbPath) {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  runMigrations(db);
  return db;
}

export function runMigrations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );`);
  const applied = new Set(db.prepare('SELECT id FROM _migrations').all().map((r) => r.id));
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    db.exec('BEGIN');
    try {
      migration.up(db);
      db.prepare('INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)').run(
        migration.id,
        migration.name,
        new Date().toISOString()
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

export function getMeta(db, key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setMeta(db, key, value) {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}
