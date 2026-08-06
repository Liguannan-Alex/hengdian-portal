/**
 * 画布路由：节点图的读写。
 *
 * 画布不执行任何生成。局部重绘、扩图、生成变体、以及节点上绑定的各类产出动作，
 * 都是 surface=canvas / library 的工作流，走 `/api/workflows/:slug/runs` 那条既有链路——
 * 队列、配额、provider 适配、埋点与周报因此全部复用。画布这里只管
 * 「有哪些节点、怎么连、各自的参数与产出是什么」。
 *
 * 连线拓扑到输入槽位的翻译放在前端：图在前端，谁是谁的上游那里最清楚，
 * 且翻译结果就是最终提交给算力方的 params，仍然要过服务端那套权威校验。
 *
 * 归属与可见性和任务一致：画布上可能贴着剧本分镜，只对自己可见。
 */
import { Hono } from 'hono'
import { getDb, nowIso } from '../db.ts'
import { currentUser } from '../lib/session.ts'

export const canvasRoutes = new Hono()

/** 单人画布数量上限。画布是工作区不是资产库，无限增长只会变成垃圾场。 */
const MAX_CANVASES = 20
/** 单画布节点上限。超过后前端渲染与整图加载都会明显变慢。 */
const MAX_NODES = 200
/** 单画布连线上限。 */
const MAX_EDGES = 400
/** 单节点 data 的 JSON 长度上限。内联图片数据也算在内。 */
const MAX_DATA_LENGTH = 320_000
const MAX_NAME_LENGTH = 40
/** 一次批量写入的最大条目数，防止单请求把库写爆。 */
const MAX_BATCH = 200

/** 节点类型与工作流的 outputKind 同一套口径，避免出现第二份产出形态枚举。 */
const NODE_TYPES = new Set(['image', 'video', 'text'])
const KEY_PATTERN = /^[a-z]-[a-z0-9]{4,32}$/

interface CanvasRow {
  id: number
  user_id: number
  name: string
  created_at: string
  updated_at: string
}

interface NodeRow {
  id: number
  canvas_id: number
  node_key: string
  type: string
  x: number
  y: number
  width: number
  height: number
  z: number
  data: string
  created_at: string
  updated_at: string
}

interface EdgeRow {
  id: number
  canvas_id: number
  edge_key: string
  source_key: string
  target_key: string
  created_at: string
}

/**
 * node:sqlite 的 `SELECT *` 返回宽泛记录类型，无法直接断言成具体行类型。
 * 收窄集中在这两个函数里做，而不是每个查询点各写一遍双重断言。
 */
function asRow<T>(row: unknown): T {
  return row as T
}

function asRows<T>(rows: unknown[]): T[] {
  return rows as T[]
}

function publicNode(row: NodeRow) {
  return {
    key: row.node_key,
    type: row.type,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    z: row.z,
    data: JSON.parse(row.data) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function publicEdge(row: EdgeRow) {
  return { key: row.edge_key, source: row.source_key, target: row.target_key }
}

/**
 * 图片来源校验，与 workflow 参数层同一套规则。
 *
 * 放行 `data:image/` 是因为节点上的图可能是内联生成的；其余协议一律拒绝：
 * 这个字符串会被界面当图片源渲染，`javascript:` 与 `data:text/html` 一旦入库就是注入面。
 */
function invalidSrc(src: string): string | null {
  const text = src.trim()
  if (!text) return '缺少图片来源'
  if (text.startsWith('data:')) {
    return /^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);/i.test(text)
      ? null
      : '只支持图片类型的内联数据'
  }
  try {
    const parsed = new URL(text)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '只支持 http 或 https 链接'
    }
  } catch {
    return '图片来源需为完整链接'
  }
  return null
}

/** 坐标与尺寸都限制在有限范围内：拿到 NaN 或天文数字，前端渲染会直接崩。 */
function num(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

/** 取当前用户的画布；不存在或不属于自己都返回 null，调用方一律回 404。 */
function ownedCanvas(userId: number, canvasId: number): CanvasRow | null {
  const row = getDb()
    .prepare('SELECT * FROM canvases WHERE id = ? AND user_id = ?')
    .get(canvasId, userId)
  return row ? asRow<CanvasRow>(row) : null
}

function touch(canvasId: number): void {
  getDb().prepare('UPDATE canvases SET updated_at = ? WHERE id = ?').run(nowIso(), canvasId)
}

function loadGraph(canvasId: number) {
  const nodes = asRows<NodeRow>(
    getDb().prepare('SELECT * FROM canvas_nodes WHERE canvas_id = ? ORDER BY z, id').all(canvasId),
  )
  const edges = asRows<EdgeRow>(
    getDb().prepare('SELECT * FROM canvas_edges WHERE canvas_id = ? ORDER BY id').all(canvasId),
  )
  return { nodes: nodes.map(publicNode), edges: edges.map(publicEdge) }
}

// ── 画布本身 ────────────────────────────────────────────────────

canvasRoutes.get('/', (c) => {
  const user = currentUser(c)
  if (!user) return c.json({ ok: false, error: '未登录' }, 401)

  const rows = asRows<CanvasRow>(
    getDb().prepare('SELECT * FROM canvases WHERE user_id = ? ORDER BY updated_at DESC').all(user.id),
  )

  const countStmt = getDb().prepare('SELECT COUNT(*) AS n FROM canvas_nodes WHERE canvas_id = ?')
  // 预览图取最上层那个带图的节点：文本节点没有可展示的封面。
  const previewStmt = getDb().prepare(
    `SELECT data FROM canvas_nodes
     WHERE canvas_id = ? AND type IN ('image','video') AND data LIKE '%"url"%'
     ORDER BY z DESC, id DESC LIMIT 1`,
  )

  return c.json({
    ok: true,
    canvases: rows.map((row) => {
      const preview = previewStmt.get(row.id) as { data: string } | undefined
      let previewSrc: string | null = null
      if (preview) {
        const parsed = JSON.parse(preview.data) as { url?: unknown }
        if (typeof parsed.url === 'string') previewSrc = parsed.url
      }
      return {
        id: row.id,
        name: row.name,
        nodeCount: (countStmt.get(row.id) as { n: number }).n,
        previewSrc,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    }),
    limit: MAX_CANVASES,
  })
})

canvasRoutes.post('/', async (c) => {
  const user = currentUser(c)
  if (!user) return c.json({ ok: false, error: '未登录' }, 401)

  const count = (
    getDb().prepare('SELECT COUNT(*) AS n FROM canvases WHERE user_id = ?').get(user.id) as {
      n: number
    }
  ).n
  if (count >= MAX_CANVASES) {
    return c.json({ ok: false, error: `画布数量已达上限 ${MAX_CANVASES}，请先删除不用的画布` }, 429)
  }

  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown }
  const name =
    typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, MAX_NAME_LENGTH)
      : `未命名画布 ${count + 1}`

  const result = getDb()
    .prepare('INSERT INTO canvases (user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(user.id, name, nowIso(), nowIso())

  const row = asRow<CanvasRow>(
    getDb().prepare('SELECT * FROM canvases WHERE id = ?').get(Number(result.lastInsertRowid)),
  )
  return c.json(
    { ok: true, canvas: { id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at } },
    201,
  )
})

canvasRoutes.get('/:id', (c) => {
  const user = currentUser(c)
  if (!user) return c.json({ ok: false, error: '未登录' }, 401)

  const canvas = ownedCanvas(user.id, Number(c.req.param('id')))
  if (!canvas) return c.json({ ok: false, error: '画布不存在' }, 404)

  return c.json({
    ok: true,
    canvas: {
      id: canvas.id,
      name: canvas.name,
      createdAt: canvas.created_at,
      updatedAt: canvas.updated_at,
    },
    ...loadGraph(canvas.id),
    limits: { maxNodes: MAX_NODES, maxEdges: MAX_EDGES },
  })
})

canvasRoutes.patch('/:id', async (c) => {
  const user = currentUser(c)
  if (!user) return c.json({ ok: false, error: '未登录' }, 401)

  const canvas = ownedCanvas(user.id, Number(c.req.param('id')))
  if (!canvas) return c.json({ ok: false, error: '画布不存在' }, 404)

  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown }
  if (typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ ok: false, error: '画布名称不能为空' }, 400)
  }

  const name = body.name.trim().slice(0, MAX_NAME_LENGTH)
  getDb().prepare('UPDATE canvases SET name = ?, updated_at = ? WHERE id = ?').run(name, nowIso(), canvas.id)
  return c.json({ ok: true, canvas: { id: canvas.id, name } })
})

canvasRoutes.delete('/:id', (c) => {
  const user = currentUser(c)
  if (!user) return c.json({ ok: false, error: '未登录' }, 401)

  const canvas = ownedCanvas(user.id, Number(c.req.param('id')))
  if (!canvas) return c.json({ ok: false, error: '画布不存在' }, 404)

  // canvas_nodes / canvas_edges 都有 ON DELETE CASCADE，且 db.ts 打开了 foreign_keys。
  getDb().prepare('DELETE FROM canvases WHERE id = ?').run(canvas.id)
  return c.json({ ok: true })
})

// ── 节点图 ──────────────────────────────────────────────────────

canvasRoutes.get('/:id/graph', (c) => {
  const user = currentUser(c)
  if (!user) return c.json({ ok: false, error: '未登录' }, 401)

  const canvas = ownedCanvas(user.id, Number(c.req.param('id')))
  if (!canvas) return c.json({ ok: false, error: '画布不存在' }, 404)

  return c.json({ ok: true, ...loadGraph(canvas.id) })
})

interface NodeInput {
  key?: unknown
  type?: unknown
  x?: unknown
  y?: unknown
  width?: unknown
  height?: unknown
  z?: unknown
  data?: unknown
}

interface NormalizedNode {
  key: string
  type: string
  x: number
  y: number
  width: number
  height: number
  z: number
  /** 已序列化的 data，直接写库。 */
  data: string
}

/** 校验并归一化一个待写入的节点，返回错误文案或归一化结果。 */
function normalizeNode(input: NodeInput): { error: string } | { value: NormalizedNode } {
  if (typeof input.key !== 'string' || !KEY_PATTERN.test(input.key)) {
    return { error: `节点键不合法：${String(input.key)}` }
  }
  if (typeof input.type !== 'string' || !NODE_TYPES.has(input.type)) {
    return { error: `节点类型不合法：${String(input.type)}` }
  }
  if (!input.data || typeof input.data !== 'object' || Array.isArray(input.data)) {
    return { error: `节点 ${input.key} 的 data 需为对象` }
  }

  const data = input.data as Record<string, unknown>
  if (data.url !== undefined) {
    if (typeof data.url !== 'string') return { error: `节点 ${input.key} 的 url 需为字符串` }
    const srcError = invalidSrc(data.url)
    if (srcError) return { error: `节点 ${input.key}：${srcError}` }
  }

  const serialized = JSON.stringify(data)
  if (serialized.length > MAX_DATA_LENGTH) {
    return { error: `节点 ${input.key} 的数据过大（上限 ${MAX_DATA_LENGTH} 字符）` }
  }

  return {
    value: {
      key: input.key,
      type: input.type,
      x: num(input.x, 0, -200_000, 200_000),
      y: num(input.y, 0, -200_000, 200_000),
      width: num(input.width, 320, 80, 4000),
      height: num(input.height, 240, 80, 4000),
      z: Math.trunc(num(input.z, 0, -10_000, 10_000)),
      data: serialized,
    },
  }
}

/**
 * 批量增删改。
 *
 * 画布上一次拖动就可能改动多个节点，逐个发请求既慢又容易写出交错状态；
 * 前端把变更聚合后一次打过来，这里在一个事务里落库。
 */
canvasRoutes.post('/:id/graph/batch', async (c) => {
  const user = currentUser(c)
  if (!user) return c.json({ ok: false, error: '未登录' }, 401)

  const canvas = ownedCanvas(user.id, Number(c.req.param('id')))
  if (!canvas) return c.json({ ok: false, error: '画布不存在' }, 404)

  const body = (await c.req.json().catch(() => ({}))) as {
    upsertNodes?: unknown
    deleteNodeKeys?: unknown
    upsertEdges?: unknown
    deleteEdgeKeys?: unknown
  }

  const upsertNodes = Array.isArray(body.upsertNodes) ? body.upsertNodes : []
  const deleteNodeKeys = Array.isArray(body.deleteNodeKeys) ? body.deleteNodeKeys : []
  const upsertEdges = Array.isArray(body.upsertEdges) ? body.upsertEdges : []
  const deleteEdgeKeys = Array.isArray(body.deleteEdgeKeys) ? body.deleteEdgeKeys : []

  if (
    upsertNodes.length > MAX_BATCH ||
    deleteNodeKeys.length > MAX_BATCH ||
    upsertEdges.length > MAX_BATCH ||
    deleteEdgeKeys.length > MAX_BATCH
  ) {
    return c.json({ ok: false, error: `单次批量操作上限 ${MAX_BATCH} 条` }, 400)
  }

  const normalized: NormalizedNode[] = []
  for (const raw of upsertNodes) {
    const result = normalizeNode(raw as NodeInput)
    if ('error' in result) return c.json({ ok: false, error: result.error }, 400)
    normalized.push(result.value)
  }

  const edges: { key: string; source: string; target: string }[] = []
  for (const raw of upsertEdges) {
    const edge = raw as { key?: unknown; source?: unknown; target?: unknown }
    if (typeof edge.key !== 'string' || !KEY_PATTERN.test(edge.key)) {
      return c.json({ ok: false, error: `连线键不合法：${String(edge.key)}` }, 400)
    }
    if (typeof edge.source !== 'string' || typeof edge.target !== 'string') {
      return c.json({ ok: false, error: `连线 ${edge.key} 缺少两端` }, 400)
    }
    // 自环没有语义，且会让脏标记传播陷入死循环。
    if (edge.source === edge.target) {
      return c.json({ ok: false, error: '节点不能连到自己' }, 400)
    }
    edges.push({ key: edge.key, source: edge.source, target: edge.target })
  }

  const db = getDb()
  const nodeCount = (
    db.prepare('SELECT COUNT(*) AS n FROM canvas_nodes WHERE canvas_id = ?').get(canvas.id) as { n: number }
  ).n
  const edgeCount = (
    db.prepare('SELECT COUNT(*) AS n FROM canvas_edges WHERE canvas_id = ?').get(canvas.id) as { n: number }
  ).n

  // 粗略上界：把新增全算作净增，宁可早一点拦住也不要写超。
  if (nodeCount + normalized.length - deleteNodeKeys.length > MAX_NODES) {
    return c.json({ ok: false, error: `本画布节点已达上限 ${MAX_NODES} 个` }, 429)
  }
  if (edgeCount + edges.length - deleteEdgeKeys.length > MAX_EDGES) {
    return c.json({ ok: false, error: `本画布连线已达上限 ${MAX_EDGES} 条` }, 429)
  }

  const upsertNode = db.prepare(
    `INSERT INTO canvas_nodes
       (canvas_id, node_key, type, x, y, width, height, z, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(canvas_id, node_key) DO UPDATE SET
       type = excluded.type, x = excluded.x, y = excluded.y,
       width = excluded.width, height = excluded.height, z = excluded.z,
       data = excluded.data, updated_at = excluded.updated_at`,
  )
  const deleteNode = db.prepare('DELETE FROM canvas_nodes WHERE canvas_id = ? AND node_key = ?')
  // 删节点时把挂在它上面的连线一并删掉，否则图里会留下指向不存在节点的边。
  const deleteNodeEdges = db.prepare(
    'DELETE FROM canvas_edges WHERE canvas_id = ? AND (source_key = ? OR target_key = ?)',
  )
  const upsertEdge = db.prepare(
    `INSERT INTO canvas_edges (canvas_id, edge_key, source_key, target_key, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(canvas_id, edge_key) DO UPDATE SET
       source_key = excluded.source_key, target_key = excluded.target_key`,
  )
  const deleteEdge = db.prepare('DELETE FROM canvas_edges WHERE canvas_id = ? AND edge_key = ?')

  db.exec('BEGIN')
  try {
    const now = nowIso()
    for (const node of normalized) {
      upsertNode.run(
        canvas.id,
        node.key,
        node.type,
        node.x,
        node.y,
        node.width,
        node.height,
        node.z,
        node.data,
        now,
        now,
      )
    }
    for (const key of deleteNodeKeys) {
      if (typeof key !== 'string') continue
      deleteNodeEdges.run(canvas.id, key, key)
      deleteNode.run(canvas.id, key)
    }
    for (const edge of edges) {
      upsertEdge.run(canvas.id, edge.key, edge.source, edge.target, now)
    }
    for (const key of deleteEdgeKeys) {
      if (typeof key !== 'string') continue
      deleteEdge.run(canvas.id, key)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  touch(canvas.id)

  // 回传整图：批量写入后前端需要一个权威快照来对齐，省得自己推算最终状态。
  return c.json({ ok: true, ...loadGraph(canvas.id) })
})
