/**
 * 算力提供方适配接口。
 *
 * 门户 PRD v0.2 明确「不做 GPU 调度、大模型训练」，因此本层只负责派单与轮询，
 * 真正的计算在第三方。所有提供方收敛到同一个二段式接口：
 *
 *   submit  提交任务，返回对方的作业号；能同步出结果的提供方直接返回终态。
 *   poll    按作业号查询进度，返回终态或继续等待。
 *
 * 换供应商时只新增一个实现，队列、路由、前端都不动。
 */
export interface ProviderJobRequest {
  /** 本地任务号，用于日志与对方的幂等键。 */
  runId: number
  /** 定义文件里的 providerRef，交给提供方决定跑哪条流水线。 */
  providerRef: string
  outputKind: 'image' | 'video' | 'text'
  params: Record<string, string | number | boolean>
  signal: AbortSignal
}

export interface ProviderOutput {
  kind: 'image' | 'video' | 'text'
  /** 图片与视频给可访问链接；文本给内容本身。 */
  url?: string
  text?: string
  label?: string
}

export type ProviderResult =
  | { state: 'pending'; providerJobId: string }
  | { state: 'succeeded'; providerJobId: string; outputs: ProviderOutput[] }
  | { state: 'failed'; providerJobId: string | null; error: string }

export interface WorkflowProvider {
  key: string
  /** 展示名，用于「算力来源」说明与运维排查。 */
  label: string
  /**
   * 凭据是否齐备。返回 false 时该提供方下的工作流对外显示为「算力未接入」，
   * 而不是让用户提交后收到一条失败任务。
   */
  isConfigured(): boolean
  submit(request: ProviderJobRequest): Promise<ProviderResult>
  poll(providerJobId: string, request: ProviderJobRequest): Promise<ProviderResult>
  /** 可选：向对方撤单。未实现时本地仍会标记取消。 */
  cancel?(providerJobId: string): Promise<void>
}
