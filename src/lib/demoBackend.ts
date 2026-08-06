/**
 * 浏览器内演示后端。
 *
 * 存在的理由：门户前端托管在 GitHub Pages，静态托管跑不了后端，而工作流恰恰是
 * 需要后端的那一块。没有它，演示站上「AI 工作流」只剩一句「后端尚未部署」，
 * 看的人点不动任何东西。
 *
 * 实现方式是在 `api()` 这一层拦截，按同样的路径返回同样形状的响应，
 * 而不是在每个页面里塞 `if (demo)`。这样页面、表单、轮询、错误处理走的
 * 完全是真实那条代码路径——演示站验证过的交互，接上真后端时不会两样。
 *
 * 边界：只在构建时 `VITE_DEMO_MODE=true` 时启用；数据存在 sessionStorage，
 * 关掉标签页就没了；不产生任何网络请求，也不消耗任何真实算力。
 */
import { validateParams, workflowBySlug, workflows, type ParamValue } from '@/data/workflows'
import type { Quota, RunOutput, RunStatus, ServerAccount, WorkflowRun } from '@/lib/portalApi'

const STORAGE_KEY = 'hd_demo_state_v1'
const DAILY_CREDITS = 30
const PENDING_LIMIT = 3

/**
 * 演示账号。
 *
 * 演示站不设登录墙：让领导先输一遍用户名口令才能看到功能，会把大部分人挡在门外，
 * 而这里本来就没有任何需要保护的东西。
 */
const DEMO_ACCOUNT: ServerAccount = {
  id: 1,
  username: 'demo',
  displayName: '演示账号',
  identity: 'crew',
  org: '演示剧组',
}

interface DemoState {
  runs: WorkflowRun[]
  nextId: number
}

let state: DemoState = load()

function load(): DemoState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as DemoState
      if (Array.isArray(parsed.runs) && typeof parsed.nextId === 'number') {
        // 上次会话里没跑完的任务，重新打开时直接判为已取消，避免永远停在「生成中」。
        parsed.runs = parsed.runs.map((run) =>
          run.status === 'queued' || run.status === 'running'
            ? { ...run, status: 'canceled' as RunStatus, error: '演示会话已重开' }
            : run,
        )
        return parsed
      }
    }
  } catch {
    // sessionStorage 不可用（隐私模式等）时退回内存，演示照常进行。
  }
  return { runs: [], nextId: 1 }
}

function save(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 写不进去不影响本次演示。
  }
}

function usedCredits(): number {
  return state.runs
    .filter((run) => run.status !== 'canceled')
    .reduce((sum, run) => sum + run.costCredits, 0)
}

function pendingCount(): number {
  return state.runs.filter((run) => run.status === 'queued' || run.status === 'running').length
}

function quota(): Quota {
  const used = usedCredits()
  return {
    usedCredits: used,
    limitCredits: DAILY_CREDITS,
    remainingCredits: Math.max(DAILY_CREDITS - used, 0),
    pendingRuns: pendingCount(),
    pendingLimit: PENDING_LIMIT,
    resetsAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  }
}

/**
 * 演示产出用内联 SVG，不指向任何图床。
 *
 * 演示站可能在内网或弱网环境下打开，占位图要是还得联网才显示，
 * 看到的就是一片空白，反而像功能坏了。
 */
function placeholderImage(label: string, seedText: string, index: number): string {
  let hash = 0
  for (const char of seedText) hash = (hash * 31 + char.charCodeAt(0)) % 100000
  const hue = (hash + index * 47) % 360
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="hsl(${hue},38%,26%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},32%,12%)"/>
</linearGradient></defs>
<rect width="960" height="540" fill="url(#g)"/>
<text x="480" y="268" fill="rgba(255,255,255,.88)" font-family="sans-serif" font-size="42" font-weight="700" text-anchor="middle">${label}</text>
<text x="480" y="320" fill="rgba(255,255,255,.5)" font-family="sans-serif" font-size="22" text-anchor="middle">演示产出 · 非真实生成结果</text>
</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function buildOutputs(run: WorkflowRun): RunOutput[] {
  const definition = workflowBySlug.get(run.workflowSlug)
  const seed = JSON.stringify(run.params)

  if (run.outputKind === 'text') {
    const lines = Object.entries(run.params).map(([key, value]) => {
      const input = definition?.inputs.find((item) => item.key === key)
      // 演示产出是给人看的，下拉框显示中文选项名而不是提交给模型的原始值。
      const display =
        input?.type === 'select'
          ? (input.options?.find((option) => option.value === value)?.label ?? String(value))
          : input?.type === 'toggle'
            ? value
              ? '是'
              : '否'
            : String(value)
      return `  ${input?.label ?? key}：${display}`
    })
    return [
      {
        kind: 'text',
        label: '演示产出',
        text:
          `【演示产出，非真实生成结果】\n` +
          `流水线：${run.workflowName}\n` +
          `提交参数：\n${lines.join('\n')}\n\n` +
          `接入真实算力后，这里会替换为模型返回的正文。\n` +
          `演示站没有后端，本次结果由浏览器本地生成，未产生任何算力费用。`,
      },
    ]
  }

  if (run.outputKind === 'video') {
    return [{ kind: 'video', label: '演示产出（静帧代替视频）', url: placeholderImage('镜头预演', seed, 0) }]
  }

  const requested = Number(run.params.count ?? run.params.shots ?? 1)
  const count = Math.min(Math.max(Number.isFinite(requested) ? requested : 1, 1), 4)
  return Array.from({ length: count }, (_, index) => ({
    kind: 'image' as const,
    label: `演示产出 ${index + 1}`,
    url: placeholderImage(`演示产出 ${index + 1}`, seed, index),
  }))
}

/**
 * 模拟排队与生成。
 *
 * 真实耗时按定义里的 estimatedSeconds 压缩：镜头预演真跑要三分钟，
 * 演示时没人会等，但状态流转必须完整走一遍 queued → running → succeeded，
 * 否则看的人感受不到「这是个后台任务」。
 */
function schedule(run: WorkflowRun): void {
  const definition = workflowBySlug.get(run.workflowSlug)
  const total = Math.min(2500 + (definition?.estimatedSeconds ?? 30) * 20, 8000)

  window.setTimeout(() => {
    const target = state.runs.find((item) => item.id === run.id)
    if (!target || target.status !== 'queued') return
    target.status = 'running'
    target.startedAt = new Date().toISOString()
    save()
  }, 900)

  window.setTimeout(() => {
    const target = state.runs.find((item) => item.id === run.id)
    if (!target || (target.status !== 'running' && target.status !== 'queued')) return
    target.status = 'succeeded'
    target.outputs = buildOutputs(target)
    target.finishedAt = new Date().toISOString()
    save()
  }, total)
}

export interface DemoResponse {
  status: number
  body: unknown
}

function ok(body: Record<string, unknown>): DemoResponse {
  return { status: 200, body: { ok: true, ...body } }
}

function fail(status: number, error: string, fieldErrors?: Record<string, string>): DemoResponse {
  return { status, body: { ok: false, error, ...(fieldErrors ? { fieldErrors } : {}) } }
}

function publicWorkflow(slug: string) {
  const definition = workflowBySlug.get(slug)
  if (!definition) return null
  return {
    ...definition,
    runnable: true,
    unavailableReason: null,
    usingMock: true,
    providerLabel: '演示算力（浏览器本地）',
  }
}

/**
 * 演示路由。路径与响应形状与真实后端一一对应。
 * 新增真实接口时若忘了在这里补，演示站会明确报 404，而不是静默给出假数据。
 */
export function demoRequest(path: string, method: string, body: unknown): DemoResponse {
  const [pathname] = path.split('?')
  const parts = (pathname ?? '').replace(/^\/+|\/+$/g, '').split('/')

  // /api/auth/*
  if (parts[1] === 'auth') {
    if (parts[2] === 'me') return ok({ user: DEMO_ACCOUNT })
    if (parts[2] === 'login' || parts[2] === 'register') return ok({ user: DEMO_ACCOUNT })
    if (parts[2] === 'logout' || parts[2] === 'logout-all') return ok({})
  }

  // 埋点在演示站没有去处，直接接受但不留存。
  if (parts[1] === 'events') return ok({})

  if (parts[1] !== 'workflows') return fail(404, '演示模式未实现该接口')

  // /api/workflows
  if (parts.length === 2) {
    return ok({ workflows: workflows.map((workflow) => publicWorkflow(workflow.slug)) })
  }

  // /api/workflows/quota
  if (parts[2] === 'quota') return ok({ quota: quota() })

  // /api/workflows/runs...
  if (parts[2] === 'runs') {
    if (parts.length === 3) {
      return ok({ runs: [...state.runs].sort((a, b) => b.id - a.id) })
    }
    const id = Number(parts[3])
    const run = state.runs.find((item) => item.id === id)
    if (!run) return fail(404, '任务不存在')

    if (parts[4] === 'cancel' && method === 'POST') {
      if (run.status !== 'queued' && run.status !== 'running') {
        return fail(409, `任务已是 ${run.status} 状态，无法取消`)
      }
      run.status = 'canceled'
      run.error = '用户取消'
      run.finishedAt = new Date().toISOString()
      save()
      return ok({})
    }
    return ok({ run })
  }

  // /api/workflows/:slug 与 /api/workflows/:slug/runs
  const slug = parts[2] ?? ''
  const definition = workflowBySlug.get(slug)
  if (!definition) return fail(404, '工作流不存在')

  if (parts[3] !== 'runs') return ok({ workflow: publicWorkflow(slug) })
  if (method !== 'POST') return fail(404, '演示模式未实现该接口')

  const params = ((body as { params?: unknown })?.params ?? {}) as Record<string, ParamValue>

  // 复用与真实后端同一份声明式约束，演示站的校验行为与线上一致。
  const fieldErrors = validateParams(definition, params)
  const unknownKeys = Object.keys(params).filter(
    (key) => !definition.inputs.some((input) => input.key === key),
  )
  if (unknownKeys.length > 0) fieldErrors.__form__ = `存在未定义的参数：${unknownKeys.join('、')}`
  if (Object.keys(fieldErrors).length > 0) return fail(400, '参数校验未通过', fieldErrors)

  if (pendingCount() >= PENDING_LIMIT) {
    return fail(429, `你已有 ${PENDING_LIMIT} 个任务在队列中，等其中一个结束后再提交`)
  }
  const used = usedCredits()
  if (used + definition.costCredits > DAILY_CREDITS) {
    return fail(
      429,
      `今日额度不足：已用 ${used} / ${DAILY_CREDITS}，本次需要 ${definition.costCredits}`,
    )
  }

  const run: WorkflowRun = {
    id: state.nextId++,
    workflowSlug: definition.slug,
    workflowName: definition.name,
    outputKind: definition.outputKind,
    status: 'queued',
    costCredits: definition.costCredits,
    params,
    outputs: [],
    error: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
  }
  state.runs.push(run)
  save()
  schedule(run)

  return { status: 201, body: { ok: true, run, usingMock: true } }
}

/** 清空演示数据，供横幅上的「重置」使用。 */
export function resetDemo(): void {
  state = { runs: [], nextId: 1 }
  save()
}
