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

/**
 * 埋点动作类型。scene 与 source_page 用于周报交叉表。
 *
 * `workflow_*` 是 v0.2 工作流编排层引入的。PRD 门禁是「无埋点不上线」，
 * 因此新功能与工具点击同表同口径，而不是另起一套统计。
 */
export const EVENT_ACTIONS = [
  'tool_click',
  'tool_view',
  'search',
  'favorite_add',
  'favorite_remove',
  'workflow_view',
  'workflow_submit',
  'workflow_finish',
] as const
export type EventAction = (typeof EVENT_ACTIONS)[number]

/** 工作流任务状态机：queued → running → succeeded / failed / canceled。 */
export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'canceled'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

/** 已进入终态的任务不再被队列拾取，也不能再被取消。 */
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ['succeeded', 'failed', 'canceled']

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

    CREATE TABLE IF NOT EXISTS workflows (
      slug              TEXT    PRIMARY KEY,
      name              TEXT    NOT NULL,
      scene_slug        TEXT    NOT NULL,
      provider          TEXT    NOT NULL,
      provider_ref      TEXT    NOT NULL,
      output_kind       TEXT    NOT NULL,
      cost_credits      INTEGER NOT NULL,
      estimated_seconds INTEGER NOT NULL,
      definition        TEXT    NOT NULL,
      synced_at         TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workflow_slug   TEXT    NOT NULL,
      workflow_name   TEXT    NOT NULL,
      provider        TEXT    NOT NULL,
      provider_ref    TEXT    NOT NULL,
      output_kind     TEXT    NOT NULL,
      cost_credits    INTEGER NOT NULL,
      status          TEXT    NOT NULL,
      params_json     TEXT    NOT NULL,
      provider_job_id TEXT,
      outputs_json    TEXT,
      error           TEXT,
      created_at      TEXT    NOT NULL,
      started_at      TEXT,
      finished_at     TEXT,
      /** 队列心跳。进程重启后据此把僵死的 running 任务放回队列。 */
      heartbeat_at    TEXT,
      attempts        INTEGER NOT NULL DEFAULT 0,
      client_hash     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_runs_user ON workflow_runs(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_runs_status ON workflow_runs(status);
    CREATE INDEX IF NOT EXISTS idx_runs_workflow ON workflow_runs(workflow_slug);
    CREATE INDEX IF NOT EXISTS idx_runs_created ON workflow_runs(created_at);

    CREATE TABLE IF NOT EXISTS canvases (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT    NOT NULL,
      created_at TEXT    NOT NULL,
      updated_at TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_canvases_user ON canvases(user_id, updated_at);

    CREATE TABLE IF NOT EXISTS canvas_items (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      canvas_id  INTEGER NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
      /** 图片来源：外部链接或内联图片数据，写入前按 image_url 同一套规则校验。 */
      src        TEXT    NOT NULL,
      label      TEXT,
      x          REAL    NOT NULL,
      y          REAL    NOT NULL,
      width      REAL    NOT NULL,
      height     REAL    NOT NULL,
      z          INTEGER NOT NULL DEFAULT 0,
      /** 由哪个任务产出。用于从产出回溯到当时的参数。 */
      source_run_id  INTEGER,
      /** 由画布上哪张图派生。重绘、扩图、变体据此形成一条可追溯的链。 */
      source_item_id INTEGER,
      created_at TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_canvas_items_canvas ON canvas_items(canvas_id, z);
  `)

  addColumnIfMissing(db, 'tool_events', 'workflow_slug', 'TEXT')
  db.exec('CREATE INDEX IF NOT EXISTS idx_events_workflow ON tool_events(workflow_slug)')
}

/**
 * 幂等加列。
 *
 * SQLite 没有 `ADD COLUMN IF NOT EXISTS`，而已部署的库里 tool_events 已有数据，
 * 不能靠重建表迁移。先查 pragma 再决定是否加列。
 */
function addColumnIfMissing(db: DatabaseSync, table: string, column: string, type: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (columns.some((c) => c.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}

export function nowIso(): string {
  return new Date().toISOString()
}
