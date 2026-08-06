/**
 * 工作流任务队列。
 *
 * 为什么是进程内队列而不是 Redis/BullMQ：本期规模是 PRD 里的 50 人量级，
 * 队列深度以十为单位，引入独立中间件会多一个要运维的部件。任务状态全部
 * 落在 SQLite，进程重启不丢单——这是「不用外部队列」的前提。
 *
 * 并发上限存在的原因是成本：每个在跑的任务都对应第三方算力的计费，
 * 不设上限时一次误操作就能把额度打空。
 */
import { getDb, nowIso, TERMINAL_RUN_STATUSES, type RunStatus } from '../db.ts'
import { recordEvent } from '../routes/events.ts'
import { definitionBySlug } from './definitions.ts'
import { providerFor } from './providers/index.ts'
import type { ProviderJobRequest, ProviderOutput } from './providers/types.ts'

export interface RunRow {
  id: number
  user_id: number
  workflow_slug: string
  workflow_name: string
  provider: string
  provider_ref: string
  output_kind: 'image' | 'video' | 'text'
  cost_credits: number
  status: RunStatus
  params_json: string
  provider_job_id: string | null
  outputs_json: string | null
  error: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  heartbeat_at: string | null
  attempts: number
  client_hash: string | null
}

/**
 * node:sqlite 的 `SELECT *` 返回宽泛的记录类型，无法直接断言成 RunRow。
 * 收窄集中在这里做一次，而不是在每个查询点各写一遍双重断言。
 */
export function toRunRow(row: unknown): RunRow {
  return row as RunRow
}

export function toRunRows(rows: unknown[]): RunRow[] {
  return rows as RunRow[]
}

function intEnv(name: string, fallback: number, max: number): number {
  const raw = Number(process.env[name])
  if (!Number.isFinite(raw) || raw <= 0) return fallback
  return Math.min(Math.floor(raw), max)
}

/** 同时在跑的任务数上限。 */
const concurrency = () => intEnv('WORKFLOW_CONCURRENCY', 2, 16)
/** 单个任务从开始到出结果的最长时间，超过判失败，避免占住并发位。 */
const runTimeoutMs = () => intEnv('WORKFLOW_RUN_TIMEOUT_SECONDS', 600, 3600) * 1000
/** 轮询第三方作业状态的间隔。 */
const pollIntervalMs = () => intEnv('WORKFLOW_POLL_INTERVAL_SECONDS', 5, 120) * 1000
/** 队列扫描间隔。 */
const tickIntervalMs = () => intEnv('WORKFLOW_TICK_INTERVAL_SECONDS', 2, 60) * 1000
/** 心跳超过这个时长的 running 任务视为僵死，重新排队。 */
const staleAfterMs = () => runTimeoutMs() + 60_000

const inFlight = new Map<number, AbortController>()
let timer: ReturnType<typeof setInterval> | null = null
let ticking = false

export function runningCount(): number {
  return inFlight.size
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timeout)
      reject(new Error('任务已取消'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function finish(run: RunRow, status: RunStatus, outputs: ProviderOutput[] | null, error: string | null): void {
  getDb()
    .prepare(
      `UPDATE workflow_runs
         SET status = ?, outputs_json = ?, error = ?, finished_at = ?, heartbeat_at = NULL
       WHERE id = ? AND status NOT IN ('succeeded','failed','canceled')`,
    )
    .run(status, outputs ? JSON.stringify(outputs) : null, error, nowIso(), run.id)

  // 终态同时进埋点，周报才能算出工作流成功率；sourcePage 记 server 表示由服务端补记。
  recordEvent({
    userId: run.user_id,
    identity: identityOf(run.user_id),
    action: 'workflow_finish',
    toolId: null,
    toolName: null,
    workflowSlug: run.workflow_slug,
    scene: null,
    sourcePage: 'server',
    keyword: status,
    clientHash: run.client_hash ?? 'server',
  })
}

function identityOf(userId: number): string {
  const row = getDb().prepare('SELECT identity FROM users WHERE id = ?').get(userId) as
    | { identity: string }
    | undefined
  return row?.identity ?? 'anonymous'
}

function heartbeat(runId: number): void {
  getDb().prepare('UPDATE workflow_runs SET heartbeat_at = ? WHERE id = ?').run(nowIso(), runId)
}

async function execute(run: RunRow): Promise<void> {
  const controller = new AbortController()
  inFlight.set(run.id, controller)

  const definition = definitionBySlug(run.workflow_slug)
  const availability = providerFor(run.provider)

  try {
    if (!definition) {
      finish(run, 'failed', null, '该工作流的定义已下线，无法执行')
      return
    }
    if (!availability.available) {
      finish(run, 'failed', null, availability.reason)
      return
    }

    const request: ProviderJobRequest = {
      runId: run.id,
      providerRef: run.provider_ref,
      outputKind: run.output_kind,
      params: JSON.parse(run.params_json) as Record<string, string | number | boolean>,
      signal: controller.signal,
    }

    const deadline = Date.now() + runTimeoutMs()
    let result = run.provider_job_id
      ? await availability.provider.poll(run.provider_job_id, request)
      : await availability.provider.submit(request)

    if (result.state === 'pending') {
      getDb()
        .prepare('UPDATE workflow_runs SET provider_job_id = ? WHERE id = ?')
        .run(result.providerJobId, run.id)
    }

    while (result.state === 'pending') {
      if (Date.now() > deadline) {
        finish(run, 'failed', null, '等待算力方返回超时')
        return
      }
      await sleep(pollIntervalMs(), controller.signal)
      heartbeat(run.id)
      result = await availability.provider.poll(result.providerJobId, request)
    }

    if (result.state === 'succeeded') {
      finish(run, 'succeeded', result.outputs, null)
    } else {
      finish(run, 'failed', null, result.error)
    }
  } catch (error) {
    if (controller.signal.aborted) {
      // 取消由 cancelRun 写入终态，这里不再覆盖。
      return
    }
    console.error(`[workflow] 任务 ${run.id} 异常`, error)
    finish(run, 'failed', null, `执行异常：${(error as Error).message}`)
  } finally {
    inFlight.delete(run.id)
  }
}

/**
 * 领取一条排队任务。
 *
 * 用带状态条件的 UPDATE 而不是先查后改：即便将来同进程多处调用 tick，
 * 也只有一次 UPDATE 能把 queued 改成 running，不会重复派单。
 */
function claimNext(): RunRow | null {
  const db = getDb()
  const candidate = db
    .prepare(`SELECT id FROM workflow_runs WHERE status = 'queued' ORDER BY created_at LIMIT 1`)
    .get() as { id: number } | undefined
  if (!candidate) return null

  const claimed = db
    .prepare(
      `UPDATE workflow_runs
         SET status = 'running', started_at = COALESCE(started_at, ?), heartbeat_at = ?, attempts = attempts + 1
       WHERE id = ? AND status = 'queued'`,
    )
    .run(nowIso(), nowIso(), candidate.id)
  if (claimed.changes === 0) return null

  return toRunRow(db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(candidate.id))
}

/**
 * 把僵死任务放回队列。
 *
 * 进程被 kill 时正在跑的任务会永远停在 running。已经拿到算力方作业号的
 * 可以接着轮询，没拿到的重新提交。
 */
export function requeueStaleRuns(): number {
  const cutoff = new Date(Date.now() - staleAfterMs()).toISOString()
  const result = getDb()
    .prepare(
      `UPDATE workflow_runs SET status = 'queued', heartbeat_at = NULL
       WHERE status = 'running' AND (heartbeat_at IS NULL OR heartbeat_at < ?)`,
    )
    .run(cutoff)
  return Number(result.changes)
}

export function cancelRun(runId: number): boolean {
  const db = getDb()
  const result = db
    .prepare(
      `UPDATE workflow_runs
         SET status = 'canceled', finished_at = ?, heartbeat_at = NULL, error = '用户取消'
       WHERE id = ? AND status IN ('queued','running')`,
    )
    .run(nowIso(), runId)
  if (result.changes === 0) return false

  inFlight.get(runId)?.abort()
  inFlight.delete(runId)

  const run = toRunRow(db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(runId))
  recordEvent({
    userId: run.user_id,
    identity: identityOf(run.user_id),
    action: 'workflow_finish',
    toolId: null,
    toolName: null,
    workflowSlug: run.workflow_slug,
    scene: null,
    sourcePage: 'server',
    keyword: 'canceled',
    clientHash: run.client_hash ?? 'server',
  })
  return true
}

/** 扫描一次队列。导出供测试直接驱动，不必等定时器。 */
export async function tick(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    const started: Promise<void>[] = []
    while (inFlight.size < concurrency()) {
      const run = claimNext()
      if (!run) break
      started.push(execute(run))
    }
    // 不 await：任务可能跑几分钟，扫描本身必须立刻返回。
    void Promise.allSettled(started)
  } finally {
    ticking = false
  }
}

/** 等待当前所有在跑任务结束。仅供测试与优雅退出使用。 */
export async function drain(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (inFlight.size > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

export function startRunner(): void {
  if (timer) return
  const requeued = requeueStaleRuns()
  if (requeued > 0) console.log(`[workflow] 重新排队 ${requeued} 条中断的任务`)

  timer = setInterval(() => {
    void tick().catch((error) => console.error('[workflow] 队列扫描异常', error))
  }, tickIntervalMs())
  // 队列扫描不应拖住进程退出。
  timer.unref?.()
  void tick()
}

export function stopRunner(): void {
  if (timer) clearInterval(timer)
  timer = null
  for (const controller of inFlight.values()) controller.abort()
  inFlight.clear()
}

export { TERMINAL_RUN_STATUSES }
