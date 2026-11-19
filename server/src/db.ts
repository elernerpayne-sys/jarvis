/**
 * The SQLite file (node:sqlite, built into Node 22) and its migrations.
 *
 * Columns are exactly the fields in src/lib/types.ts. Timestamps are stored
 * as ISO-8601 UTC strings with milliseconds ("2026-11-19T15:04:05.000Z"), so
 * text order is time order. Lists (tags, transcript, repos, prefs) are JSON
 * text. A few extra internal columns (dispatch bookkeeping) never leave the
 * server: rows are mapped to API shapes in rows.ts, field by field.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type Db = DatabaseSync

/** Each entry runs once, in order; PRAGMA user_version remembers how far we got. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE owner (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL REFERENCES owner (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX sessions_expires_idx ON sessions (expires_at);

  CREATE TABLE email_codes (
    email      TEXT PRIMARY KEY COLLATE NOCASE,
    code_hash  TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE shops (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    phone      TEXT NOT NULL UNIQUE,
    address    TEXT NOT NULL DEFAULT '',
    timezone   TEXT NOT NULL DEFAULT 'UTC',
    status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
    created_at TEXT NOT NULL
  );

  CREATE TABLE calls (
    id               TEXT PRIMARY KEY,
    shop_id          TEXT NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
    external_id      TEXT UNIQUE,
    caller_name      TEXT,
    caller_phone     TEXT NOT NULL,
    started_at       TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    outcome          TEXT NOT NULL CHECK (outcome IN ('booked', 'answered', 'message', 'transferred', 'missed', 'failed')),
    summary          TEXT,
    transcript       TEXT NOT NULL DEFAULT '[]',
    created_at       TEXT NOT NULL
  );
  CREATE INDEX calls_shop_started_idx ON calls (shop_id, started_at DESC);
  CREATE INDEX calls_started_idx ON calls (started_at DESC);

  CREATE TABLE appointments (
    id               TEXT PRIMARY KEY,
    shop_id          TEXT NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
    external_id      TEXT UNIQUE,
    call_id          TEXT REFERENCES calls (id) ON DELETE SET NULL,
    customer_name    TEXT NOT NULL,
    customer_phone   TEXT,
    service          TEXT NOT NULL,
    barber           TEXT,
    starts_at        TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 30,
    status           TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'confirmed', 'completed', 'cancelled', 'no_show')),
    source           TEXT NOT NULL DEFAULT 'jarvis' CHECK (source IN ('jarvis', 'online', 'walk_in')),
    notes            TEXT,
    created_at       TEXT NOT NULL
  );
  CREATE INDEX appointments_shop_starts_idx ON appointments (shop_id, starts_at);

  CREATE TABLE tasks (
    id                TEXT PRIMARY KEY,
    external_id       TEXT UNIQUE,
    title             TEXT NOT NULL,
    repo              TEXT NOT NULL,
    instructions      TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'needs_approval', 'done', 'failed', 'cancelled')),
    branch            TEXT,
    result_summary    TEXT,
    pr_url            TEXT,
    error             TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    started_at        TEXT,
    finished_at       TEXT,
    -- internal: when the task runner accepted it, and how many tries it took
    dispatched_at     TEXT,
    dispatch_attempts INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX tasks_created_idx ON tasks (created_at DESC);

  CREATE TABLE task_events (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    id         TEXT NOT NULL UNIQUE,
    task_id    TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
    kind       TEXT NOT NULL CHECK (kind IN ('status', 'log', 'command', 'error')),
    message    TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX task_events_task_idx ON task_events (task_id, created_at, seq);

  CREATE TABLE approvals (
    id           TEXT PRIMARY KEY,
    kind         TEXT NOT NULL CHECK (kind IN ('code', 'receptionist', 'spend', 'other')),
    title        TEXT NOT NULL,
    detail       TEXT,
    task_id      TEXT REFERENCES tasks (id) ON DELETE SET NULL,
    shop_id      TEXT REFERENCES shops (id) ON DELETE SET NULL,
    status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
    requested_at TEXT NOT NULL,
    decided_at   TEXT,
    expires_at   TEXT,
    created_at   TEXT NOT NULL
  );
  CREATE INDEX approvals_requested_idx ON approvals (requested_at DESC);
  CREATE INDEX approvals_task_idx ON approvals (task_id);

  CREATE TABLE alerts (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL CHECK (type IN ('missed_call', 'failed_call', 'approval_needed', 'task_done', 'task_failed', 'system')),
    title       TEXT NOT NULL,
    body        TEXT,
    shop_id     TEXT REFERENCES shops (id) ON DELETE SET NULL,
    call_id     TEXT REFERENCES calls (id) ON DELETE SET NULL,
    task_id     TEXT REFERENCES tasks (id) ON DELETE SET NULL,
    approval_id TEXT REFERENCES approvals (id) ON DELETE SET NULL,
    channel     TEXT NOT NULL DEFAULT 'in_app' CHECK (channel IN ('call', 'text', 'in_app')),
    read_at     TEXT,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX alerts_created_idx ON alerts (created_at DESC);

  CREATE TABLE handbook_entries (
    id             TEXT PRIMARY KEY,
    title          TEXT NOT NULL,
    category       TEXT NOT NULL DEFAULT 'General',
    content        TEXT NOT NULL DEFAULT '',
    tags           TEXT NOT NULL DEFAULT '[]',
    notion_page_id TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );
  CREATE INDEX handbook_updated_idx ON handbook_entries (updated_at DESC);

  CREATE TABLE decisions (
    id             TEXT PRIMARY KEY,
    title          TEXT NOT NULL,
    decision       TEXT NOT NULL,
    rationale      TEXT,
    decided_on     TEXT NOT NULL,
    tags           TEXT NOT NULL DEFAULT '[]',
    notion_page_id TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );
  CREATE INDEX decisions_decided_idx ON decisions (decided_on DESC, created_at DESC);

  CREATE TABLE settings (
    id                  TEXT PRIMARY KEY,
    owner_id            TEXT,
    notify_phone        TEXT,
    notification_prefs  TEXT NOT NULL,
    quiet_hours_enabled INTEGER NOT NULL DEFAULT 0,
    quiet_hours_start   TEXT NOT NULL DEFAULT '22:00',
    quiet_hours_end     TEXT NOT NULL DEFAULT '07:00',
    timezone            TEXT NOT NULL DEFAULT 'UTC',
    allowed_repos       TEXT NOT NULL DEFAULT '[]',
    updated_at          TEXT NOT NULL
  );
  `,
]

export const DB_FILE = 'jarvis.sqlite'

export function openDb(dataDir: string): Db {
  mkdirSync(dataDir, { recursive: true })
  const db = new DatabaseSync(join(dataDir, DB_FILE))
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA synchronous = NORMAL')
  migrate(db)
  return db
}

function migrate(db: Db) {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  for (let version = row.user_version; version < MIGRATIONS.length; version++) {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(MIGRATIONS[version])
      db.exec(`PRAGMA user_version = ${version + 1}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}

/** Runs `fn` in one transaction. node:sqlite is synchronous, so nothing else runs in between. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
