/**
 * 服务端账号上下文（工作流专用）。
 *
 * 为什么与「本机档案」并存而不是合并：本机档案是无密码的浏览器本地标识，
 * 明确承诺不做身份认证；而工作流会消耗真实算力费用，必须能把每一次调用
 * 归属到具体账号并施加配额，这两件事的安全承诺不同，不能用同一个抽象。
 *
 * 合并两者需要改掉本机档案「无密码、不上传」的口径，属于产品决策，
 * 不在工作流这一期内顺手做掉。见 README 的「已知限制」。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ApiError,
  apiConfigured,
  fetchMe,
  serverLogin,
  serverLogout,
  serverRegister,
  type RegisterInput,
  type ServerAccount,
} from '@/lib/portalApi'

export interface ServerAccountValue {
  account: ServerAccount | null
  /** 首次会话探测是否仍在进行，用于避免登录表单一闪而过。 */
  loading: boolean
  /** 后端地址是否已配置。未配置时工作流页面显示部署说明而不是登录框。 */
  configured: boolean
  /** 探测会话时遇到的连接问题，用于提示「后端没起来」而不是「你没登录」。 */
  connectionError: string | null
  login: (username: string, password: string) => Promise<void>
  register: (input: RegisterInput) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const ServerAccountContext = createContext<ServerAccountValue | null>(null)

export function ServerAccountProvider({ children }: { children: ReactNode }) {
  const configured = apiConfigured()
  const [account, setAccount] = useState<ServerAccount | null>(null)
  const [loading, setLoading] = useState(configured)
  const [connectionError, setConnectionError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!configured) {
      setLoading(false)
      return
    }
    try {
      setAccount(await fetchMe())
      setConnectionError(null)
    } catch (error) {
      setAccount(null)
      // 401 是「未登录」，属于正常状态；只有连不上后端才算异常。
      if (error instanceof ApiError && error.status === 0) {
        setConnectionError(error.message)
      }
    } finally {
      setLoading(false)
    }
  }, [configured])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(async (username: string, password: string) => {
    const { user } = await serverLogin(username, password)
    setAccount(user)
    setConnectionError(null)
  }, [])

  const register = useCallback(async (input: RegisterInput) => {
    const { user } = await serverRegister(input)
    setAccount(user)
    setConnectionError(null)
  }, [])

  const logout = useCallback(async () => {
    try {
      await serverLogout()
    } finally {
      // 即使登出请求失败也清掉本地状态，避免界面停在「已登录」。
      setAccount(null)
    }
  }, [])

  const value = useMemo<ServerAccountValue>(
    () => ({ account, loading, configured, connectionError, login, register, logout, refresh }),
    [account, loading, configured, connectionError, login, register, logout, refresh],
  )

  return <ServerAccountContext.Provider value={value}>{children}</ServerAccountContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useServerAccount(): ServerAccountValue {
  const context = useContext(ServerAccountContext)
  if (!context) throw new Error('useServerAccount 必须在 <ServerAccountProvider> 内使用')
  return context
}
