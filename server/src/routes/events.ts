/**
 * 埋点路由。
 *
 * 门户 PRD v0.2 的系统门禁为「埋点字段完整率 ≥95%，无埋点不上线」，
 * 因此这里对必填字段做强校验：缺字段直接拒收并返回缺失项，不做静默补空，
 * 否则完整率会被自动填充的空值抬高，失去门禁意义。
 *
 * 隐私口径：不落原始 UA 与 IP，只存散列前缀；未登录用户不写 user_id。
 */
import { Hono } from 'hono'
import { getDb, nowIso, EVENT_ACTIONS, type EventAction } from '../db.ts'
import { clientHash, currentUser } from '../lib/session.ts'

export const eventRoutes = new Hono()

export interface EventInput {
  userId: number | null
  identity: string
  action: EventAction
  toolId: number | null
  toolName: string | null
  /** 工作流事件的主键。工具事件为 null。 */
  workflowSlug: string | null
  scene: string | null
  sourcePage: string
  keyword: string | null
  clientHash: string
}

/** 各动作的必填字段。缺失即判为无效上报。 */
const REQUIRED_BY_ACTION: Record<EventAction, (keyof EventInput)[]> = {
  tool_click: ['toolId', 'toolName', 'sourcePage'],
  tool_view: ['toolId', 'sourcePage'],
  search: ['keyword', 'sourcePage'],
  favorite_add: ['toolId', 'sourcePage'],
  favorite_remove: ['toolId', 'sourcePage'],
  workflow_view: ['workflowSlug', 'sourcePage'],
  workflow_submit: ['workflowSlug', 'sourcePage'],
  // keyword 存终态（succeeded / failed / canceled），周报据此算成功率。
  workflow_finish: ['workflowSlug', 'sourcePage', 'keyword'],
}

export function recordEvent(input: EventInput): void {
  getDb()
    .prepare(
      `INSERT INTO tool_events
         (user_id, identity, action, tool_id, tool_name, workflow_slug, scene, source_page, keyword, occurred_at, client_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.userId,
      input.identity,
      input.action,
      input.toolId,
      input.toolName,
      input.workflowSlug,
      input.scene,
      input.sourcePage,
      input.keyword,
      nowIso(),
      input.clientHash,
    )
}

function isAction(value: unknown): value is EventAction {
  return typeof value === 'string' && (EVENT_ACTIONS as readonly string[]).includes(value)
}

interface EventBody {
  action?: unknown
  toolId?: unknown
  toolName?: unknown
  workflowSlug?: unknown
  scene?: unknown
  sourcePage?: unknown
  keyword?: unknown
}

eventRoutes.post('/', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as EventBody

  if (!isAction(body.action)) {
    return c.json({ ok: false, error: `action 需为 ${EVENT_ACTIONS.join(' / ')} 之一` }, 400)
  }

  const user = currentUser(c)
  const candidate: EventInput = {
    userId: user?.id ?? null,
    identity: user?.identity ?? 'anonymous',
    action: body.action,
    toolId: typeof body.toolId === 'number' && Number.isInteger(body.toolId) ? body.toolId : null,
    toolName: typeof body.toolName === 'string' && body.toolName.trim() ? body.toolName.trim().slice(0, 120) : null,
    workflowSlug:
      typeof body.workflowSlug === 'string' && body.workflowSlug.trim()
        ? body.workflowSlug.trim().slice(0, 60)
        : null,
    scene: typeof body.scene === 'string' && body.scene.trim() ? body.scene.trim().slice(0, 60) : null,
    sourcePage: typeof body.sourcePage === 'string' && body.sourcePage.trim() ? body.sourcePage.trim().slice(0, 200) : '',
    keyword: typeof body.keyword === 'string' && body.keyword.trim() ? body.keyword.trim().slice(0, 120) : null,
    clientHash: clientHash(c.req.header('user-agent'), c.req.header('x-forwarded-for')),
  }

  const missing = REQUIRED_BY_ACTION[candidate.action].filter((field) => {
    const value = candidate[field]
    return value === null || value === ''
  })
  if (missing.length > 0) {
    return c.json({ ok: false, error: '埋点字段缺失', missing }, 400)
  }

  recordEvent(candidate)
  return c.json({ ok: true })
})

/**
 * 字段完整率自检。
 *
 * 分母为区间内全部事件，分子为该动作全部必填字段均非空的事件。
 * 该数字用于证明是否达到 PRD 规定的 95% 门槛。
 */
eventRoutes.get('/completeness', (c) => {
  const since = c.req.query('since') ?? new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  const db = getDb()

  const total = (db.prepare('SELECT COUNT(*) AS n FROM tool_events WHERE occurred_at >= ?').get(since) as { n: number })
    .n

  const complete = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM tool_events
         WHERE occurred_at >= ?
           AND source_page IS NOT NULL AND source_page <> ''
           AND (
             (action IN ('tool_click') AND tool_id IS NOT NULL AND tool_name IS NOT NULL AND tool_name <> '')
             OR (action IN ('tool_view','favorite_add','favorite_remove') AND tool_id IS NOT NULL)
             OR (action = 'search' AND keyword IS NOT NULL AND keyword <> '')
             OR (action IN ('workflow_view','workflow_submit')
                 AND workflow_slug IS NOT NULL AND workflow_slug <> '')
             OR (action = 'workflow_finish'
                 AND workflow_slug IS NOT NULL AND workflow_slug <> ''
                 AND keyword IS NOT NULL AND keyword <> '')
           )`,
      )
      .get(since) as { n: number }
  ).n

  const rate = total === 0 ? null : Number(((complete / total) * 100).toFixed(2))
  return c.json({
    ok: true,
    since,
    total,
    complete,
    completenessPercent: rate,
    threshold: 95,
    passed: rate === null ? null : rate >= 95,
  })
})
