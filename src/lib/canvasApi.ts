/**
 * 画布接口客户端。
 *
 * 画布只负责「图摆在哪」。生成走的仍是 `/api/workflows/:slug/runs`：
 * 局部重绘、扩图、生成变体都是 surface=canvas 的工作流，因此队列、配额、
 * provider 适配与埋点全部复用，画布这边不需要第二套执行链路。
 */
import { api } from '@/lib/portalApi'

export interface CanvasItem {
  id: number
  src: string
  label: string | null
  x: number
  y: number
  width: number
  height: number
  z: number
  /** 由哪个任务产出，可回溯当时的参数。 */
  sourceRunId: number | null
  /** 由画布上哪张图派生。重绘、扩图、变体据此形成可追溯的链。 */
  sourceItemId: number | null
  createdAt: string
}

export interface CanvasSummary {
  id: number
  name: string
  itemCount: number
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
  items: CanvasItem[]
  limits: { maxItems: number }
}

export interface NewItemInput {
  src: string
  label?: string
  x: number
  y: number
  width: number
  height: number
  sourceRunId?: number | null
  sourceItemId?: number | null
}

/** 只允许改几何与标签：换图应新增条目，否则来源链会断。 */
export type ItemPatch = Partial<Pick<CanvasItem, 'x' | 'y' | 'width' | 'height' | 'z' | 'label'>>

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

export const addCanvasItem = (canvasId: number, item: NewItemInput) =>
  api<{ item: CanvasItem }>(`/api/canvases/${canvasId}/items`, {
    method: 'POST',
    body: item,
  }).then((r) => r.item)

export const updateCanvasItem = (canvasId: number, itemId: number, patch: ItemPatch) =>
  api<{ item: CanvasItem }>(`/api/canvases/${canvasId}/items/${itemId}`, {
    method: 'PATCH',
    body: patch,
  }).then((r) => r.item)

export const deleteCanvasItem = (canvasId: number, itemId: number) =>
  api<{ ok: true }>(`/api/canvases/${canvasId}/items/${itemId}`, { method: 'DELETE' })

/**
 * 读出图片的真实宽高比，用于放到画布上时不变形。
 *
 * 读不到（跨域、链接失效）时退回 16:9：宁可比例不准，也不要因为一张图
 * 加载失败就卡住整个「加入画布」的动作。
 */
export function measureImage(src: string, targetWidth = 360): Promise<{ width: number; height: number }> {
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
    // 图片一直不响应时不能无限等，超时按默认比例放上去。
    window.setTimeout(() => done(16 / 9), 6000)
    image.src = src
  })
}
