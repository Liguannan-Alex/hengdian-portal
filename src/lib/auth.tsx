import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  FAVORITES_STORAGE_KEY,
  LEGACY_SESSION_STORAGE_KEY,
  PROFILE_STORAGE_KEY,
  legacyFavoritesStorageKey,
  readStorage,
  writeStorage,
} from '@/lib/storage'
import type { StorageOperationResult } from '@/lib/storage'

/** 单机单档案；不包含密码、账号或云端身份。 */
export interface LocalProfile {
  name: string
}

/** 兼容现有页面使用的显示形状。 */
export interface User {
  username: string
}

export interface AuthResult {
  ok: boolean
  error?: string
  message?: string
}

export interface AuthContextValue {
  profile: LocalProfile | null
  currentUser: User | null
  saveProfile: (name: string) => AuthResult
  /** 旧页面兼容入口；password 参数会被忽略，不再创建或校验密码。 */
  register: (username: string, password?: string) => AuthResult
  /** 旧页面兼容入口；等同于保存本机档案。 */
  login: (username: string, password?: string) => AuthResult
  /** 关闭当前档案；收藏数据仍保留在本机。 */
  logout: () => void
  favorites: number[]
  isFavorite: (id: number) => boolean
  /** 无档案时记录待收藏工具并返回 false，由调用方打开 hd:require-auth。 */
  toggleFavorite: (id: number) => boolean
  pendingFavoriteId: number | null
  storageAvailable: boolean
  storageNotice: string | null
  actionNotice: string | null
  clearActionNotice: () => void
}

export const PROFILE_KEY = PROFILE_STORAGE_KEY
export const FAVORITES_KEY = FAVORITES_STORAGE_KEY

const MIN_PROFILE_NAME_LENGTH = 2
const MAX_PROFILE_NAME_LENGTH = 20
const EMPTY_FAVORITES: number[] = []
const MALFORMED_PROFILE_NOTICE = '本机档案数据格式异常，已忽略损坏内容。'
const MALFORMED_FAVORITES_NOTICE = '本机收藏数据格式异常，已使用可识别的收藏记录。'

interface AuthState {
  profile: LocalProfile | null
  /** 即使档案关闭，也保留已读取的本机收藏，重新建立档案后可继续使用。 */
  storedFavorites: number[]
  pendingFavoriteId: number | null
  storageAvailable: boolean
  storageNotice: string | null
  actionNotice: string | null
}

interface ParsedProfile {
  profile: LocalProfile | null
  malformed: boolean
}

interface ParsedFavorites {
  favorites: number[]
  malformed: boolean
}

// Auth 上下文与校验器必须共享同一份长度规则。
// eslint-disable-next-line react-refresh/only-export-components
export function validateProfileName(value: string): string | null {
  const name = value.trim()
  const length = Array.from(name).length
  if (length < MIN_PROFILE_NAME_LENGTH) return `名称至少 ${MIN_PROFILE_NAME_LENGTH} 个字符`
  if (length > MAX_PROFILE_NAME_LENGTH) return `名称最多 ${MAX_PROFILE_NAME_LENGTH} 个字符`
  return null
}

function parseProfile(raw: string | null): ParsedProfile {
  if (raw === null) return { profile: null, malformed: false }

  try {
    const value: unknown = JSON.parse(raw)
    if (value === null) return { profile: null, malformed: false }
    if (typeof value !== 'object' || !('name' in value) || typeof value.name !== 'string') {
      return { profile: null, malformed: true }
    }
    const name = value.name.trim()
    if (validateProfileName(name)) return { profile: null, malformed: true }
    return { profile: { name }, malformed: false }
  } catch {
    return { profile: null, malformed: true }
  }
}

function parseFavorites(raw: string | null): ParsedFavorites {
  if (raw === null) return { favorites: [], malformed: false }

  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return { favorites: [], malformed: true }
    const validIds = value.filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && id >= 0)
    return {
      favorites: [...new Set(validIds)],
      malformed: validIds.length !== value.length,
    }
  } catch {
    return { favorites: [], malformed: true }
  }
}

function noteStorageResult(
  current: Pick<AuthState, 'storageAvailable' | 'storageNotice'>,
  result: StorageOperationResult<unknown>,
): Pick<AuthState, 'storageAvailable' | 'storageNotice'> {
  if (current.storageAvailable && result.available) return current
  return {
    storageAvailable: false,
    storageNotice: result.notice ?? current.storageNotice ?? '本机存储暂不可用。',
  }
}

function loadInitialState(): AuthState {
  let storageStatus: Pick<AuthState, 'storageAvailable' | 'storageNotice'> = {
    storageAvailable: true,
    storageNotice: null,
  }

  const profileRead = readStorage(PROFILE_STORAGE_KEY)
  storageStatus = noteStorageResult(storageStatus, profileRead)
  const profileKeyExists = profileRead.value !== null
  const parsedProfile = parseProfile(profileRead.value)
  let profile = parsedProfile.profile
  if (parsedProfile.malformed && storageStatus.storageAvailable) {
    storageStatus = { ...storageStatus, storageNotice: MALFORMED_PROFILE_NOTICE }
  }

  const favoritesRead = readStorage(FAVORITES_STORAGE_KEY)
  storageStatus = noteStorageResult(storageStatus, favoritesRead)
  let parsedFavorites = parseFavorites(favoritesRead.value)

  let legacyName: string | null = null

  // 先完成所有旧数据读取，再写新版键；即使浏览器拒绝写入，内存降级也已有完整副本。
  if (!profileKeyExists) {
    const legacySessionRead = readStorage(LEGACY_SESSION_STORAGE_KEY)
    storageStatus = noteStorageResult(storageStatus, legacySessionRead)
    const candidate = legacySessionRead.value?.trim() ?? ''
    if (candidate && !validateProfileName(candidate)) {
      legacyName = candidate
      profile = { name: candidate }
    }
  }

  // 新版收藏键不存在时，按旧会话名称复制对应收藏；不删除旧收藏键。
  let shouldWriteMigratedFavorites = false
  if (favoritesRead.value === null) {
    const migrationName = legacyName ?? profile?.name ?? null
    if (migrationName) {
      shouldWriteMigratedFavorites = true
      const legacyFavoritesRead = readStorage(legacyFavoritesStorageKey(migrationName))
      storageStatus = noteStorageResult(storageStatus, legacyFavoritesRead)
      if (legacyFavoritesRead.value !== null) {
        parsedFavorites = parseFavorites(legacyFavoritesRead.value)
      }
    }
  }

  if (legacyName && profile) {
    const profileWrite = writeStorage(PROFILE_STORAGE_KEY, JSON.stringify(profile))
    storageStatus = noteStorageResult(storageStatus, profileWrite)
  }
  if (shouldWriteMigratedFavorites) {
    const favoritesWrite = writeStorage(FAVORITES_STORAGE_KEY, JSON.stringify(parsedFavorites.favorites))
    storageStatus = noteStorageResult(storageStatus, favoritesWrite)
  }

  if (parsedFavorites.malformed && storageStatus.storageAvailable) {
    storageStatus = { ...storageStatus, storageNotice: MALFORMED_FAVORITES_NOTICE }
  }

  return {
    profile,
    storedFavorites: parsedFavorites.favorites,
    pendingFavoriteId: null,
    storageAvailable: storageStatus.storageAvailable,
    storageNotice: storageStatus.storageNotice,
    actionNotice: null,
  }
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(loadInitialState)
  const stateRef = useRef(state)

  const commit = useCallback((next: AuthState) => {
    stateRef.current = next
    setState(next)
  }, [])

  const saveProfile = useCallback(
    (value: string): AuthResult => {
      const name = value.trim()
      const validationError = validateProfileName(name)
      if (validationError) return { ok: false, error: validationError }

      const previous = stateRef.current
      const pendingId = previous.pendingFavoriteId
      const nextFavorites =
        pendingId !== null && !previous.storedFavorites.includes(pendingId)
          ? [...previous.storedFavorites, pendingId]
          : previous.storedFavorites

      let storageStatus = noteStorageResult(
        previous,
        writeStorage(PROFILE_STORAGE_KEY, JSON.stringify({ name } satisfies LocalProfile)),
      )
      storageStatus = noteStorageResult(
        storageStatus,
        writeStorage(FAVORITES_STORAGE_KEY, JSON.stringify(nextFavorites)),
      )

      const message =
        pendingId === null
          ? '本机档案已保存。'
          : '本机档案已保存，刚才的工具已自动加入本机工具箱。'

      commit({
        ...previous,
        profile: { name },
        storedFavorites: nextFavorites,
        pendingFavoriteId: null,
        storageAvailable: storageStatus.storageAvailable,
        storageNotice: storageStatus.storageNotice,
        actionNotice: message,
      })

      return { ok: true, message }
    },
    [commit],
  )

  // 旧页面仍可传入第二个密码参数；函数接收更少参数是兼容的，密码不会被保存。
  const login = saveProfile
  const register = saveProfile

  const logout = useCallback(() => {
    const previous = stateRef.current
    // 写入 null 哨兵，避免保留的旧 hd_session 在下次加载时再次触发迁移。
    const writeResult = writeStorage(PROFILE_STORAGE_KEY, JSON.stringify(null))
    const storageStatus = noteStorageResult(previous, writeResult)
    commit({
      ...previous,
      profile: null,
      pendingFavoriteId: null,
      storageAvailable: storageStatus.storageAvailable,
      storageNotice: storageStatus.storageNotice,
      actionNotice: '本机档案已关闭，收藏仍保留在本机。',
    })
  }, [commit])

  const toggleFavorite = useCallback(
    (id: number): boolean => {
      const previous = stateRef.current
      if (!previous.profile) {
        commit({
          ...previous,
          pendingFavoriteId: id,
          actionNotice: null,
        })
        return false
      }

      const nextFavorites = previous.storedFavorites.includes(id)
        ? previous.storedFavorites.filter((favoriteId) => favoriteId !== id)
        : [...previous.storedFavorites, id]
      const writeResult = writeStorage(FAVORITES_STORAGE_KEY, JSON.stringify(nextFavorites))
      const storageStatus = noteStorageResult(previous, writeResult)
      commit({
        ...previous,
        storedFavorites: nextFavorites,
        storageAvailable: storageStatus.storageAvailable,
        storageNotice: storageStatus.storageNotice,
        actionNotice: null,
      })
      return true
    },
    [commit],
  )

  const clearActionNotice = useCallback(() => {
    const previous = stateRef.current
    if (!previous.actionNotice) return
    commit({ ...previous, actionNotice: null })
  }, [commit])

  const favorites = state.profile ? state.storedFavorites : EMPTY_FAVORITES
  const currentUser = useMemo<User | null>(
    () => (state.profile ? { username: state.profile.name } : null),
    [state.profile],
  )
  const isFavorite = useCallback(
    (id: number) => Boolean(state.profile) && state.storedFavorites.includes(id),
    [state.profile, state.storedFavorites],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      profile: state.profile,
      currentUser,
      saveProfile,
      register,
      login,
      logout,
      favorites,
      isFavorite,
      toggleFavorite,
      pendingFavoriteId: state.pendingFavoriteId,
      storageAvailable: state.storageAvailable,
      storageNotice: state.storageNotice,
      actionNotice: state.actionNotice,
      clearActionNotice,
    }),
    [
      state.profile,
      state.pendingFavoriteId,
      state.storageAvailable,
      state.storageNotice,
      state.actionNotice,
      currentUser,
      saveProfile,
      register,
      login,
      logout,
      favorites,
      isFavorite,
      toggleFavorite,
      clearActionNotice,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth 必须在 <AuthProvider> 内使用')
  return context
}
