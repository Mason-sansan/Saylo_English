import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * @param {string} dbPath
 * @returns {import('better-sqlite3').Database}
 */
export function openUserDb(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS user_app_state (
      user_id INTEGER PRIMARY KEY,
      growth_json TEXT,
      last_session_json TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  return db;
}

/**
 * @param {import('better-sqlite3').Database} db
 */
export function userDbMethods(db) {
  const insertUser = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)');
  const byEmail = db.prepare('SELECT id, email, password_hash FROM users WHERE email = ? COLLATE NOCASE');
  const setHash = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
  const getState = db.prepare(
    'SELECT growth_json, last_session_json FROM user_app_state WHERE user_id = ?',
  );
  const upsertState = db.prepare(`
    INSERT INTO user_app_state (user_id, growth_json, last_session_json, updated_at)
    VALUES (@userId, @growthJson, @lastSessionJson, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      growth_json = excluded.growth_json,
      last_session_json = excluded.last_session_json,
      updated_at = datetime('now')
  `);

  return {
    /** @param {string} email */
    findByEmail(email) {
      return byEmail.get(email.trim().toLowerCase()) ?? null;
    },
    /** @param {string} email @param {string} passwordHash */
    createUser(email, passwordHash) {
      const e = email.trim().toLowerCase();
      const info = insertUser.run(e, passwordHash);
      return { id: Number(info.lastInsertRowid), email: e };
    },
    /** @param {number} userId @param {string} passwordHash */
    updatePasswordHash(userId, passwordHash) {
      setHash.run(passwordHash, userId);
    },
    /** @param {number} userId */
    getAppState(userId) {
      const row = getState.get(userId);
      if (!row) return { growth_json: null, last_session_json: null };
      return row;
    },
    /**
     * @param {number} userId
     * @param {string | null} growthJson
     * @param {string | null} lastSessionJson
     */
    setAppState(userId, growthJson, lastSessionJson) {
      upsertState.run({
        userId,
        growthJson,
        lastSessionJson,
      });
    },
  };
}
