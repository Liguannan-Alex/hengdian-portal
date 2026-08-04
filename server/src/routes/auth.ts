/**
 * 身份路由：注册、登录、登出、当前用户。
 *
 * 与前端 v0.3 的差别：本机档案只有一个显示名称、无口令、不跨设备；
 * 这里是真实账号，用户名唯一、口令散列存储、会话可撤销、收藏可跨设备。
 */
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { getDb, nowIso, IDENTITIES, type Identity } from '../db.ts'
import { hashPassword, validatePassword, verifyPassword } from '../lib/password.ts'
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  currentUser,
  destroySession,
  destroyUserSessions,
  purgeExpiredSessions,
  setSessionCookie,
} from '../lib/session.ts'

export const authRoutes = new Hono()

const MIN_NAME = 2
const MAX_NAME = 20
const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,32}$/

/** 登录失败次数限制，进程内计数。多实例部署时需换成共享存储。 */
const attempts = new Map<string, { count: number; until: number }>()
const MAX_ATTEMPTS = 8
const LOCK_MS = 10 * 60 * 1000

function tooManyAttempts(key: string): boolean {
  const record = attempts.get(key)
  if (!record) return false
  if (Date.now() > record.until) {
    attempts.delete(key)
    return false
  }
  return record.count >= MAX_ATTEMPTS
}

function noteFailure(key: string): void {
  const record = attempts.get(key)
  if (!record || Date.now() > record.until) {
    attempts.set(key, { count: 1, until: Date.now() + LOCK_MS })
    return
  }
  record.count += 1
  record.until = Date.now() + LOCK_MS
}

export function validateDisplayName(value: string): string | null {
  const length = Array.from(value.trim()).length
  if (length < MIN_NAME) return `名称至少 ${MIN_NAME} 个字符`
  if (length > MAX_NAME) return `名称最多 ${MAX_NAME} 个字符`
  return null
}

function isIdentity(value: unknown): value is Identity {
  return typeof value === 'string' && (IDENTITIES as readonly string[]).includes(value)
}

interface RegisterBody {
  username?: unknown
  password?: unknown
  displayName?: unknown
  identity?: unknown
  org?: unknown
}

authRoutes.post('/register', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as RegisterBody
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : ''
  const org = typeof body.org === 'string' ? body.org.trim().slice(0, 60) : null

  if (!USERNAME_PATTERN.test(username)) {
    return c.json({ ok: false, error: '用户名为 3 至 32 位字母、数字、下划线或连字符' }, 400)
  }
  const nameError = validateDisplayName(displayName)
  if (nameError) return c.json({ ok: false, error: nameError }, 400)
  const passwordError = validatePassword(password)
  if (passwordError) return c.json({ ok: false, error: passwordError }, 400)
  if (!isIdentity(body.identity)) {
    return c.json({ ok: false, error: `身份需为 ${IDENTITIES.join(' / ')} 之一` }, 400)
  }

  const db = getDb()
  const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)
  if (exists) return c.json({ ok: false, error: '该用户名已被占用' }, 409)

  const passwordHash = await hashPassword(password)
  const result = db
    .prepare(
      'INSERT INTO users (username, password_hash, display_name, identity, org, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(username, passwordHash, displayName, body.identity, org, nowIso())

  const userId = Number(result.lastInsertRowid)
  const token = createSession(userId, c.req.header('user-agent'))
  setSessionCookie(c, token)

  return c.json({
    ok: true,
    user: { id: userId, username, displayName, identity: body.identity, org },
  })
})

interface LoginBody {
  username?: unknown
  password?: unknown
}

authRoutes.post('/login', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as LoginBody
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!username || !password) return c.json({ ok: false, error: '请填写用户名与口令' }, 400)
  if (tooManyAttempts(username)) {
    return c.json({ ok: false, error: '失败次数过多，请稍后再试' }, 429)
  }

  const db = getDb()
  const row = db
    .prepare('SELECT id, username, password_hash, display_name, identity, org, disabled FROM users WHERE username = ?')
    .get(username) as
    | { id: number; username: string; password_hash: string; display_name: string; identity: string; org: string | null; disabled: number }
    | undefined

  // 用户不存在时也执行一次散列校验，避免通过响应时间区分账号是否存在。
  const stored = row?.password_hash ?? 'scrypt$16384$8$1$00$00'
  const passed = await verifyPassword(password, stored)

  if (!row || !passed) {
    noteFailure(username)
    return c.json({ ok: false, error: '用户名或口令不正确' }, 401)
  }
  if (row.disabled) return c.json({ ok: false, error: '该账号已停用' }, 403)

  attempts.delete(username)
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), row.id)
  purgeExpiredSessions()

  const token = createSession(row.id, c.req.header('user-agent'))
  setSessionCookie(c, token)

  return c.json({
    ok: true,
    user: {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      identity: row.identity,
      org: row.org,
    },
  })
})

authRoutes.post('/logout', (c) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) destroySession(token)
  clearSessionCookie(c)
  return c.json({ ok: true })
})

/** 登出全部设备，用于口令泄露后的自助处置。 */
authRoutes.post('/logout-all', (c) => {
  const user = currentUser(c)
  if (!user) return c.json({ ok: false, error: '未登录' }, 401)
  destroyUserSessions(user.id)
  clearSessionCookie(c)
  return c.json({ ok: true })
})

authRoutes.get('/me', (c) => {
  const user = currentUser(c)
  if (!user) return c.json({ ok: true, user: null })
  return c.json({ ok: true, user })
})
