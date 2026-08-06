/**
 * 画布路由测试。
 *
 * 重点在三件事：归属隔离（画布上可能有剧本分镜，不能跨用户可见）、
 * 图片来源的协议白名单（入库的字符串会被界面当图片源渲染），
 * 以及画布操作与工作流那条链路的衔接。
 */
process.env.WORKFLOW_ALLOW_MOCK = 'true'
process.env.WORKFLOW_MOCK_DELAY_MS = '0'
process.env.COOKIE_SECURE = 'false'

import assert from 'node:assert/strict'
import test, { after, beforeEach } from 'node:test'
import app from '../index.ts'
import { closeDb, useMemoryDb } from '../db.ts'
import { syncWorkflows } from '../workflow/definitions.ts'
import { drain, stopRunner, tick } from '../workflow/runner.ts'

async function login(username: string): Promise<string> {
  const response = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: 'portal2026',
      displayName: '测试用户',
      identity: 'crew',
    }),
  })
  assert.equal(response.status, 200, await response.text())
  const cookie = response.headers.get('set-cookie')
  assert.ok(cookie)
  return cookie.split(';')[0] ?? cookie
}

async function json<T>(response: Response): Promise<{ status: number; text: string; body: T }> {
  const text = await response.text()
  return { status: response.status, text, body: JSON.parse(text) as T }
}

const send = (path: string, cookie: string, method = 'GET', body?: unknown) =>
  app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

async function newCanvas(cookie: string, name = '测试画布'): Promise<number> {
  const created = await json<{ canvas: { id: number } }>(await send('/api/canvases', cookie, 'POST', { name }))
  assert.equal(created.status, 201, created.text)
  return created.body.canvas.id
}

const IMAGE = 'https://example.com/a.png'

beforeEach(() => {
  stopRunner()
  useMemoryDb()
  syncWorkflows()
})

after(() => {
  stopRunner()
  closeDb()
})

test('未登录不能访问画布', async () => {
  const response = await app.request('/api/canvases')
  assert.equal(response.status, 401)
})

test('画布可新建、改名、读取与删除', async () => {
  const cookie = await login('canvas_crud')
  const id = await newCanvas(cookie, '宫苑外景')

  const detail = await json<{ canvas: { name: string }; items: unknown[] }>(
    await send(`/api/canvases/${id}`, cookie),
  )
  assert.equal(detail.body.canvas.name, '宫苑外景')
  assert.deepEqual(detail.body.items, [])

  const renamed = await send(`/api/canvases/${id}`, cookie, 'PATCH', { name: '改过的名字' })
  assert.equal(renamed.status, 200)

  const listed = await json<{ canvases: { name: string; itemCount: number }[] }>(
    await send('/api/canvases', cookie),
  )
  assert.equal(listed.body.canvases[0]?.name, '改过的名字')
  assert.equal(listed.body.canvases[0]?.itemCount, 0)

  assert.equal((await send(`/api/canvases/${id}`, cookie, 'DELETE')).status, 200)
  assert.equal((await send(`/api/canvases/${id}`, cookie)).status, 404)
})

test('空名称改名会被拒绝', async () => {
  const cookie = await login('canvas_rename')
  const id = await newCanvas(cookie)
  const response = await send(`/api/canvases/${id}`, cookie, 'PATCH', { name: '   ' })
  assert.equal(response.status, 400)
})

test('看不到别人的画布', async () => {
  const owner = await login('canvas_owner')
  const stranger = await login('canvas_stranger')
  const id = await newCanvas(owner)

  assert.equal((await send(`/api/canvases/${id}`, stranger)).status, 404)
  assert.equal((await send(`/api/canvases/${id}`, stranger, 'DELETE')).status, 404)
  assert.equal((await send(`/api/canvases/${id}/items`, stranger, 'POST', { src: IMAGE })).status, 404)

  const listed = await json<{ canvases: unknown[] }>(await send('/api/canvases', stranger))
  assert.deepEqual(listed.body.canvases, [])
})

test('图片来源只接受 http(s) 与 data:image', async () => {
  const cookie = await login('canvas_src')
  const id = await newCanvas(cookie)

  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>x</script>', 'ftp://a/b.png', '']) {
    const response = await send(`/api/canvases/${id}/items`, cookie, 'POST', { src: bad })
    assert.equal(response.status, 400, `应拒绝: ${bad}`)
  }

  for (const good of [IMAGE, 'data:image/svg+xml;utf8,%3Csvg%3E%3C/svg%3E']) {
    const response = await send(`/api/canvases/${id}/items`, cookie, 'POST', { src: good })
    assert.equal(response.status, 201, `应接受: ${good.slice(0, 40)}`)
  }
})

test('条目可增、可改几何、可删，且 src 不可改', async () => {
  const cookie = await login('canvas_items')
  const id = await newCanvas(cookie)

  const created = await json<{ item: { id: number; x: number; z: number; src: string } }>(
    await send(`/api/canvases/${id}/items`, cookie, 'POST', {
      src: IMAGE,
      x: 10,
      y: 20,
      width: 300,
      height: 200,
    }),
  )
  assert.equal(created.status, 201, created.text)
  const itemId = created.body.item.id

  const moved = await json<{ item: { x: number; y: number; src: string } }>(
    await send(`/api/canvases/${id}/items/${itemId}`, cookie, 'PATCH', {
      x: 99,
      src: 'https://evil.example.com/x.png',
    }),
  )
  assert.equal(moved.body.item.x, 99)
  assert.equal(moved.body.item.src, IMAGE, 'src 不应被 PATCH 改写')

  assert.equal((await send(`/api/canvases/${id}/items/${itemId}`, cookie, 'DELETE')).status, 200)
  assert.equal((await send(`/api/canvases/${id}/items/${itemId}`, cookie, 'DELETE')).status, 404)
})

test('非法坐标被夹到合法范围，不会写进 NaN', async () => {
  const cookie = await login('canvas_geom')
  const id = await newCanvas(cookie)

  const created = await json<{ item: { x: number; width: number } }>(
    await send(`/api/canvases/${id}/items`, cookie, 'POST', {
      src: IMAGE,
      x: 'abc',
      y: 0,
      width: 999999,
      height: 100,
    }),
  )
  assert.equal(created.status, 201)
  assert.equal(Number.isFinite(created.body.item.x), true)
  assert.ok(created.body.item.width <= 8000)
})

test('删除画布会连带删除其上的图', async () => {
  const cookie = await login('canvas_cascade')
  const id = await newCanvas(cookie)
  await send(`/api/canvases/${id}/items`, cookie, 'POST', { src: IMAGE })

  await send(`/api/canvases/${id}`, cookie, 'DELETE')

  const rebuilt = await newCanvas(cookie, '新画布')
  const detail = await json<{ items: unknown[] }>(await send(`/api/canvases/${rebuilt}`, cookie))
  assert.deepEqual(detail.body.items, [], '旧画布的图不应残留')
})

test('画布操作走的是工作流那条链路，产出可放回画布', async () => {
  const cookie = await login('canvas_op')
  const id = await newCanvas(cookie)

  const submitted = await json<{ run: { id: number } }>(
    await send('/api/workflows/canvas-inpaint/runs', cookie, 'POST', {
      params: {
        sourceUrl: IMAGE,
        prompt: '把天空换成黄昏',
        regionX: 10,
        regionY: 10,
        regionW: 40,
        regionH: 30,
      },
    }),
  )
  assert.equal(submitted.status, 201, submitted.text)

  await tick()
  await drain(5000)

  const run = await json<{ run: { status: string; outputs: { url?: string }[] } }>(
    await send(`/api/workflows/runs/${submitted.body.run.id}`, cookie),
  )
  assert.equal(run.body.run.status, 'succeeded', run.text)
  const url = run.body.run.outputs[0]?.url
  assert.ok(url)

  const placed = await json<{ item: { sourceRunId: number | null } }>(
    await send(`/api/canvases/${id}/items`, cookie, 'POST', {
      src: url,
      x: 0,
      y: 0,
      width: 360,
      height: 203,
      sourceRunId: submitted.body.run.id,
    }),
  )
  assert.equal(placed.status, 201, placed.text)
  assert.equal(placed.body.item.sourceRunId, submitted.body.run.id, '产出应可回溯到任务')
})

test('局部重绘缺选区参数会被逐字段拒绝', async () => {
  const cookie = await login('canvas_noregion')
  const response = await json<{ fieldErrors: Record<string, string> }>(
    await send('/api/workflows/canvas-inpaint/runs', cookie, 'POST', {
      params: { sourceUrl: IMAGE, prompt: '改一下' },
    }),
  )
  assert.equal(response.status, 400)
  assert.ok(response.body.fieldErrors.regionW, '缺选区宽度应报到具体字段')
})

test('画布操作不出现在工作流列表里', async () => {
  const listed = await json<{ workflows: { slug: string }[] }>(await app.request('/api/workflows'))
  const slugs = listed.body.workflows.map((workflow) => workflow.slug)
  assert.ok(slugs.includes('concept-still'))
  assert.ok(!slugs.includes('canvas-inpaint'), '画布操作不应进列表页')
})

test('可显式索取画布操作的可用性', async () => {
  const canvasOnly = await json<{ workflows: { slug: string; runnable: boolean }[] }>(
    await app.request('/api/workflows?surface=canvas'),
  )
  const slugs = canvasOnly.body.workflows.map((workflow) => workflow.slug)
  assert.ok(slugs.includes('canvas-inpaint'))
  assert.ok(!slugs.includes('concept-still'))

  const all = await json<{ workflows: unknown[] }>(await app.request('/api/workflows?surface=all'))
  assert.ok(all.body.workflows.length > canvasOnly.body.workflows.length)

  const bad = await app.request('/api/workflows?surface=nope')
  assert.equal(bad.status, 400)
})
