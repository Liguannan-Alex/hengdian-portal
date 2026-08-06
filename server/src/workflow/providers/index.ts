/**
 * 提供方注册表与可用性判定。
 *
 * 一条工作流是否可提交，取决于它声明的 provider 当下是否配齐凭据。
 * 没配齐时对外报告「算力未接入」并挡在提交之前——让用户提交后再收到
 * 一条失败任务，既浪费等待也污染成功率统计。
 *
 * WORKFLOW_ALLOW_MOCK 为 true（默认）时，未接入的提供方回落到演示算力，
 * 使编排层在拿到正式凭据前可以完整演示。线上必须置为 false。
 */
import { liblibProvider } from './liblib.ts'
import { mockProvider } from './mock.ts'
import type { WorkflowProvider } from './types.ts'

const registry = new Map<string, WorkflowProvider>(
  [mockProvider, liblibProvider].map((provider) => [provider.key, provider]),
)

export type ProviderAvailability =
  | { available: true; provider: WorkflowProvider; usingMock: boolean; reason: null }
  | { available: false; provider: null; usingMock: false; reason: string }

export function providerFor(key: string): ProviderAvailability {
  const declared = registry.get(key)
  if (!declared) {
    return { available: false, provider: null, usingMock: false, reason: `未知的算力来源：${key}` }
  }
  if (declared.isConfigured()) {
    return { available: true, provider: declared, usingMock: declared.key === 'mock', reason: null }
  }
  if (mockProvider.isConfigured()) {
    return { available: true, provider: mockProvider, usingMock: true, reason: null }
  }
  return {
    available: false,
    provider: null,
    usingMock: false,
    reason: '算力未接入：该工作流所需的第三方凭据尚未配置',
  }
}

export function providerLabel(key: string): string {
  return registry.get(key)?.label ?? key
}

export type { WorkflowProvider }
