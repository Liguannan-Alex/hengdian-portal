/**
 * 第三方算力提供方（提交—轮询型异步作业）。
 *
 * 重要口径：这里的字段映射是按「提交返回作业号、轮询返回状态与产出」这一
 * 通用形态写的，**尚未与厂商的正式接口文档逐字段核对**。接入前必须拿到对方
 * 的接口契约，核对下面四个映射项后再启用；未配置凭据时该提供方对外报告为
 * 未接入，工作流不会接受提交，也就不会产生「提交后才发现字段对不上」的失败单。
 *
 * 之所以做成配置驱动而不是写死：横店侧的算力可能由不同供应商承接（PRD 提到
 * 与嘉环等供应商的边界待书面明确），字段名换一次不该改一次代码。
 *
 * 需要的环境变量：
 *   WORKFLOW_LIBLIB_BASE_URL      接口根地址
 *   WORKFLOW_LIBLIB_API_KEY       鉴权密钥，作为 Bearer 发送
 *   WORKFLOW_LIBLIB_SUBMIT_PATH   提交路径，默认 /api/generate
 *   WORKFLOW_LIBLIB_STATUS_PATH   轮询路径模板，默认 /api/generate/{jobId}
 *   WORKFLOW_LIBLIB_JOB_ID_FIELD  提交响应里作业号的字段路径，默认 data.generateUuid
 *   WORKFLOW_LIBLIB_STATUS_FIELD  轮询响应里状态的字段路径，默认 data.generateStatus
 *   WORKFLOW_LIBLIB_OUTPUT_FIELD  轮询响应里产出数组的字段路径，默认 data.images
 *   WORKFLOW_LIBLIB_SUCCESS_VALUES 判定成功的状态值，逗号分隔，默认 5,success,succeeded
 *   WORKFLOW_LIBLIB_FAILURE_VALUES 判定失败的状态值，逗号分隔，默认 6,7,failed,error
 */
import type { ProviderJobRequest, ProviderOutput, ProviderResult, WorkflowProvider } from './types.ts'

const REQUEST_TIMEOUT_MS = 30_000

function env(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback
}

function valuesOf(name: string, fallback: string): Set<string> {
  return new Set(
    env(name, fallback)
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )
}

/** 按 `a.b.c` 取值。取不到返回 undefined，不抛错，交给调用方给出可读错误。 */
function pick(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current && typeof current === 'object' && segment in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[segment]
    }
    return undefined
  }, source)
}

async function callJson(
  path: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
  const base = env('WORKFLOW_LIBLIB_BASE_URL').replace(/\/+$/, '')
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  // 用户取消与请求超时都要能中断连接，合并成一个信号。
  const composite = AbortSignal.any([signal, timeout])

  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      signal: composite,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env('WORKFLOW_LIBLIB_API_KEY')}`,
        ...(init.headers ?? {}),
      },
    })
  } catch (error) {
    if (signal.aborted) throw error
    return { ok: false, error: `算力方请求失败：${(error as Error).message}` }
  }

  const text = await response.text()
  if (!response.ok) {
    // 不把对方响应体原样透出给终端用户，只保留状态码与截断片段供运维排查。
    return { ok: false, error: `算力方返回 ${response.status}：${text.slice(0, 200)}` }
  }
  try {
    return { ok: true, body: JSON.parse(text) as unknown }
  } catch {
    return { ok: false, error: '算力方返回的不是合法 JSON' }
  }
}

/** 产出数组可能是字符串数组，也可能是对象数组。两种都接住。 */
function toOutputs(raw: unknown, kind: ProviderJobRequest['outputKind']): ProviderOutput[] {
  const list = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw]
  const outputs: ProviderOutput[] = []

  for (const item of list) {
    if (typeof item === 'string') {
      outputs.push(kind === 'text' ? { kind: 'text', text: item } : { kind, url: item })
      continue
    }
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>
      const url = [record.imageUrl, record.videoUrl, record.url, record.output]
        .find((value) => typeof value === 'string' && value)
      const text = [record.text, record.content].find((value) => typeof value === 'string' && value)
      if (kind === 'text' && typeof text === 'string') {
        outputs.push({ kind: 'text', text })
      } else if (typeof url === 'string') {
        outputs.push({ kind, url })
      }
    }
  }
  return outputs
}

function classify(status: unknown): 'succeeded' | 'failed' | 'pending' {
  const value = String(status ?? '').toLowerCase()
  if (valuesOf('WORKFLOW_LIBLIB_SUCCESS_VALUES', '5,success,succeeded').has(value)) return 'succeeded'
  if (valuesOf('WORKFLOW_LIBLIB_FAILURE_VALUES', '6,7,failed,error').has(value)) return 'failed'
  return 'pending'
}

export const liblibProvider: WorkflowProvider = {
  key: 'liblib',
  label: '第三方 AIGC 算力（提交—轮询）',

  isConfigured() {
    return Boolean(env('WORKFLOW_LIBLIB_BASE_URL') && env('WORKFLOW_LIBLIB_API_KEY'))
  },

  async submit(request: ProviderJobRequest): Promise<ProviderResult> {
    const result = await callJson(
      env('WORKFLOW_LIBLIB_SUBMIT_PATH', '/api/generate'),
      {
        method: 'POST',
        body: JSON.stringify({
          templateUuid: request.providerRef,
          // 本地任务号带过去，方便双方对账，也可作为对方的幂等键。
          clientRequestId: `hd-portal-${request.runId}`,
          generateParams: request.params,
        }),
      },
      request.signal,
    )
    if (!result.ok) return { state: 'failed', providerJobId: null, error: result.error }

    const jobId = pick(result.body, env('WORKFLOW_LIBLIB_JOB_ID_FIELD', 'data.generateUuid'))
    if (typeof jobId !== 'string' || !jobId) {
      return { state: 'failed', providerJobId: null, error: '算力方未返回作业号，请核对字段映射配置' }
    }
    return { state: 'pending', providerJobId: jobId }
  },

  async poll(providerJobId: string, request: ProviderJobRequest): Promise<ProviderResult> {
    const path = env('WORKFLOW_LIBLIB_STATUS_PATH', '/api/generate/{jobId}').replace(
      '{jobId}',
      encodeURIComponent(providerJobId),
    )
    const result = await callJson(path, { method: 'GET' }, request.signal)
    if (!result.ok) return { state: 'failed', providerJobId, error: result.error }

    const status = pick(result.body, env('WORKFLOW_LIBLIB_STATUS_FIELD', 'data.generateStatus'))
    const verdict = classify(status)

    if (verdict === 'pending') return { state: 'pending', providerJobId }
    if (verdict === 'failed') {
      return { state: 'failed', providerJobId, error: `算力方报告任务失败（状态 ${String(status)}）` }
    }

    const outputs = toOutputs(
      pick(result.body, env('WORKFLOW_LIBLIB_OUTPUT_FIELD', 'data.images')),
      request.outputKind,
    )
    if (outputs.length === 0) {
      return { state: 'failed', providerJobId, error: '算力方报告成功但未返回产出，请核对字段映射配置' }
    }
    return { state: 'succeeded', providerJobId, outputs }
  },
}
