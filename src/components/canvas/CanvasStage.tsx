/**
 * 画布舞台：平移、缩放、拖拽、缩放角柄、框选。
 *
 * 坐标分两套。世界坐标是图在画布上的位置，存进数据库；屏幕坐标是它现在
 * 显示在哪。两者用 viewport {x, y, scale} 换算。所有交互都在世界坐标里算，
 * 这样缩放到 30% 时拖动的距离才不会对不上。
 *
 * 用 DOM + CSS transform 而不是 Canvas 2D：图片数量是百张量级，DOM 完全够用，
 * 而且能直接拿到无障碍语义、右键菜单和图片的懒加载，Canvas 这些都得自己造。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CanvasItem } from '@/lib/canvasApi'
import { cn } from '@/lib/utils'

export interface Viewport {
  x: number
  y: number
  scale: number
}

/** 选区，单位是相对所属图片的百分比——与后端 regionX/Y/W/H 的口径一致。 */
export interface Region {
  itemId: number
  x: number
  y: number
  w: number
  h: number
}

export type StageTool = 'select' | 'region'

export interface CanvasStageProps {
  items: CanvasItem[]
  selectedId: number | null
  tool: StageTool
  viewport: Viewport
  region: Region | null
  /** 正在生成中的图，显示遮罩与提示。 */
  busyItemIds?: number[]
  onViewportChange: (viewport: Viewport) => void
  onSelect: (id: number | null) => void
  /** 拖动/缩放结束时才回调，过程中不打接口。 */
  onCommitGeometry: (id: number, patch: { x?: number; y?: number; width?: number; height?: number }) => void
  onRegionChange: (region: Region | null) => void
}

const MIN_SCALE = 0.1
const MAX_SCALE = 3
const MIN_ITEM_SIZE = 48

interface DragState {
  kind: 'pan' | 'move' | 'resize' | 'region'
  pointerId: number
  startX: number
  startY: number
  origin: { x: number; y: number; width: number; height: number }
  itemId?: number
}

export function CanvasStage({
  items,
  selectedId,
  tool,
  viewport,
  region,
  busyItemIds = [],
  onViewportChange,
  onSelect,
  onCommitGeometry,
  onRegionChange,
}: CanvasStageProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  /** 拖动过程中的本地几何，避免每帧都往上层灌状态。 */
  const [draft, setDraft] = useState<{ id: number; x: number; y: number; width: number; height: number } | null>(null)
  const busy = new Set(busyItemIds)

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return {
        x: (clientX - rect.left - viewport.x) / viewport.scale,
        y: (clientY - rect.top - viewport.y) / viewport.scale,
      }
    },
    [viewport],
  )

  /**
   * 缩放围绕鼠标位置进行：以画布中心缩放的话，放大后想看的地方往往已经跑出屏幕。
   */
  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return
      const nextScale = Math.min(Math.max(viewport.scale * factor, MIN_SCALE), MAX_SCALE)
      if (nextScale === viewport.scale) return
      const px = clientX - rect.left
      const py = clientY - rect.top
      const ratio = nextScale / viewport.scale
      onViewportChange({
        x: px - (px - viewport.x) * ratio,
        y: py - (py - viewport.y) * ratio,
        scale: nextScale,
      })
    },
    [viewport, onViewportChange],
  )

  // 滚轮：默认平移，按住 ctrl / cmd 缩放（与主流画布工具一致）。
  // 必须用非 passive 监听，否则 preventDefault 无效，页面会跟着一起滚。
  useEffect(() => {
    const element = rootRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) {
        zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 1 / 1.12)
        return
      }
      onViewportChange({ ...viewport, x: viewport.x - event.deltaX, y: viewport.y - event.deltaY })
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [viewport, zoomAt, onViewportChange])

  const itemById = (id: number) => items.find((item) => item.id === id) ?? null

  const beginDrag = (event: React.PointerEvent, state: Omit<DragState, 'pointerId'>) => {
    ;(event.target as Element).setPointerCapture?.(event.pointerId)
    dragRef.current = { ...state, pointerId: event.pointerId }
  }

  const handleBackgroundPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return
    onSelect(null)
    onRegionChange(null)
    beginDrag(event, {
      kind: 'pan',
      startX: event.clientX,
      startY: event.clientY,
      origin: { x: viewport.x, y: viewport.y, width: 0, height: 0 },
    })
  }

  const handleItemPointerDown = (event: React.PointerEvent, item: CanvasItem) => {
    if (event.button !== 0) return
    event.stopPropagation()
    onSelect(item.id)

    if (tool === 'region') {
      const world = toWorld(event.clientX, event.clientY)
      onRegionChange({
        itemId: item.id,
        x: ((world.x - item.x) / item.width) * 100,
        y: ((world.y - item.y) / item.height) * 100,
        w: 0,
        h: 0,
      })
      beginDrag(event, {
        kind: 'region',
        startX: event.clientX,
        startY: event.clientY,
        origin: { x: item.x, y: item.y, width: item.width, height: item.height },
        itemId: item.id,
      })
      return
    }

    onRegionChange(null)
    beginDrag(event, {
      kind: 'move',
      startX: event.clientX,
      startY: event.clientY,
      origin: { x: item.x, y: item.y, width: item.width, height: item.height },
      itemId: item.id,
    })
  }

  const handleResizePointerDown = (event: React.PointerEvent, item: CanvasItem) => {
    if (event.button !== 0) return
    event.stopPropagation()
    onSelect(item.id)
    onRegionChange(null)
    beginDrag(event, {
      kind: 'resize',
      startX: event.clientX,
      startY: event.clientY,
      origin: { x: item.x, y: item.y, width: item.width, height: item.height },
      itemId: item.id,
    })
  }

  const handlePointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return

    const dx = (event.clientX - drag.startX) / viewport.scale
    const dy = (event.clientY - drag.startY) / viewport.scale

    if (drag.kind === 'pan') {
      onViewportChange({
        ...viewport,
        x: drag.origin.x + (event.clientX - drag.startX),
        y: drag.origin.y + (event.clientY - drag.startY),
      })
      return
    }

    if (drag.kind === 'move' && drag.itemId !== undefined) {
      setDraft({
        id: drag.itemId,
        x: drag.origin.x + dx,
        y: drag.origin.y + dy,
        width: drag.origin.width,
        height: drag.origin.height,
      })
      return
    }

    if (drag.kind === 'resize' && drag.itemId !== undefined) {
      // 等比缩放：图片被拉变形在概念图评审里毫无用处。
      const ratio = drag.origin.width / drag.origin.height
      const width = Math.max(drag.origin.width + dx, MIN_ITEM_SIZE)
      setDraft({
        id: drag.itemId,
        x: drag.origin.x,
        y: drag.origin.y,
        width,
        height: Math.max(width / ratio, MIN_ITEM_SIZE / ratio),
      })
      return
    }

    if (drag.kind === 'region' && drag.itemId !== undefined) {
      const world = toWorld(event.clientX, event.clientY)
      const startWorld = toWorld(drag.startX, drag.startY)
      const x1 = ((Math.min(startWorld.x, world.x) - drag.origin.x) / drag.origin.width) * 100
      const y1 = ((Math.min(startWorld.y, world.y) - drag.origin.y) / drag.origin.height) * 100
      const x2 = ((Math.max(startWorld.x, world.x) - drag.origin.x) / drag.origin.width) * 100
      const y2 = ((Math.max(startWorld.y, world.y) - drag.origin.y) / drag.origin.height) * 100
      // 选区不能超出图片本身，否则送到算力方的是一块不存在的区域。
      const left = Math.min(Math.max(x1, 0), 100)
      const top = Math.min(Math.max(y1, 0), 100)
      onRegionChange({
        itemId: drag.itemId,
        x: left,
        y: top,
        w: Math.min(Math.max(x2, 0), 100) - left,
        h: Math.min(Math.max(y2, 0), 100) - top,
      })
    }
  }

  const handlePointerUp = () => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return

    if ((drag.kind === 'move' || drag.kind === 'resize') && draft && drag.itemId !== undefined) {
      const item = itemById(drag.itemId)
      // 没有实际位移就不发请求，点一下选中不该产生一次写入。
      if (
        item &&
        (Math.abs(item.x - draft.x) > 0.5 ||
          Math.abs(item.y - draft.y) > 0.5 ||
          Math.abs(item.width - draft.width) > 0.5)
      ) {
        onCommitGeometry(drag.itemId, {
          x: Math.round(draft.x),
          y: Math.round(draft.y),
          width: Math.round(draft.width),
          height: Math.round(draft.height),
        })
      }
    }
    setDraft(null)

    if (drag.kind === 'region' && region && (region.w < 2 || region.h < 2)) {
      // 只是点了一下而没有拖出面积，视为取消，不留一个 0 尺寸的选区。
      onRegionChange(null)
    }
  }

  const geometryOf = (item: CanvasItem) =>
    draft && draft.id === item.id
      ? { x: draft.x, y: draft.y, width: draft.width, height: draft.height }
      : { x: item.x, y: item.y, width: item.width, height: item.height }

  return (
    <div
      ref={rootRef}
      className={cn(
        'relative h-full w-full overflow-hidden rounded-xl border border-border bg-[hsl(var(--ink))] select-none',
        // 网格背景让平移与缩放有参照，否则空白画布上拖动毫无反馈。
        'bg-[radial-gradient(circle,hsl(var(--paper)/0.08)_1px,transparent_1px)] [background-size:24px_24px]',
        tool === 'region' ? 'cursor-crosshair' : 'cursor-grab',
      )}
      onPointerDown={handleBackgroundPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      role="application"
      aria-label="画布"
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
        }}
      >
        {items.map((item) => {
          const geometry = geometryOf(item)
          const selected = item.id === selectedId
          const isBusy = busy.has(item.id)

          return (
            <div
              key={item.id}
              className={cn(
                'absolute',
                selected ? 'outline outline-2 outline-offset-2 outline-[hsl(var(--gold))]' : '',
              )}
              style={{
                left: geometry.x,
                top: geometry.y,
                width: geometry.width,
                height: geometry.height,
                zIndex: item.z,
              }}
              onPointerDown={(event) => handleItemPointerDown(event, item)}
            >
              <img
                src={item.src}
                alt={item.label ?? '画布图片'}
                draggable={false}
                loading="lazy"
                className="h-full w-full rounded-sm object-cover shadow-lg shadow-black/40"
              />

              {isBusy && (
                <div className="absolute inset-0 flex items-center justify-center rounded-sm bg-ink/70 text-xs text-paper">
                  生成中…
                </div>
              )}

              {item.label && (
                <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-ink/70 px-1.5 py-0.5 text-[0.6rem] text-paper/85">
                  {item.label}
                </span>
              )}

              {region && region.itemId === item.id && region.w > 0 && region.h > 0 && (
                <div
                  className="pointer-events-none absolute border-2 border-dashed border-[hsl(var(--gold))] bg-[hsl(var(--gold))]/15"
                  style={{
                    left: `${region.x}%`,
                    top: `${region.y}%`,
                    width: `${region.w}%`,
                    height: `${region.h}%`,
                  }}
                />
              )}

              {selected && tool === 'select' && (
                <button
                  type="button"
                  aria-label="缩放图片"
                  onPointerDown={(event) => handleResizePointerDown(event, item)}
                  className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-sm border border-ink bg-[hsl(var(--gold))]"
                  style={{ transform: `scale(${1 / viewport.scale})`, transformOrigin: 'bottom right' }}
                />
              )}
            </div>
          )
        })}
      </div>

      {items.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">
            画布是空的。用右上角「加入图片」从任务产出或链接添加第一张图。
          </p>
        </div>
      )}
    </div>
  )
}
