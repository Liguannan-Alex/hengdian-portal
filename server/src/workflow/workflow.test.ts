/**
 * 工作流编排层测试。
 *
 * 覆盖三件最容易出错、且出错代价最高的事：
 *   1. 参数校验必须逐字段拦住越界与未定义参数（越界参数直接变成算力账单）。
 *   2. 配额与并发上限必须真的拦得住（这是费用的唯一闸门）。
 *   3. 任务从提交到终态要留下完整埋点（PRD 门禁：无埋点不上线）。
 */
// NODE_ENV 必须由 npm test 在进程启动前设好：ESM 的 import 先于本文件的语句执行，
// 在这里赋值来不及阻止 index.ts 监听端口。其余变量都是惰性读取，放这里即可。
process.env.WORKFLOW_ALLOW_MOCK = 'true'
process.env.WORKFLOW_MOCK_DELAY_MS = '0'
process.env.COOKIE_SECURE = 'false'

import assert from 'node:assert/strict'
import test, { after, beforeEach } from 'node:test'
import app from '../index.ts'
import { closeDb, useMemoryDb } from '../db.ts'
import { checkParams } from './params.ts'
import { definitionBySlug, loadDefinitions, syncWorkflows } from './definitions.ts'
import { drain, stopRunner, tick } from './runner.ts'

const CONCEPT = 'concept-still'

async function registerAndLogin(username: string): Promise<string> {
  const response = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: 'portal2026',
      displayName: '测试用户',
      identity: 'crew',
      org: '测试剧组',
    }),
  })
  assert.equal(response.status, 200, await response.text())
  const cookie = response.headers.get('set-cookie')
  assert.ok(cookie, '注册后应下发会话 Cookie')
  return cookie.split(';')[0] ?? cookie
}

function validConceptParams() {
  return {
    sceneDescription: '黄昏的明清宫苑外景，长廊尽头逆光，地面积水倒映屋檐。',
    style: 'cinematic',
    aspectRatio: '16:9',
    count: 2,
  }
}

async function submit(cookie: string, params: Record<string, unknown>, slug = CONCEPT) {
  return app.request(`/api/workflows/${slug}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ params }),
  })
}

/** 响应体只能读一次，断言失败时又想看到原文，所以统一先读成文本再解析。 */
async function readJson<T>(response: Response): Promise<{ status: number; text: string; body: T }> {
  const text = await response.text()
  return { status: response.status, text, body: JSON.parse(text) as T }
}

/**
 * 让演示算力慢下来，用于验证「排队中」相关行为。
 * 不这么做的话 0 延迟会让任务在提交请求返回前就跑完，测不到队列状态。
 */
async function withSlowMock<T>(fn: () => Promise<T>): Promise<T> {
  process.env.WORKFLOW_MOCK_DELAY_MS = '3000'
  try {
    return await fn()
  } finally {
    process.env.WORKFLOW_MOCK_DELAY_MS = '0'
  }
}

beforeEach(() => {
  // 先中断上一条用例可能仍在跑的任务，避免它把结果写进新建的内存库。
  stopRunner()
  useMemoryDb()
  syncWorkflows()
  delete process.env.WORKFLOW_DAILY_CREDITS
  delete process.env.WORKFLOW_PENDING_LIMIT
})

after(() => {
  stopRunner()
  closeDb()
})

test('定义文件可载入且每条工作流都有输入字段', () => {
  const definitions = loadDefinitions(true)
  assert.ok(definitions.length >= 5)
  for (const workflow of definitions) {
    assert.ok(workflow.inputs.length > 0, `${workflow.slug} 缺少输入字段`)
    assert.ok(workflow.costCredits > 0, `${workflow.slug} 的额度必须为正`)
  }
})

test('参数校验逐字段拦截缺失、越界与未定义参数', () => {
  const definition = definitionBySlug(CONCEPT)
  assert.ok(definition)

  const missing = checkParams(definition, { style: 'cinematic' })
  assert.equal(missing.ok, false)
  assert.ok(missing.fieldErrors.sceneDescription)

  const outOfRange = checkParams(definition, { ...validConceptParams(), count: 99 })
  assert.equal(outOfRange.ok, false)
  assert.match(String(outOfRange.fieldErrors.count), /不能大于 4/)

  const badOption = checkParams(definition, { ...validConceptParams(), style: 'not-a-style' })
  assert.equal(badOption.ok, false)
  assert.match(String(badOption.fieldErrors.style), /不在可选范围/)

  const unknownKey = checkParams(definition, { ...validConceptParams(), secretFlag: 'x' })
  assert.equal(unknownKey.ok, false)
  assert.ok(unknownKey.fieldErrors.__form__)

  const ok = checkParams(definition, validConceptParams())
  assert.equal(ok.ok, true)
  assert.equal(ok.params.count, 2)
})

test('参考图链接只接受 http(s)', () => {
  const definition = definitionBySlug(CONCEPT)
  assert.ok(definition)

  const injected = checkParams(definition, {
    ...validConceptParams(),
    referenceUrl: 'javascript:alert(1)',
  })
  assert.equal(injected.ok, false)
  assert.ok(injected.fieldErrors.referenceUrl)

  const accepted = checkParams(definition, {
    ...validConceptParams(),
    referenceUrl: 'https://example.com/a.png',
  })
  assert.equal(accepted.ok, true)
})

test('未登录不能提交任务', async () => {
  const response = await app.request(`/api/workflows/${CONCEPT}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ params: validConceptParams() }),
  })
  assert.equal(response.status, 401)
})

test('提交后任务跑到成功态并带回产出', async () => {
  const cookie = await registerAndLogin('runner_ok')

  const created = await readJson<{ run: { id: number; status: string } }>(
    await submit(cookie, validConceptParams()),
  )
  assert.equal(created.status, 201, created.text)
  // 提交后会立刻扫一次队列，任务可能已被领走，两种状态都算正常。
  assert.ok(['queued', 'running'].includes(created.body.run.status), created.text)

  await tick()
  await drain(5000)

  const detail = await readJson<{
    run: { status: string; outputs: { url?: string }[]; finishedAt: string | null }
  }>(await app.request(`/api/workflows/runs/${created.body.run.id}`, { headers: { cookie } }))
  assert.equal(detail.body.run.status, 'succeeded', detail.text)
  assert.equal(detail.body.run.outputs.length, 2, '出图张数应跟随 count 参数')
  assert.ok(detail.body.run.finishedAt)
})

test('参数不合法时返回逐字段错误且不入队', async () => {
  const cookie = await registerAndLogin('runner_badparam')

  const response = await submit(cookie, { ...validConceptParams(), count: 99 })
  assert.equal(response.status, 400)
  const body = (await response.json()) as { fieldErrors: Record<string, string> }
  assert.ok(body.fieldErrors.count)

  const list = await app.request('/api/workflows/runs', { headers: { cookie } })
  const runs = (await list.json()) as { runs: unknown[] }
  assert.equal(runs.runs.length, 0)
})

test('每日额度用尽后拒绝提交', async () => {
  process.env.WORKFLOW_DAILY_CREDITS = '3'
  const cookie = await registerAndLogin('runner_quota')

  // concept-still 每次 2 点额度，第二次就会越过上限 3。
  const first = await submit(cookie, validConceptParams())
  assert.equal(first.status, 201)
  await tick()
  await drain(5000)

  const second = await submit(cookie, validConceptParams())
  assert.equal(second.status, 429)
  assert.match((await second.text()), /今日额度不足/)
})

test('未完成任务达到上限后拒绝提交', async () => {
  process.env.WORKFLOW_PENDING_LIMIT = '1'
  process.env.WORKFLOW_DAILY_CREDITS = '100'
  const cookie = await registerAndLogin('runner_pending')

  await withSlowMock(async () => {
    const first = await submit(cookie, validConceptParams())
    assert.equal(first.status, 201)
    const second = await submit(cookie, validConceptParams())
    assert.equal(second.status, 429)
    assert.match(await second.text(), /任务在队列中/)
  })
})

test('执行中的任务可以取消，取消后不可重复取消', async () => {
  const cookie = await registerAndLogin('runner_cancel')

  await withSlowMock(async () => {
    const created = await readJson<{ run: { id: number } }>(await submit(cookie, validConceptParams()))
    const runId = created.body.run.id

    const canceled = await app.request(`/api/workflows/runs/${runId}/cancel`, {
      method: 'POST',
      headers: { cookie },
    })
    assert.equal(canceled.status, 200, await canceled.text())

    const again = await app.request(`/api/workflows/runs/${runId}/cancel`, {
      method: 'POST',
      headers: { cookie },
    })
    assert.equal(again.status, 409)

    await tick()
    await drain(2000)
    const detail = await readJson<{ run: { status: string } }>(
      await app.request(`/api/workflows/runs/${runId}`, { headers: { cookie } }),
    )
    assert.equal(detail.body.run.status, 'canceled', '取消后不应被算力返回结果覆盖')
  })
})

test('看不到别人的任务', async () => {
  const owner = await registerAndLogin('runner_owner')
  const stranger = await registerAndLogin('runner_stranger')

  const created = await readJson<{ run: { id: number } }>(await submit(owner, validConceptParams()))

  const peek = await app.request(`/api/workflows/runs/${created.body.run.id}`, {
    headers: { cookie: stranger },
  })
  assert.equal(peek.status, 404)
})

test('工作流埋点计入完整率，且终态由服务端补记', async () => {
  const cookie = await registerAndLogin('runner_events')

  const viewed = await app.request('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ action: 'workflow_view', workflowSlug: CONCEPT, sourcePage: '/workflows' }),
  })
  assert.equal(viewed.status, 200)

  const missingSlug = await app.request('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ action: 'workflow_view', sourcePage: '/workflows' }),
  })
  assert.equal(missingSlug.status, 400, '缺 workflowSlug 的工作流埋点必须被拒收')

  const created = await submit(cookie, validConceptParams())
  assert.equal(created.status, 201)
  await tick()
  await drain(5000)

  const completeness = await readJson<{
    total: number
    complete: number
    completenessPercent: number
    passed: boolean
  }>(
    await app.request('/api/events/completeness?since=1970-01-01T00:00:00.000Z', {
      headers: { cookie },
    }),
  )
  assert.equal(completeness.body.total, completeness.body.complete, '所有工作流事件都应判为字段完整')
  assert.equal(completeness.body.passed, true)
  assert.ok(completeness.body.total >= 3, '应至少包含 view、submit 与 finish 三条')
})

test('工作流列表报告算力可用性', async () => {
  const listed = await readJson<{ workflows: { slug: string; runnable: boolean; usingMock: boolean }[] }>(
    await app.request('/api/workflows'),
  )
  assert.ok(listed.body.workflows.length >= 5)
  assert.ok(listed.body.workflows.every((workflow) => workflow.runnable))
  assert.ok(
    listed.body.workflows.every((workflow) => workflow.usingMock),
    '未配凭据时应回落到演示算力',
  )
})

test('关闭演示算力且无凭据时，工作流不可提交', async () => {
  process.env.WORKFLOW_ALLOW_MOCK = 'false'
  try {
    const cookie = await registerAndLogin('runner_nomock')
    const response = await submit(cookie, validConceptParams())
    assert.equal(response.status, 503)
    assert.match(await response.text(), /算力未接入/)
  } finally {
    process.env.WORKFLOW_ALLOW_MOCK = 'true'
  }
})
