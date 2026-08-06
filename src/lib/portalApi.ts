/**
 * 门户后端客户端。
 *
 * 工作流是门户里第一个必须依赖后端的功能：任务要排队、产出要归属、
 * 算力要计费，这些都无法在浏览器本地完成。工具库与本机档案仍是纯前端，
 * 因此这里只服务工作流一条链路，不去改动既有的本机档案实现。
 *
 * 后端地址通过 VITE_PORTAL_API 配置。未配置且非本地开发时，视为后端未部署，
 * 由调用方给出「工作流需要后端服务」的明确提示，而不是抛一串网络错误。
 */

const DEV_FALLBACK = 'http://localhost:8787'

/**
 * 演示模式：构建时置 `VITE_DEMO_MODE=true`，所有请求由浏览器内的演示后端应答。
 *
 * 用于 GitHub Pages 这类静态托管——没有后端，工作流就只剩一个空壳。
 * 拦截点放在 `api()` 一层，页面、表单、轮询、错误处理仍走真实代码路径。
 */
export const isDemoMode = () => import.meta.env.VITE_DEMO_MODE === 'true'

export function apiBaseUrl(): string | null {
  const configured = import.meta.env.VITE_PORTAL_API?.trim()
  if (configured) return configured.replace(/\/+$/, '')
  return import.meta.env.DEV ? DEV_FALLBACK : null
}

/** 演示模式没有后端地址，但功能可用，因此这里必须返回 true。 */
export const apiConfigured = () => isDemoMode() || apiBaseUrl() !== null

export class ApiError extends Error {
  status: number
  /** 后端返回的逐字段错误，用于把提示落到具体输入框。 */
  fieldErrors: Record<string, string>

  constructor(message: string, status: number, fieldErrors: Record<string, string> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.fieldErrors = fieldErrors
  }
}

interface RequestOptions {
  method?: string
  body?: unknown
  signal?: AbortSignal
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (isDemoMode()) {
    // 动态载入：正式构建下这段代码不会被求值，演示后端也不会进主包。
    const { demoRequest } = await import('@/lib/demoBackend')
    const result = demoRequest(path, options.method ?? 'GET', options.body)
    const record = (result.body ?? {}) as Record<string, unknown>
    if (result.status >= 400 || record.ok === false) {
      throw new ApiError(
        typeof record.error === 'string' ? record.error : `请求失败（${result.status}）`,
        result.status,
        (record.fieldErrors as Record<string, string>) ?? {},
      )
    }
    return result.body as T
  }

  const base = apiBaseUrl()
  if (!base) {
    throw new ApiError('门户后端尚未部署，工作流功能暂不可用。', 0)
  }

  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      method: options.method ?? 'GET',
      // 会话是 httpOnly Cookie，跨域请求必须显式携带。
      credentials: 'include',
      headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    throw new ApiError('连接门户后端失败，请确认服务已启动。', 0)
  }

  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text) as unknown
    } catch {
      throw new ApiError('后端返回的内容无法解析。', response.status)
    }
  }

  const record = (payload ?? {}) as Record<string, unknown>
  if (!response.ok || record.ok === false) {
    throw new ApiError(
      typeof record.error === 'string' ? record.error : `请求失败（${response.status}）`,
      response.status,
      (record.fieldErrors as Record<string, string>) ?? {},
    )
  }

  return payload as T
}

// ── 类型 ────────────────────────────────────────────────────────

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'

export interface RunOutput {
  kind: 'image' | 'video' | 'text'
  url?: string
  text?: string
  label?: string
}

export interface WorkflowRun {
  id: number
  workflowSlug: string
  workflowName: string
  outputKind: 'image' | 'video' | 'text'
  status: RunStatus
  costCredits: number
  params: Record<string, string | number | boolean>
  outputs: RunOutput[]
  error: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface WorkflowAvailability {
  slug: string
  runnable: boolean
  unavailableReason: string | null
  usingMock: boolean
  providerLabel: string
}

export interface Quota {
  usedCredits: number
  limitCredits: number
  remainingCredits: number
  pendingRuns: number
  pendingLimit: number
  resetsAt: string
}

export interface ServerAccount {
  id: number
  username: string
  displayName: string
  identity: 'opc' | 'crew' | 'director' | 'individual'
  org: string | null
}

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: '排队中',
  running: '生成中',
  succeeded: '已完成',
  failed: '失败',
  canceled: '已取消',
}

export const IDENTITY_LABELS: Record<ServerAccount['identity'], string> = {
  opc: '一人公司 / OPC',
  crew: '剧组',
  director: '导演',
  individual: '个人创作者',
}

/** 终态任务不再轮询，列表页据此决定是否继续刷新。 */
export const isTerminal = (status: RunStatus) =>
  status === 'succeeded' || status === 'failed' || status === 'canceled'

// ── 接口封装 ────────────────────────────────────────────────────

export const fetchAvailability = () =>
  api<{ workflows: WorkflowAvailability[] }>('/api/workflows').then((r) => r.workflows)

export const fetchQuota = () => api<{ quota: Quota }>('/api/workflows/quota').then((r) => r.quota)

export const fetchRuns = (limit = 30) =>
  api<{ runs: WorkflowRun[] }>(`/api/workflows/runs?limit=${limit}`).then((r) => r.runs)

export const fetchRun = (id: number) =>
  api<{ run: WorkflowRun }>(`/api/workflows/runs/${id}`).then((r) => r.run)

export const cancelRun = (id: number) =>
  api<{ ok: true }>(`/api/workflows/runs/${id}/cancel`, { method: 'POST' })

export const submitRun = (slug: string, params: Record<string, string | number | boolean>) =>
  api<{ run: WorkflowRun; usingMock: boolean }>(`/api/workflows/${slug}/runs`, {
    method: 'POST',
    body: { params },
  })

export const fetchMe = () => api<{ user: ServerAccount | null }>('/api/auth/me').then((r) => r.user)

export const serverLogin = (username: string, password: string) =>
  api<{ user: ServerAccount }>('/api/auth/login', { method: 'POST', body: { username, password } })

export interface RegisterInput {
  username: string
  password: string
  displayName: string
  identity: ServerAccount['identity']
  org?: string
}

export const serverRegister = (input: RegisterInput) =>
  api<{ user: ServerAccount }>('/api/auth/register', { method: 'POST', body: input })

export const serverLogout = () => api<{ ok: true }>('/api/auth/logout', { method: 'POST' })

/**
 * 上报工作流埋点。
 *
 * 失败静默：埋点不该影响用户正在做的事。完整率由后端 /api/events/completeness
 * 统计，缺字段的上报在服务端就会被拒收，不会被静默补空。
 */
export function trackWorkflow(
  action: 'workflow_view' | 'workflow_submit',
  workflowSlug: string,
  sourcePage: string,
  scene?: string,
): void {
  if (!apiConfigured()) return
  void api('/api/events', {
    method: 'POST',
    body: { action, workflowSlug, sourcePage, scene },
  }).catch(() => undefined)
}
