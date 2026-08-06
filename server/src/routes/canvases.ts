/**
 * 画布路由：画布本身与画布上的图。
 *
 * 画布不执行任何生成。局部重绘、扩图、生成变体都是 surface=canvas 的工作流，
 * 走 `/api/workflows/:slug/runs` 那条既有链路——队列、配额、provider 适配、
 * 埋点与周报因此全部复用，不需要为画布再造一套。画布这里只管「图摆在哪」。
 *
 * 归属与可见性和任务一致：画布上可能贴着剧本分镜，只对自己可见。
 */
import { Hono } from 'hono'
import { getDb, nowIso } from '../db.ts'
import { currentUser } from '../lib/session.ts'

export const canvasRoutes = new Hono()

/** 单人画布数量上限。画布是工作区不是资产库，无限增长只会变成垃圾场。 */
const MAX_CANVASES = 20
/** 单画布图片数量上限。超过后前端渲染与整画布加载都会明显变慢。 */
const MAX_ITEMS = 120
/** 图片来源字符串长度上限，与 workflows.json 里 sourceUrl 的 maxLength 一致。 */
const MAX_SRC_LENGTH = 300_000
const MAX_NAME_LENGTH = 40

interface CanvasRow {
  id: number
  user_id: number
  name: string
  created_at: string
  updated_at: string
}

interface ItemRow {
  id: number
  canvas_id: number
  src: string
  label: string | null
  x: number
  y: number
  width: number
  height: number
  z: number
  source_run_id: number | null
  source_item_id: number | null
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

function publicItem(row: ItemRow) {
  return {
    id: row.id,
    src: row.src,
    label: row.label,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    z: row.z,
    sourceRunId: row.source_run_id,
    sourceItemId: row.source_item_id,
    createdAt: row.created_at,
  }
}

/**
 * 图片来源校验，与 workflow 参数层同一套规则。
 * 放行 `data:image/` 是因为画布上的图可能是内联生成的；其余协议一律拒绝。
 */
function invalidSrc(src: unknown): string | null {
  if (typeof src !== 'string' || !src.trim()) return '缺少图片来源'
  const text = src.trim()
  if (text.length > MAX_SRC_LENGTH) return `图片来源过长（上限 ${MAX_SRC_LENGTH} 字符）`
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

canvasRoutes.get('/', (c) => {
  const user = currentUser(c)
  if (!user) return c.json({ ok: false, error: '未登录' }, 401)

  const rows = asRows<CanvasRow>(
    getDb().prepare('SELECT * FROM canvases WHERE user_id = ? ORDER BY updated_at DESC').all(user.id),
  )

  const countStmt = getDb().prepare('SELECT COUNT(*) AS n FROM canvas_items WHERE canvas_id = ?')
  const previewStmt = getDb().prepare(
    'SELECT src FROM canvas_items WHERE canvas_id = ? ORDER BY z DESC, id DESC LIMIT 1',
  )

  return c.json({
    ok: true,
    canvases: rows.map((row) => ({
      id: row.id,
      name: row.name,
      itemCount: (countStmt.get(row.id) as { n: number }).n,
      previewSrc: (previewStmt.get(row.id) as { src: string } | undefined)?.src ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
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
  return c.json({ ok: true, canvas: { id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at } }, 201)
})

canvasRoutes.get('/:id', (c) => {
  const user = currentUser(c)
  if (!user) return c.json({ ok: false, error: '未登录' }, 401)

  const canvas = ownedCanvas(user.id, Number(c.req.param('id')))
  if (!canvas) return c.json({ ok: false, error: '画布不存在' }, 404)

  const items = asRows<ItemRow>(
    getDb().prepare('SELECT * FROM canvas_items WHERE canvas_id = ? ORDER BY z, id').all(canvas.id),
  )

  return c.json({
    ok: true,
    canvas: { id: canvas.id, name: canvas.name, createdAt: canvas.created_at, updatedAt: canvas.updated_at },
    items: items.map(publicItem),
    limits: { maxItems: MAX_ITEMS },
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

  // canvas_items 有 ON DELETE CASCADE，且 db.ts 打开了 foreign_keys。
  getDb().prepare('DELETE FROM canvases WHERE id = ?').run(canvas.id)
  return c.json({ ok: true })
})

canvasRoutes.post('/:id/items', async (c) => {
  const user = currentUser(c)
  if (!user) return c.json({ ok: false, error: '未登录' }, 401)

  const canvas = ownedCanvas(user.id, Number(c.req.param('id')))
  if (!canvas) return c.json({ ok: false, error: '画布不存在' }, 404)

  const db = getDb()
  const count = (
    db.prepare('SELECT COUNT(*) AS n FROM canvas_items WHERE canvas_id = ?').get(canvas.id) as { n: number }
  ).n
  if (count >= MAX_ITEMS) {
    return c.json({ ok: false, error: `本画布图片已达上限 ${MAX_ITEMS} 张` }, 429)
  }

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const srcError = invalidSrc(body.src)
  if (srcError) return c.json({ ok: false, error: srcError }, 400)

  const topZ = (
    db.prepare('SELECT COALESCE(MAX(z), 0) AS z FROM canvas_items WHERE canvas_id = ?').get(canvas.id) as {
      z: number
    }
  ).z

  const result = db
    .prepare(
      `INSERT INTO canvas_items
         (canvas_id, src, label, x, y, width, height, z, source_run_id, source_item_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      canvas.id,
      String(body.src).trim(),
      typeof body.label === 'string' ? body.label.trim().slice(0, 60) : null,
      num(body.x, 0, -100_000, 100_000),
      num(body.y, 0, -100_000, 100_000),
      num(body.width, 320, 16, 8000),
      num(body.height, 180, 16, 8000),
      topZ + 1,
      Number.isInteger(body.sourceRunId) ? (body.sourceRunId as number) : null,
      Number.isInteger(body.sourceItemId) ? (body.sourceItemId as number) : null,
      nowIso(),
    )

  touch(canvas.id)
  const row = asRow<ItemRow>(
    db.prepare('SELECT * FROM canvas_items WHERE id = ?').get(Number(result.lastInsertRowid)),
  )
  return c.json({ ok: true, item: publicItem(row) }, 201)
})

canvasRoutes.patch('/:id/items/:itemId', async (c) => {
  const user = currentUser(c)
  if (!user) return c.json({ ok: false, error: '未登录' }, 401)

  const canvas = ownedCanvas(user.id, Number(c.req.param('id')))
  if (!canvas) return c.json({ ok: false, error: '画布不存在' }, 404)

  const db = getDb()
  const itemRow = db
    .prepare('SELECT * FROM canvas_items WHERE id = ? AND canvas_id = ?')
    .get(Number(c.req.param('itemId')), canvas.id)
  if (!itemRow) return c.json({ ok: false, error: '图片不存在' }, 404)
  const item = asRow<ItemRow>(itemRow)

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>

  // 只接受几何与标签的更新；src 不可改，改图等于换一张，应新增条目以保留来源链。
  const next = {
    x: body.x === undefined ? item.x : num(body.x, item.x, -100_000, 100_000),
    y: body.y === undefined ? item.y : num(body.y, item.y, -100_000, 100_000),
    width: body.width === undefined ? item.width : num(body.width, item.width, 16, 8000),
    height: body.height === undefined ? item.height : num(body.height, item.height, 16, 8000),
    z: body.z === undefined ? item.z : Math.trunc(num(body.z, item.z, -10_000, 10_000)),
    label:
      body.label === undefined
        ? item.label
        : typeof body.label === 'string'
          ? body.label.trim().slice(0, 60)
          : null,
  }

  db.prepare(
    'UPDATE canvas_items SET x = ?, y = ?, width = ?, height = ?, z = ?, label = ? WHERE id = ?',
  ).run(next.x, next.y, next.width, next.height, next.z, next.label, item.id)

  touch(canvas.id)
  const row = asRow<ItemRow>(db.prepare('SELECT * FROM canvas_items WHERE id = ?').get(item.id))
  return c.json({ ok: true, item: publicItem(row) })
})

canvasRoutes.delete('/:id/items/:itemId', (c) => {
  const user = currentUser(c)
  if (!user) return c.json({ ok: false, error: '未登录' }, 401)

  const canvas = ownedCanvas(user.id, Number(c.req.param('id')))
  if (!canvas) return c.json({ ok: false, error: '画布不存在' }, 404)

  const db = getDb()
  const result = db
    .prepare('DELETE FROM canvas_items WHERE id = ? AND canvas_id = ?')
    .run(Number(c.req.param('itemId')), canvas.id)
  if (result.changes === 0) return c.json({ ok: false, error: '图片不存在' }, 404)

  touch(canvas.id)
  return c.json({ ok: true })
})
