/**
 * 工作流路由：列出流水线、提交任务、查询任务与产出。
 *
 * 与工具库的差别在于这里会真实消耗第三方算力费用，因此提交路径上有三道闸：
 *   1. 必须登录——匿名产生的费用无法归属，也无法做配额。
 *   2. 参数必须通过服务端权威校验，逐字段返回错误。
 *   3. 每人每日额度上限，防止一次误操作把额度打空。
 */
import { Hono } from 'hono'
import { getDb, nowIso, RUN_STATUSES, type RunStatus } from '../db.ts'
import { clientHash, currentUser } from '../lib/session.ts'
import { recordEvent } from './events.ts'
import { loadDefinitions, definitionBySlug, type WorkflowDefinition } from '../workflow/definitions.ts'
import { providerFor, providerLabel } from '../workflow/providers/index.ts'
import { checkParams } from '../workflow/params.ts'
import { cancelRun, tick, toRunRow, toRunRows, type RunRow } from '../workflow/runner.ts'

export const workflowRoutes = new Hono()

/** 每人每日可消耗的额度。按工作流的 costCredits 累加，不是按次数。 */
function dailyCreditLimit(): number {
  const raw = Number(process.env.WORKFLOW_DAILY_CREDITS ?? 30)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 30
}

/** 同一用户未完成的任务上限，避免单人占满队列。 */
function pendingLimit(): number {
  const raw = Number(process.env.WORKFLOW_PENDING_LIMIT ?? 3)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3
}

/** 配额按自然日计算，与用户对「今天还能跑几次」的直觉一致。 */
function startOfTodayIso(): string {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
}

function usedCreditsToday(userId: number): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(cost_credits), 0) AS used FROM workflow_runs
       WHERE user_id = ? AND created_at >= ? AND status <> 'canceled'`,
    )
    .get(userId, startOfTodayIso()) as { used: number }
  return Number(row.used)
}

function pendingCount(userId: number): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM workflow_runs WHERE user_id = ? AND status IN ('queued','running')`)
    .get(userId) as { n: number }
  return row.n
}

/** 对外的工作流视图：定义 + 当下算力是否可用。前端据此决定是否允许提交。 */
function publicWorkflow(definition: WorkflowDefinition) {
  const availability = providerFor(definition.provider)
  return {
    ...definition,
    runnable: availability.available,
    unavailableReason: availability.reason,
    usingMock: availability.usingMock,
    providerLabel: providerLabel(definition.provider),
  }
}

function publicRun(row: RunRow) {
  return {
    id: row.id,
    workflowSlug: row.workflow_slug,
    workflowName: row.workflow_name,
    outputKind: row.output_kind,
    status: row.status,
    costCredits: row.cost_credits,
    params: JSON.parse(row.params_json) as Record<string, string | number | boolean>,
    outputs: row.outputs_json ? (JSON.parse(row.outputs_json) as unknown[]) : [],
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }
}

/**
 * 工作流列表。
 *
 * 默认只返回 surface=library。画布操作（局部重绘、扩图、生成变体）是画布上的
 * 动作，参数由画布填，混进列表会让人点进去看到一堆填不了的坐标字段。
 * 需要时用 `?surface=canvas` 或 `?surface=all` 显式索取。
 */
workflowRoutes.get('/', (c) => {
  const surface = c.req.query('surface') ?? 'library'
  if (!['library', 'canvas', 'all'].includes(surface)) {
    return c.json({ ok: false, error: 'surface 需为 library / canvas / all 之一' }, 400)
  }

  const definitions = loadDefinitions().filter(
    (definition) => surface === 'all' || definition.surface === surface,
  )
  return c.json({ ok: true, surface, workflows: definitions.map(publicWorkflow) })
})

/** 当前用户的配额情况。列表页和详情页都要显示「今天还剩多少」。 */
workflowRoutes.get('/quota', (c) => {
  const user = currentUser(c)
  if (!user) return c.json({ ok: false, error: '未登录' }, 401)

  const used = usedCreditsToday(user.id)
  const limit = dailyCreditLimit()
  return c.json({
    ok: true,
    quota: {
      usedCredits: used,
      limitCredits: limit,
      remainingCredits: Math.max(limit - used, 0),
      pendingRuns: pendingCount(user.id),
      pendingLimit: pendingLimit(),
      resetsAt: new Date(new Date(startOfTodayIso()).getTime() + 24 * 3600 * 1000).toISOString(),
    },
  })
})

/**
 * 我的任务列表。
 *
 * 只返回当前用户自己的任务：产出可能包含剧本片段等项目内容，不做跨用户可见。
 */
workflowRoutes.get('/runs', (c) => {
  const user = currentUser(c)
  if (!user) return c.json({ ok: false, error: '未登录' }, 401)

  const statusFilter = c.req.query('status')
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 30) || 30, 1), 100)

  const rows = toRunRows(
    statusFilter && (RUN_STATUSES as readonly string[]).includes(statusFilter)
      ? getDb()
          .prepare(
            'SELECT * FROM workflow_runs WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?',
          )
          .all(user.id, statusFilter as RunStatus, limit)
      : getDb()
          .prepare('SELECT * FROM workflow_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
          .all(user.id, limit),
  )

  return c.json({ ok: true, runs: rows.map(publicRun) })
})

workflowRoutes.get('/runs/:id', (c) => {
  const user = currentUser(c)
  if (!user) return c.json({ ok: false, error: '未登录' }, 401)

  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: '任务号不合法' }, 400)

  const row = getDb().prepare('SELECT * FROM workflow_runs WHERE id = ? AND user_id = ?').get(id, user.id)
  // 不区分「不存在」与「不是你的」，避免用任务号探测他人任务是否存在。
  if (!row) return c.json({ ok: false, error: '任务不存在' }, 404)

  return c.json({ ok: true, run: publicRun(toRunRow(row)) })
})

workflowRoutes.post('/runs/:id/cancel', (c) => {
  const user = currentUser(c)
  if (!user) return c.json({ ok: false, error: '未登录' }, 401)

  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: '任务号不合法' }, 400)

  const row = getDb().prepare('SELECT id, status FROM workflow_runs WHERE id = ? AND user_id = ?').get(id, user.id) as
    | { id: number; status: RunStatus }
    | undefined
  if (!row) return c.json({ ok: false, error: '任务不存在' }, 404)

  if (!cancelRun(id)) return c.json({ ok: false, error: `任务已是 ${row.status} 状态，无法取消` }, 409)
  return c.json({ ok: true })
})

workflowRoutes.get('/:slug', (c) => {
  const definition = definitionBySlug(c.req.param('slug'))
  if (!definition) return c.json({ ok: false, error: '工作流不存在' }, 404)
  return c.json({ ok: true, workflow: publicWorkflow(definition) })
})

workflowRoutes.post('/:slug/runs', async (c) => {
  const user = currentUser(c)
  if (!user) return c.json({ ok: false, error: '未登录' }, 401)

  const definition = definitionBySlug(c.req.param('slug'))
  if (!definition) return c.json({ ok: false, error: '工作流不存在' }, 404)

  const availability = providerFor(definition.provider)
  if (!availability.available) return c.json({ ok: false, error: availability.reason }, 503)

  const body = await c.req.json().catch(() => ({}))
  const checked = checkParams(definition, (body as { params?: unknown }).params ?? body)
  if (!checked.ok) {
    return c.json({ ok: false, error: '参数校验未通过', fieldErrors: checked.fieldErrors }, 400)
  }

  if (pendingCount(user.id) >= pendingLimit()) {
    return c.json(
      { ok: false, error: `你已有 ${pendingLimit()} 个任务在队列中，等其中一个结束后再提交` },
      429,
    )
  }

  const used = usedCreditsToday(user.id)
  const limit = dailyCreditLimit()
  if (used + definition.costCredits > limit) {
    return c.json(
      { ok: false, error: `今日额度不足：已用 ${used} / ${limit}，本次需要 ${definition.costCredits}` },
      429,
    )
  }

  const db = getDb()
  const result = db
    .prepare(
      `INSERT INTO workflow_runs
         (user_id, workflow_slug, workflow_name, provider, provider_ref, output_kind, cost_credits,
          status, params_json, created_at, client_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
    )
    .run(
      user.id,
      definition.slug,
      definition.name,
      definition.provider,
      definition.providerRef,
      definition.outputKind,
      definition.costCredits,
      JSON.stringify(checked.params),
      nowIso(),
      clientHash(c.req.header('user-agent'), c.req.header('x-forwarded-for')),
    )

  const runId = Number(result.lastInsertRowid)

  recordEvent({
    userId: user.id,
    identity: user.identity,
    action: 'workflow_submit',
    toolId: null,
    toolName: null,
    workflowSlug: definition.slug,
    scene: definition.sceneSlug,
    sourcePage: c.req.header('referer')?.slice(0, 200) ?? 'unknown',
    keyword: null,
    clientHash: clientHash(c.req.header('user-agent'), c.req.header('x-forwarded-for')),
  })

  // 立刻扫一次队列，让用户不必等下一个定时周期才看到任务开始。
  void tick()

  const row = toRunRow(db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(runId))
  return c.json({ ok: true, run: publicRun(row), usingMock: availability.usingMock }, 201)
})
