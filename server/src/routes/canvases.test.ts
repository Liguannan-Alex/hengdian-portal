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

  const detail = await json<{ canvas: { name: string }; nodes: unknown[]; edges: unknown[] }>(
    await send(`/api/canvases/${id}`, cookie),
  )
  assert.equal(detail.body.canvas.name, '宫苑外景')
  assert.deepEqual(detail.body.nodes, [])
  assert.deepEqual(detail.body.edges, [])

  const renamed = await send(`/api/canvases/${id}`, cookie, 'PATCH', { name: '改过的名字' })
  assert.equal(renamed.status, 200)

  const listed = await json<{ canvases: { name: string; nodeCount: number }[] }>(
    await send('/api/canvases', cookie),
  )
  assert.equal(listed.body.canvases[0]?.name, '改过的名字')
  assert.equal(listed.body.canvases[0]?.nodeCount, 0)

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
  assert.equal(
    (await send(`/api/canvases/${id}/graph/batch`, stranger, 'POST', { upsertNodes: [] })).status,
    404,
  )

  const listed = await json<{ canvases: unknown[] }>(await send('/api/canvases', stranger))
  assert.deepEqual(listed.body.canvases, [])
})

const NODE = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  type: 'image',
  x: 0,
  y: 0,
  width: 320,
  height: 180,
  data: { url: IMAGE },
  ...extra,
})

test('节点图可批量增删改，并回传权威快照', async () => {
  const cookie = await login('graph_batch')
  const id = await newCanvas(cookie)

  const written = await json<{ nodes: { key: string }[]; edges: { key: string }[] }>(
    await send(`/api/canvases/${id}/graph/batch`, cookie, 'POST', {
      upsertNodes: [NODE('i-aaa11111'), NODE('i-bbb22222', { x: 400 })],
      upsertEdges: [{ key: 'e-ccc33333', source: 'i-aaa11111', target: 'i-bbb22222' }],
    }),
  )
  assert.equal(written.status, 200, written.text)
  assert.equal(written.body.nodes.length, 2)
  assert.equal(written.body.edges.length, 1)

  // 再写一次同样的键：应是更新而不是插入重复。
  const again = await json<{ nodes: { key: string; x: number }[] }>(
    await send(`/api/canvases/${id}/graph/batch`, cookie, 'POST', {
      upsertNodes: [NODE('i-aaa11111', { x: 999 })],
    }),
  )
  assert.equal(again.body.nodes.length, 2)
  assert.equal(again.body.nodes.find((node) => node.key === 'i-aaa11111')?.x, 999)
})

test('删除节点会连带删掉挂在它上面的连线', async () => {
  const cookie = await login('graph_cascade')
  const id = await newCanvas(cookie)

  await send(`/api/canvases/${id}/graph/batch`, cookie, 'POST', {
    upsertNodes: [NODE('i-aaa11111'), NODE('i-bbb22222')],
    upsertEdges: [{ key: 'e-ccc33333', source: 'i-aaa11111', target: 'i-bbb22222' }],
  })

  const after = await json<{ nodes: unknown[]; edges: unknown[] }>(
    await send(`/api/canvases/${id}/graph/batch`, cookie, 'POST', {
      deleteNodeKeys: ['i-aaa11111'],
    }),
  )
  assert.equal(after.body.nodes.length, 1)
  assert.deepEqual(after.body.edges, [], '指向已删节点的连线必须一并清掉')
})

test('节点键、类型与自环都会被拒绝', async () => {
  const cookie = await login('graph_invalid')
  const id = await newCanvas(cookie)

  const badKey = await send(`/api/canvases/${id}/graph/batch`, cookie, 'POST', {
    upsertNodes: [NODE('NOT A KEY')],
  })
  assert.equal(badKey.status, 400)

  const badType = await send(`/api/canvases/${id}/graph/batch`, cookie, 'POST', {
    upsertNodes: [NODE('i-aaa11111', { type: 'hologram' })],
  })
  assert.equal(badType.status, 400)

  const selfLoop = await send(`/api/canvases/${id}/graph/batch`, cookie, 'POST', {
    upsertEdges: [{ key: 'e-ccc33333', source: 'i-aaa11111', target: 'i-aaa11111' }],
  })
  assert.equal(selfLoop.status, 400)
  assert.match(await selfLoop.text(), /不能连到自己/)
})

test('节点里的图片来源只接受 http(s) 与 data:image', async () => {
  const cookie = await login('graph_src')
  const id = await newCanvas(cookie)

  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>x</script>', 'ftp://a/b.png']) {
    const response = await send(`/api/canvases/${id}/graph/batch`, cookie, 'POST', {
      upsertNodes: [NODE('i-aaa11111', { data: { url: bad } })],
    })
    assert.equal(response.status, 400, `应拒绝: ${bad}`)
  }

  for (const good of [IMAGE, 'data:image/svg+xml;utf8,%3Csvg%3E%3C/svg%3E']) {
    const response = await send(`/api/canvases/${id}/graph/batch`, cookie, 'POST', {
      upsertNodes: [NODE('i-aaa11111', { data: { url: good } })],
    })
    assert.equal(response.status, 200, `应接受: ${good.slice(0, 40)}`)
  }
})

test('非法坐标被夹到合法范围，不会写进 NaN', async () => {
  const cookie = await login('graph_geom')
  const id = await newCanvas(cookie)

  const written = await json<{ nodes: { x: number; width: number }[] }>(
    await send(`/api/canvases/${id}/graph/batch`, cookie, 'POST', {
      upsertNodes: [NODE('i-aaa11111', { x: 'abc', width: 999999 })],
    }),
  )
  assert.equal(written.status, 200)
  assert.equal(Number.isFinite(written.body.nodes[0]?.x), true)
  assert.ok((written.body.nodes[0]?.width ?? 0) <= 4000)
})

test('删除画布会连带删除节点与连线', async () => {
  const cookie = await login('graph_delete')
  const id = await newCanvas(cookie)
  await send(`/api/canvases/${id}/graph/batch`, cookie, 'POST', {
    upsertNodes: [NODE('i-aaa11111')],
  })

  await send(`/api/canvases/${id}`, cookie, 'DELETE')

  const rebuilt = await newCanvas(cookie, '新画布')
  const detail = await json<{ nodes: unknown[]; edges: unknown[] }>(
    await send(`/api/canvases/${rebuilt}`, cookie),
  )
  assert.deepEqual(detail.body.nodes, [], '旧画布的节点不应残留')
})

test('批量查任务状态一次拿回多条', async () => {
  const cookie = await login('graph_batchpoll')

  const ids: number[] = []
  for (const prompt of ['第一条', '第二条']) {
    const created = await json<{ run: { id: number } }>(
      await send('/api/workflows/script-outline/runs', cookie, 'POST', {
        params: { logline: `${prompt}：一个群演在剧组失踪的第七天。`, genre: 'suspense', episodes: 6 },
      }),
    )
    assert.equal(created.status, 201, created.text)
    ids.push(created.body.run.id)
  }
  await tick()
  await drain(5000)

  const batch = await json<{ runs: { id: number; status: string }[] }>(
    await send(`/api/workflows/runs/batch?ids=${ids.join(',')}`, cookie),
  )
  assert.equal(batch.body.runs.length, 2)
  assert.ok(batch.body.runs.every((run) => run.status === 'succeeded'))
})

test('批量查任务只返回自己的', async () => {
  const owner = await login('graph_pollowner')
  const stranger = await login('graph_pollstranger')

  const created = await json<{ run: { id: number } }>(
    await send('/api/workflows/script-outline/runs', owner, 'POST', {
      params: { logline: '一个群演在剧组失踪的第七天。', genre: 'suspense', episodes: 6 },
    }),
  )
  const peek = await json<{ runs: unknown[] }>(
    await send(`/api/workflows/runs/batch?ids=${created.body.run.id}`, stranger),
  )
  assert.deepEqual(peek.body.runs, [])
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

  const placed = await json<{ nodes: { key: string; data: { url?: string } }[] }>(
    await send(`/api/canvases/${id}/graph/batch`, cookie, 'POST', {
      upsertNodes: [
        {
          key: 'i-produced1',
          type: 'image',
          x: 0,
          y: 0,
          width: 320,
          height: 180,
          data: { url, action: 'canvas-inpaint', taskInfo: { runId: submitted.body.run.id, status: 'succeeded' } },
        },
      ],
    }),
  )
  assert.equal(placed.status, 200, placed.text)
  assert.equal(placed.body.nodes[0]?.data.url, url, '产出应能落回节点')
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
