/**
 * 选区拾取器。
 *
 * 局部重绘需要「改哪一块」。图板时代是在画布上直接框选，节点画布里没有那个
 * 自由平面了，于是把选区收进检视面板：显示上游那张图，在它上面拖出范围。
 * 这样选区明确属于「这个重绘节点」，而不是一个飘在画布上的临时状态。
 */
import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export interface RegionValue {
  x: number
  y: number
  w: number
  h: number
}

export interface RegionPickerProps {
  src: string
  value: RegionValue
  onChange: (value: RegionValue) => void
}

export function RegionPicker({ src, value, onChange }: RegionPickerProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const toPercent = (clientX: number, clientY: number) => {
    const rect = frameRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: Math.min(Math.max(((clientX - rect.left) / rect.width) * 100, 0), 100),
      y: Math.min(Math.max(((clientY - rect.top) / rect.height) * 100, 0), 100),
    }
  }

  const handlePointerDown = (event: React.PointerEvent) => {
    event.preventDefault()
    ;(event.target as Element).setPointerCapture?.(event.pointerId)
    startRef.current = toPercent(event.clientX, event.clientY)
    setDragging(true)
    onChange({ ...startRef.current, w: 0, h: 0 })
  }

  const handlePointerMove = (event: React.PointerEvent) => {
    const start = startRef.current
    if (!start || !dragging) return
    const current = toPercent(event.clientX, event.clientY)
    onChange({
      x: Math.min(start.x, current.x),
      y: Math.min(start.y, current.y),
      w: Math.abs(current.x - start.x),
      h: Math.abs(current.y - start.y),
    })
  }

  const handlePointerUp = () => {
    setDragging(false)
    startRef.current = null
  }

  const hasRegion = value.w >= 1 && value.h >= 1

  return (
    <div className="space-y-1.5">
      <div
        ref={frameRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="relative w-full cursor-crosshair select-none overflow-hidden rounded-md border border-border"
        role="application"
        aria-label="在图上框出要修改的区域"
      >
        <img src={src} alt="" draggable={false} className="pointer-events-none w-full object-contain" />
        {hasRegion && (
          <div
            className="pointer-events-none absolute border-2 border-dashed border-[hsl(var(--gold))] bg-[hsl(var(--gold))]/20"
            style={{
              left: `${value.x}%`,
              top: `${value.y}%`,
              width: `${value.w}%`,
              height: `${value.h}%`,
            }}
          />
        )}
      </div>
      <p className={cn('text-xs', hasRegion ? 'text-muted-foreground' : 'text-amber-300')}>
        {hasRegion
          ? `已框选：距左 ${value.x.toFixed(0)}%、距上 ${value.y.toFixed(0)}%，宽 ${value.w.toFixed(0)}%、高 ${value.h.toFixed(0)}%`
          : '在图上拖出要修改的范围'}
      </p>
    </div>
  )
}
