/**
 * 横店影视 AIGC 门户后端入口。
 *
 * 选用 Hono 的原因：同一份代码可运行在 Node、Cloudflare Workers 与 Vercel，
 * 后续换部署目标不需要重写路由层。当前前端托管在 GitHub Pages，
 * 静态托管无法运行后端，部署位置需另行确定。
 */
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { getDb } from './db.ts'
import { authRoutes } from './routes/auth.ts'
import { favoriteRoutes } from './routes/favorites.ts'
import { eventRoutes } from './routes/events.ts'
import { statsRoutes } from './routes/stats.ts'

const app = new Hono()

app.use('*', logger())

/**
 * 尾斜杠归一。`/api/events/` 重定向到 `/api/events`，避免客户端写法差异导致 404。
 * 使用 308 而非 302，因为 308 保留原请求方法与请求体，POST 不会被降级为 GET。
 */
app.use('*', async (c, next) => {
  const url = new URL(c.req.url)
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '')
    return c.redirect(url.pathname + url.search, 308)
  }
  await next()
})

/**
 * 跨域：前端与后端不同源时必须允许携带 Cookie。
 * ALLOWED_ORIGINS 用逗号分隔，未配置时只放行本地开发端口。
 */
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

app.use(
  '/api/*',
  cors({
    origin: (origin) => (allowedOrigins.includes(origin) ? origin : null),
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  }),
)

app.get('/api/health', (c) => {
  const db = getDb()
  const users = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
  const events = (db.prepare('SELECT COUNT(*) AS n FROM tool_events').get() as { n: number }).n
  return c.json({ ok: true, service: 'hengdian-portal-server', users, events })
})

app.route('/api/auth', authRoutes)
app.route('/api/favorites', favoriteRoutes)
app.route('/api/events', eventRoutes)
app.route('/api/stats', statsRoutes)

app.notFound((c) => c.json({ ok: false, error: '接口不存在' }, 404))

app.onError((err, c) => {
  console.error('[error]', err)
  return c.json({ ok: false, error: '服务器内部错误' }, 500)
})

const port = Number(process.env.PORT ?? 8787)

// 以模块方式被测试引入时不自动监听。
if (process.env.NODE_ENV !== 'test') {
  getDb()
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`门户后端已启动　http://localhost:${info.port}`)
    console.log(`允许来源　${allowedOrigins.join(', ')}`)
    if (!process.env.ADMIN_USERNAMES) {
      console.warn('提示：未设置 ADMIN_USERNAMES，/api/stats 将对所有账号返回 403')
    }
  })
}

export default app
