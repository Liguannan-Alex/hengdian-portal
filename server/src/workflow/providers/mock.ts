/**
 * 演示用算力提供方。
 *
 * 存在的理由：编排层（表单、队列、配额、结果页、埋点）需要在还没拿到任何
 * 外部算力凭据之前就能整条跑通并演示。它不调用任何外部服务，也不产生费用。
 *
 * 产出是占位内容，明确标注「演示产出」，避免被误当成真实生成结果。
 * 线上环境必须设 WORKFLOW_ALLOW_MOCK=false 关掉它。
 */
import { createHash } from 'node:crypto'
import type { ProviderJobRequest, ProviderResult, WorkflowProvider } from './types.ts'

/** 演示产出的等待时长。设小值让本地联调不必真等，设 0 则立即返回。 */
function mockDelayMs(): number {
  const raw = Number(process.env.WORKFLOW_MOCK_DELAY_MS ?? 1500)
  return Number.isFinite(raw) && raw >= 0 ? Math.min(raw, 60_000) : 1500
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('任务已取消'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** 同样的参数得到同样的占位图，便于人工比对「参数改了产出是否跟着变」。 */
function seedOf(request: ProviderJobRequest): string {
  return createHash('sha256')
    .update(`${request.providerRef}|${JSON.stringify(request.params)}`)
    .digest('hex')
    .slice(0, 12)
}

/**
 * 占位图用内联 SVG，不指向任何外部图床。
 *
 * 演示算力的用途就是在没有外部依赖的环境里把编排层跑通；如果占位图还要
 * 联网才能显示，在内网或断网演示时就会看到一片空白，反而像是功能坏了。
 */
function placeholderImage(seed: string, index: number): string {
  const hue = (parseInt(seed.slice(0, 4), 16) + index * 47) % 360
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="hsl(${hue},38%,26%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},32%,12%)"/>
</linearGradient></defs>
<rect width="960" height="540" fill="url(#g)"/>
<text x="480" y="262" fill="rgba(255,255,255,.86)" font-family="sans-serif" font-size="40" font-weight="700" text-anchor="middle">演示产出 ${index + 1}</text>
<text x="480" y="308" fill="rgba(255,255,255,.55)" font-family="monospace" font-size="22" text-anchor="middle">${seed}</text>
<text x="480" y="352" fill="rgba(255,255,255,.45)" font-family="sans-serif" font-size="20" text-anchor="middle">非真实生成结果</text>
</svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
}

function summarizeParams(params: Record<string, string | number | boolean>): string {
  return Object.entries(params)
    .map(([key, value]) => `  ${key}: ${String(value).slice(0, 120)}`)
    .join('\n')
}

export const mockProvider: WorkflowProvider = {
  key: 'mock',
  label: '演示算力（不调用外部服务）',

  isConfigured() {
    return process.env.WORKFLOW_ALLOW_MOCK !== 'false'
  },

  async submit(request: ProviderJobRequest): Promise<ProviderResult> {
    const providerJobId = `mock-${request.runId}-${seedOf(request)}`
    await sleep(mockDelayMs(), request.signal)

    const seed = seedOf(request)
    const countParam = request.params.count ?? request.params.shots ?? 1
    const count = Math.min(Math.max(Number(countParam) || 1, 1), 4)

    if (request.outputKind === 'text') {
      return {
        state: 'succeeded',
        providerJobId,
        outputs: [
          {
            kind: 'text',
            label: '演示产出',
            text:
              `【演示产出，非真实生成结果】\n` +
              `流水线：${request.providerRef}\n` +
              `提交参数：\n${summarizeParams(request.params)}\n\n` +
              `接入真实算力后，这里会替换为模型返回的正文。`,
          },
        ],
      }
    }

    if (request.outputKind === 'video') {
      return {
        state: 'succeeded',
        providerJobId,
        outputs: [
          {
            kind: 'video',
            label: '演示产出（静帧代替视频）',
            url: placeholderImage(seed, 0),
          },
        ],
      }
    }

    return {
      state: 'succeeded',
      providerJobId,
      outputs: Array.from({ length: count }, (_, index) => ({
        kind: 'image' as const,
        label: `演示产出 ${index + 1}`,
        url: placeholderImage(seed, index),
      })),
    }
  },

  async poll(providerJobId: string): Promise<ProviderResult> {
    // submit 已返回终态，正常不会走到这里；留一个明确失败好过静默挂起。
    return { state: 'failed', providerJobId, error: '演示算力不应进入轮询状态' }
  },
}
