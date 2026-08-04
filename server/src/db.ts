/**
 * 数据层：使用 Node 内置 node:sqlite，不引入原生编译依赖。
 *
 * 表结构按门户 PRD v0.2 的三个考核指标设计：
 *   1. 完成身份注册的用户数        → users
 *   2. 至少点过一次工具的用户占比  → tool_events
 *   3. 周报自动出数                → tool_events + users 聚合
 *
 * PRD 同时规定「埋点字段完整率 ≥95%，无埋点不上线」，因此 tool_events
 * 的必填字段在写入层强校验，不接受缺字段的上报。
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/** 用户身份类型，取自门户 PRD v0.2「登录 + 选身份」。 */
export const IDENTITIES = ['opc', 'crew', 'director', 'individual'] as const
export type Identity = (typeof IDENTITIES)[number]

/** 埋点动作类型。scene 与 source_page 用于周报交叉表。 */
export const EVENT_ACTIONS = ['tool_click', 'tool_view', 'search', 'favorite_add', 'favorite_remove'] as const
export type EventAction = (typeof EVENT_ACTIONS)[number]

const DEFAULT_DB_PATH = 'data/portal.db'

let instance: DatabaseSync | null = null

/** 打开数据库并确保表结构就绪。重复调用返回同一实例。 */
export function getDb(): DatabaseSync {
  if (instance) return instance

  const path = resolve(process.env.DB_PATH ?? DEFAULT_DB_PATH)
  mkdirSync(dirname(path), { recursive: true })

  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  migrate(db)

  instance = db
  return db
}

/** 仅供测试使用：切换到内存库并重建表结构。 */
export function useMemoryDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  instance = db
  return db
}

export function closeDb(): void {
  instance?.close()
  instance = null
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT    NOT NULL UNIQUE,
      password_hash TEXT    NOT NULL,
      display_name  TEXT    NOT NULL,
      identity      TEXT    NOT NULL,
      org           TEXT,
      created_at    TEXT    NOT NULL,
      last_login_at TEXT,
      disabled      INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT    PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT    NOT NULL,
      expires_at TEXT    NOT NULL,
      user_agent TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS favorites (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tool_id    INTEGER NOT NULL,
      created_at TEXT    NOT NULL,
      PRIMARY KEY (user_id, tool_id)
    );
    CREATE INDEX IF NOT EXISTS idx_favorites_tool ON favorites(tool_id);

    CREATE TABLE IF NOT EXISTS tool_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      identity    TEXT    NOT NULL,
      action      TEXT    NOT NULL,
      tool_id     INTEGER,
      tool_name   TEXT,
      scene       TEXT,
      source_page TEXT    NOT NULL,
      keyword     TEXT,
      occurred_at TEXT    NOT NULL,
      client_hash TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_events_occurred ON tool_events(occurred_at);
    CREATE INDEX IF NOT EXISTS idx_events_user ON tool_events(user_id);
    CREATE INDEX IF NOT EXISTS idx_events_tool ON tool_events(tool_id);
    CREATE INDEX IF NOT EXISTS idx_events_action ON tool_events(action);

    CREATE TABLE IF NOT EXISTS tools (
      id       INTEGER PRIMARY KEY,
      name     TEXT NOT NULL,
      category TEXT,
      url      TEXT,
      scenes   TEXT
    );
  `)
}

export function nowIso(): string {
  return new Date().toISOString()
}
