/**
 * 收藏路由：跨设备同步，替代前端 localStorage 的 hd_favorites_v1。
 *
 * 收藏动作同时写入埋点表，因为 PRD 的考核指标之一是「至少点过一次工具的
 * 用户占比」，收藏与点击都算有效使用行为。
 */
import { Hono } from 'hono'
import { getDb, nowIso } from '../db.ts'
import { clientHash, currentUser } from '../lib/session.ts'
import { recordEvent } from './events.ts'

export const favoriteRoutes = new Hono()

favoriteRoutes.get('/', (c) => {
  const user = currentUser(c)
  if (!user) return c.json({ ok: false, error: '未登录' }, 401)

  const rows = getDb()
    .prepare('SELECT tool_id FROM favorites WHERE user_id = ? ORDER BY created_at DESC')
    .all(user.id) as { tool_id: number }[]

  return c.json({ ok: true, favorites: rows.map((r) => r.tool_id) })
})

/** 合并本机收藏。前端首次登录时把 localStorage 里的记录一次性带上来。 */
favoriteRoutes.post('/merge', async (c) => {
  const user = currentUser(c)
  if (!user) return c.json({ ok: false, error: '未登录' }, 401)

  const body = (await c.req.json().catch(() => ({}))) as { toolIds?: unknown }
  if (!Array.isArray(body.toolIds)) return c.json({ ok: false, error: 'toolIds 需为数组' }, 400)

  const ids = [
    ...new Set(
      body.toolIds.filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && id >= 0),
    ),
  ].slice(0, 500)

  const db = getDb()
  const insert = db.prepare(
    'INSERT INTO favorites (user_id, tool_id, created_at) VALUES (?, ?, ?) ON CONFLICT(user_id, tool_id) DO NOTHING',
  )
  db.exec('BEGIN')
  try {
    for (const id of ids) insert.run(user.id, id, nowIso())
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  const rows = db.prepare('SELECT tool_id FROM favorites WHERE user_id = ?').all(user.id) as { tool_id: number }[]
  return c.json({ ok: true, merged: ids.length, favorites: rows.map((r) => r.tool_id) })
})

favoriteRoutes.put('/:toolId', (c) => {
  const user = currentUser(c)
  if (!user) return c.json({ ok: false, error: '未登录' }, 401)

  const toolId = Number(c.req.param('toolId'))
  if (!Number.isInteger(toolId) || toolId < 0) return c.json({ ok: false, error: 'toolId 不合法' }, 400)

  const db = getDb()
  const existing = db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND tool_id = ?').get(user.id, toolId)

  let favorited: boolean
  if (existing) {
    db.prepare('DELETE FROM favorites WHERE user_id = ? AND tool_id = ?').run(user.id, toolId)
    favorited = false
  } else {
    db.prepare('INSERT INTO favorites (user_id, tool_id, created_at) VALUES (?, ?, ?)').run(user.id, toolId, nowIso())
    favorited = true
  }

  const tool = db.prepare('SELECT name FROM tools WHERE id = ?').get(toolId) as { name: string } | undefined
  recordEvent({
    userId: user.id,
    identity: user.identity,
    action: favorited ? 'favorite_add' : 'favorite_remove',
    toolId,
    toolName: tool?.name ?? null,
    scene: null,
    sourcePage: c.req.header('referer')?.slice(0, 200) ?? 'unknown',
    keyword: null,
    clientHash: clientHash(c.req.header('user-agent'), c.req.header('x-forwarded-for')),
  })

  return c.json({ ok: true, favorited })
})
