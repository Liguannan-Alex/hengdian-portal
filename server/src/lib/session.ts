/**
 * 会话：httpOnly Cookie + 服务端会话表。
 *
 * 不使用 JWT，原因是本门户需要「关闭档案即刻失效」和管理员停用账号的能力，
 * 服务端可撤销的会话表更直接。
 */
import { createHash, randomBytes } from 'node:crypto'
import type { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { getDb, nowIso, type Identity } from '../db.ts'

export const SESSION_COOKIE = 'hd_portal_session'
const SESSION_TTL_DAYS = 14

export interface SessionUser {
  id: number
  username: string
  displayName: string
  identity: Identity
  org: string | null
}

interface UserRow {
  id: number
  username: string
  display_name: string
  identity: string
  org: string | null
  disabled: number
}

function ttlDate(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

/** 客户端指纹只保留散列，不落原始 UA 与 IP。 */
export function clientHash(userAgent: string | undefined, ip: string | undefined): string {
  return createHash('sha256').update(`${userAgent ?? ''}|${ip ?? ''}`).digest('hex').slice(0, 32)
}

export function createSession(userId: number, userAgent: string | undefined): string {
  const token = randomBytes(32).toString('base64url')
  getDb()
    .prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)')
    .run(token, userId, nowIso(), ttlDate(SESSION_TTL_DAYS), userAgent?.slice(0, 300) ?? null)
  return token
}

export function destroySession(token: string): void {
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

export function destroyUserSessions(userId: number): void {
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
}

/** 顺带清理过期会话，避免单独起定时任务。 */
export function purgeExpiredSessions(): void {
  getDb().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso())
}

export function resolveSession(token: string | undefined): SessionUser | null {
  if (!token) return null

  const row = getDb()
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.identity, u.org, u.disabled
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`,
    )
    .get(token, nowIso()) as UserRow | undefined

  if (!row || row.disabled) return null
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    identity: row.identity as Identity,
    org: row.org,
  }
}

export function setSessionCookie(c: Context, token: string): void {
  const secure = process.env.COOKIE_SECURE !== 'false'
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    // 前端与后端可能不同域，跨站携带 Cookie 需要 None；本地开发关闭 secure 时降级为 Lax。
    sameSite: secure ? 'None' : 'Lax',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  })
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

export function currentUser(c: Context): SessionUser | null {
  return resolveSession(getCookie(c, SESSION_COOKIE))
}

/** 需要登录的路由前置检查。未登录返回 null 并已写好 401 响应体。 */
export function requireUser(c: Context): SessionUser | null {
  return currentUser(c)
}
