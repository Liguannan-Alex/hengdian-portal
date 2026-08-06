/**
 * 画布操作面板：把「选中的图 + 选区」变成一次工作流运行。
 *
 * 面板只渲染用户需要填的字段——sourceUrl 与选区坐标由画布填入，在定义里
 * 标了 supplied=canvas。这样新增一个画布操作仍然只改 JSON。
 */
import { useState } from 'react'
import { Loader2, Play, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { WorkflowField } from '@/components/WorkflowField'
import {
  defaultParams,
  editableInputs,
  validateParams,
  type ParamValue,
  type WorkflowDefinition,
} from '@/data/workflows'
import type { CanvasItem } from '@/lib/canvasApi'
import type { Region } from '@/components/canvas/CanvasStage'

export interface CanvasOpPanelProps {
  workflow: WorkflowDefinition
  item: CanvasItem
  region: Region | null
  submitting: boolean
  disabledReason: string | null
  serverErrors: Record<string, string>
  onCancel: () => void
  onSubmit: (params: Record<string, ParamValue>) => void
}

/** 画布自动填入的参数。集中在这里，操作面板不需要知道各字段的业务含义。 */
function suppliedParams(item: CanvasItem, region: Region | null): Record<string, ParamValue> {
  const params: Record<string, ParamValue> = { sourceUrl: item.src }
  if (region) {
    // 保留一位小数：坐标再精确也超不过一个像素，多余的位数只会让参数难读。
    params.regionX = Number(region.x.toFixed(1))
    params.regionY = Number(region.y.toFixed(1))
    params.regionW = Number(region.w.toFixed(1))
    params.regionH = Number(region.h.toFixed(1))
  }
  return params
}

export function CanvasOpPanel({
  workflow,
  item,
  region,
  submitting,
  disabledReason,
  serverErrors,
  onCancel,
  onSubmit,
}: CanvasOpPanelProps) {
  const [params, setParams] = useState<Record<string, ParamValue>>(() => defaultParams(workflow))
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [attempted, setAttempted] = useState(false)

  const fields = editableInputs(workflow)
  const merged = { ...params, ...suppliedParams(item, region) }
  const errors = validateParams(workflow, merged)

  const errorFor = (key: string) => {
    if (serverErrors[key]) return serverErrors[key]
    if (!attempted && !touched[key]) return null
    return errors[key] ?? null
  }

  // 画布自动填的字段出错，说明选区没画或图有问题，用户在表单里找不到对应输入框。
  const suppliedError = Object.keys(errors).find((key) =>
    workflow.inputs.some((input) => input.key === key && input.supplied === 'canvas'),
  )

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    setAttempted(true)
    if (Object.keys(errors).length > 0) return
    onSubmit(merged)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="glass-panel space-y-4 rounded-xl border border-border p-4 shadow-xl shadow-black/40"
      noValidate
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-paper">{workflow.name}</h3>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{workflow.summary}</p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="关闭操作面板"
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {region && region.w > 0 && region.h > 0 && (
        <p className="rounded-md border border-gold/20 bg-gold/[0.07] px-2.5 py-1.5 text-xs text-gold-soft">
          已框选：距左 {region.x.toFixed(0)}%、距上 {region.y.toFixed(0)}%，
          宽 {region.w.toFixed(0)}%、高 {region.h.toFixed(0)}%
        </p>
      )}

      {fields.map((input) => (
        <WorkflowField
          key={input.key}
          input={input}
          idPrefix="canvas-op-"
          compact
          value={params[input.key] ?? ''}
          error={errorFor(input.key)}
          onChange={(next) => setParams((prev) => ({ ...prev, [input.key]: next }))}
          onBlur={() => setTouched((prev) => ({ ...prev, [input.key]: true }))}
        />
      ))}

      {attempted && suppliedError && (
        <p className="text-xs font-medium text-destructive" role="alert">
          {errors[suppliedError]}
          {suppliedError.startsWith('region') && '（请先在图上框出要修改的区域）'}
        </p>
      )}

      {serverErrors.__form__ && (
        <p className="text-xs font-medium text-destructive" role="alert">
          {serverErrors.__form__}
        </p>
      )}

      <Button type="submit" size="sm" className="w-full" disabled={submitting || Boolean(disabledReason)}>
        {submitting ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Play className="mr-1.5 h-4 w-4" aria-hidden="true" />
        )}
        {submitting ? '提交中…' : `运行（${workflow.costCredits} 点）`}
      </Button>

      {disabledReason && (
        <p className="text-xs text-muted-foreground" role="status">
          {disabledReason}
        </p>
      )}
    </form>
  )
}
