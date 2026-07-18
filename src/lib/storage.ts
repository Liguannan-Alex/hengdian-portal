/**
 * 本机档案使用的版本化存储键。
 *
 * 旧键仅用于首次迁移，迁移过程不会删除它们。
 */
export const PROFILE_STORAGE_KEY = 'hd_profile_v1'
export const FAVORITES_STORAGE_KEY = 'hd_favorites_v1'
export const LEGACY_SESSION_STORAGE_KEY = 'hd_session'
export const legacyFavoritesStorageKey = (username: string) => `hd_favs_${username}`

export interface StorageOperationResult<T> {
  value: T
  available: boolean
  notice: string | null
}

const memoryFallback = new Map<string, string>()
const STORAGE_UNAVAILABLE_NOTICE =
  '浏览器本地存储不可用，本次档案和收藏只在当前页面有效，关闭或刷新后不会长期保留。'

let memoryOnly = false

function unavailable<T>(value: T): StorageOperationResult<T> {
  return {
    value,
    available: false,
    notice: STORAGE_UNAVAILABLE_NOTICE,
  }
}

function browserStorage(): Storage | null {
  if (memoryOnly) return null

  try {
    if (typeof window === 'undefined') {
      memoryOnly = true
      return null
    }
    return window.localStorage
  } catch {
    memoryOnly = true
    return null
  }
}

/** 读取失败后，后续操作统一走内存，避免出现一半持久化、一半未持久化。 */
export function readStorage(key: string): StorageOperationResult<string | null> {
  const storage = browserStorage()
  if (!storage) return unavailable(memoryFallback.get(key) ?? null)

  try {
    const value = storage.getItem(key)
    if (value !== null) memoryFallback.set(key, value)
    return { value, available: true, notice: null }
  } catch {
    memoryOnly = true
    return unavailable(memoryFallback.get(key) ?? null)
  }
}

/** 始终先写入内存副本；浏览器拒绝写入时仍可在当前页面继续使用。 */
export function writeStorage(key: string, value: string): StorageOperationResult<void> {
  memoryFallback.set(key, value)
  const storage = browserStorage()
  if (!storage) return unavailable(undefined)

  try {
    storage.setItem(key, value)
    return { value: undefined, available: true, notice: null }
  } catch {
    memoryOnly = true
    return unavailable(undefined)
  }
}

export function removeStorage(key: string): StorageOperationResult<void> {
  memoryFallback.delete(key)
  const storage = browserStorage()
  if (!storage) return unavailable(undefined)

  try {
    storage.removeItem(key)
    return { value: undefined, available: true, notice: null }
  } catch {
    memoryOnly = true
    return unavailable(undefined)
  }
}
