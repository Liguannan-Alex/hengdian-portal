import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * 本地模拟账号体系（MVP 演示版，数据全部存 localStorage）
 * - 账号列表：key 'hd_users'，密码仅做 btoa 简单哈希，无安全性可言
 * - 当前会话：key 'hd_session'
 * - 收藏夹：key 'hd_favs_<username>'，按用户隔离
 */

export interface User {
  username: string
}

interface StoredUser {
  username: string
  passwordHash: string
}

/** 登录 / 注册操作结果 */
export interface AuthResult {
  ok: boolean
  error?: string
}

export interface AuthContextValue {
  currentUser: User | null
  /** 注册成功后会自动登录 */
  register: (username: string, password: string) => AuthResult
  login: (username: string, password: string) => AuthResult
  logout: () => void
  /** 当前登录用户的收藏工具 id 列表（未登录恒为 []） */
  favorites: number[]
  isFavorite: (id: number) => boolean
  /** 返回 false 表示未登录（调用方应引导登录）；成功切换返回 true */
  toggleFavorite: (id: number) => boolean
}

const USERS_KEY = 'hd_users'
const SESSION_KEY = 'hd_session'
const favsKey = (username: string) => `hd_favs_${username}`

/** 简单哈希（仅演示，支持中文等非 ASCII 输入） */
function hashPassword(password: string): string {
  return btoa(unescape(encodeURIComponent(password)))
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

const readUsers = (): StoredUser[] => readJson<StoredUser[]>(USERS_KEY, [])
const writeUsers = (users: StoredUser[]) => localStorage.setItem(USERS_KEY, JSON.stringify(users))

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const username = localStorage.getItem(SESSION_KEY)
    return username ? { username } : null
  })
  const [favorites, setFavorites] = useState<number[]>([])

  // 会话变化时加载对应用户的收藏夹
  useEffect(() => {
    if (currentUser) {
      setFavorites(readJson<number[]>(favsKey(currentUser.username), []))
    } else {
      setFavorites([])
    }
  }, [currentUser])

  const register = useCallback((username: string, password: string): AuthResult => {
    const name = username.trim()
    if (!name || !password) return { ok: false, error: '用户名和密码不能为空' }
    const users = readUsers()
    if (users.some((u) => u.username === name)) return { ok: false, error: '用户名已存在' }
    users.push({ username: name, passwordHash: hashPassword(password) })
    writeUsers(users)
    localStorage.setItem(SESSION_KEY, name)
    setCurrentUser({ username: name })
    return { ok: true }
  }, [])

  const login = useCallback((username: string, password: string): AuthResult => {
    const name = username.trim()
    const user = readUsers().find((u) => u.username === name)
    if (!user) return { ok: false, error: '用户不存在，请先注册' }
    if (user.passwordHash !== hashPassword(password)) return { ok: false, error: '密码错误' }
    localStorage.setItem(SESSION_KEY, name)
    setCurrentUser({ username: name })
    return { ok: true }
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(SESSION_KEY)
    setCurrentUser(null)
  }, [])

  const isFavorite = useCallback((id: number) => favorites.includes(id), [favorites])

  const toggleFavorite = useCallback(
    (id: number): boolean => {
      if (!currentUser) return false // 未登录：调用方应引导登录
      setFavorites((prev) => {
        const next = prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]
        localStorage.setItem(favsKey(currentUser.username), JSON.stringify(next))
        return next
      })
      return true
    },
    [currentUser],
  )

  const value = useMemo<AuthContextValue>(
    () => ({ currentUser, register, login, logout, favorites, isFavorite, toggleFavorite }),
    [currentUser, register, login, logout, favorites, isFavorite, toggleFavorite],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必须在 <AuthProvider> 内使用')
  return ctx
}
