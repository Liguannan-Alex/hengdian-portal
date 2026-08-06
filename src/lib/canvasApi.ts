/**
 * 画布接口客户端（节点图）。
 *
 * 画布只负责「有哪些节点、怎么连、参数与产出是什么」。生成走的仍是
 * `/api/workflows/:slug/runs`，因此队列、配额、provider 适配与埋点全部复用。
 */
import { api } from '@/lib/portalApi'
import type { ParamValue } from '@/data/workflows'

/** 节点类型按产出形态划分，与工作流的 outputKind 同一套口径。 */
export type NodeType = 'image' | 'video' | 'text'

export interface NodeTaskInfo {
  runId: number
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'
  error?: string | null
}

export interface NodeData {
  /** 节点标题。由动作名或素材来源自动给出，可改。 */
  label?: string
  /** image / video 节点的产出或素材。 */
  url?: string
  /** text 节点的内容。 */
  text?: string
  /**
   * 绑定的工作流 slug。没有则是素材节点（手动放上来的图或写的文本），
   * 不参与生成，只作为下游的输入。
   */
  action?: string
  params?: Record<string, ParamValue>
  taskInfo?: NodeTaskInfo
  /**
   * 上游变过、但本节点还没按新上游重跑。
   *
   * 这是节点式工具区别于图板的关键：改了上游必须让人知道下游已经不对了，
   * 否则画布上摆的就是一堆来源不明的旧图。
   */
  isStale?: boolean
  /** 最近一次成功产出的时间，用于判断上下游谁更新。 */
  producedAtMs?: number
}

export interface GraphNode {
  key: string
  type: NodeType
  x: number
  y: number
  width: number
  height: number
  z: number
  data: NodeData
  createdAt?: string
  updatedAt?: string
}

export interface GraphEdge {
  key: string
  source: string
  target: string
}

export interface CanvasSummary {
  id: number
  name: string
  nodeCount: number
  previewSrc: string | null
  createdAt: string
  updatedAt: string
}

export interface CanvasMeta {
  id: number
  name: string
  createdAt?: string
  updatedAt?: string
}

export interface CanvasDetail {
  canvas: CanvasMeta
  nodes: GraphNode[]
  edges: GraphEdge[]
  limits: { maxNodes: number; maxEdges: number }
}

export interface GraphPatch {
  upsertNodes?: GraphNode[]
  deleteNodeKeys?: string[]
  upsertEdges?: GraphEdge[]
  deleteEdgeKeys?: string[]
}

export const fetchCanvases = () =>
  api<{ canvases: CanvasSummary[]; limit: number }>('/api/canvases')

export const createCanvas = (name?: string) =>
  api<{ canvas: CanvasMeta }>('/api/canvases', { method: 'POST', body: { name } }).then(
    (r) => r.canvas,
  )

export const fetchCanvas = (id: number) => api<CanvasDetail>(`/api/canvases/${id}`)

export const renameCanvas = (id: number, name: string) =>
  api<{ canvas: CanvasMeta }>(`/api/canvases/${id}`, { method: 'PATCH', body: { name } })

export const deleteCanvas = (id: number) =>
  api<{ ok: true }>(`/api/canvases/${id}`, { method: 'DELETE' })

/**
 * 批量增删改。
 *
 * 一次拖动可能同时改动多个节点，逐个发请求既慢又容易写出交错状态。
 * 返回值是服务端的权威整图快照，前端据此对齐而不是自己推算最终状态。
 */
export const saveGraph = (canvasId: number, patch: GraphPatch) =>
  api<{ nodes: GraphNode[]; edges: GraphEdge[] }>(`/api/canvases/${canvasId}/graph/batch`, {
    method: 'POST',
    body: patch,
  })

/** 生成一个带类型前缀的稳定节点键。落库前就要能连线，所以键由前端给。 */
export function newKey(prefix: 'i' | 'v' | 't' | 'e'): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `${prefix}-${random}`
}

/**
 * 读出图片的真实宽高比，用于节点尺寸不变形。
 *
 * 读不到（跨域、链接失效）时退回 16:9：宁可比例不准，也不要因为一张图
 * 加载失败就卡住整个「加入节点」的动作。
 */
export function measureImage(
  src: string,
  targetWidth = 320,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image()
    let settled = false
    const done = (ratio: number) => {
      if (settled) return
      settled = true
      resolve({ width: targetWidth, height: Math.round(targetWidth / ratio) })
    }
    image.onload = () => done(image.naturalWidth / image.naturalHeight || 16 / 9)
    image.onerror = () => done(16 / 9)
    window.setTimeout(() => done(16 / 9), 6000)
    image.src = src
  })
}
