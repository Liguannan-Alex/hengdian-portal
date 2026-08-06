/**
 * 画布编辑器。
 *
 * 三件事在这里合流：画布的图（canvasApi）、画布上的操作（surface=canvas 的
 * 工作流）、以及运行结果落回画布。生成本身不在这里实现——提交仍走
 * `/api/workflows/:slug/runs`，因此队列、配额、算力适配与埋点都是既有那一套。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  BringToFront,
  Crop,
  Frame,
  ImagePlus,
  Layers,
  Loader2,
  Maximize2,
  MousePointer2,
  Pencil,
  Shuffle,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DemoBanner } from '@/components/DemoBanner'
import { ServerAccountBar, ServerAccountGate } from '@/components/ServerAccountGate'
import { CanvasStage, type Region, type StageTool, type Viewport } from '@/components/canvas/CanvasStage'
import { CanvasOpPanel } from '@/components/canvas/CanvasOpPanel'
import {
  addCanvasItem,
  deleteCanvasItem,
  fetchCanvas,
  measureImage,
  renameCanvas,
  updateCanvasItem,
  type CanvasItem,
  type CanvasMeta,
} from '@/lib/canvasApi'
import {
  ApiError,
  fetchQuota,
  fetchRun,
  fetchRuns,
  isTerminal,
  submitRun,
  type Quota,
  type WorkflowRun,
} from '@/lib/portalApi'
import { canvasWorkflows, type ParamValue, type WorkflowDefinition } from '@/data/workflows'
import { cn } from '@/lib/utils'

const POLL_MS = 2000

const OP_ICONS: Record<string, typeof Pencil> = {
  'canvas-inpaint': Pencil,
  'canvas-outpaint': Maximize2,
  'canvas-variation': Shuffle,
}

/** 局部重绘必须先有选区；其余操作选中一张图即可。 */
const NEEDS_REGION = new Set(['canvas-inpaint'])

interface PendingRun {
  runId: number
  sourceItem: CanvasItem
  workflowName: string
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

const GAP = 24

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width + GAP / 2 &&
    a.x + a.width + GAP / 2 > b.x &&
    a.y < b.y + b.height + GAP / 2 &&
    a.y + a.height + GAP / 2 > b.y
  )
}

/**
 * 找一个不压住任何已有图的落点。
 *
 * 产出默认摆在原图右侧以保持「从这张图改出来的」空间关系，但那个位置常常
 * 已经有图了。直接放上去会盖住别人的图，且因为 z 更高，被盖的那张要拖开
 * 才能看见——看上去像图丢了。这里沿纵向找到第一个空位。
 */
function findFreeSpot(items: Box[], preferred: Box): { x: number; y: number } {
  const candidate = { ...preferred }
  // 上限防御：画布最多百来张图，正常几步就能找到空位，不会真的走满。
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (!items.some((item) => overlaps(candidate, item))) break
    candidate.y += candidate.height + GAP
  }
  return { x: candidate.x, y: candidate.y }
}

function CanvasWorkspace({ canvasId }: { canvasId: number }) {
  const [meta, setMeta] = useState<CanvasMeta | null>(null)
  const [items, setItems] = useState<CanvasItem[]>([])
  const [maxItems, setMaxItems] = useState(120)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [viewport, setViewport] = useState<Viewport>({ x: 80, y: 60, scale: 1 })
  const [tool, setTool] = useState<StageTool>('select')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [region, setRegion] = useState<Region | null>(null)

  const [activeOp, setActiveOp] = useState<WorkflowDefinition | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<PendingRun[]>([])
  const [quota, setQuota] = useState<Quota | null>(null)

  const [picker, setPicker] = useState<'runs' | 'url' | null>(null)
  const pollTimer = useRef<number | null>(null)
  /**
   * 落位计算要用「此刻画布上有哪些图」，但连续放多张产出时 state 还没刷新，
   * 后一张就会算到和前一张同一个位置。这里用 ref 同步维护一份即时副本。
   */
  const itemsRef = useRef<CanvasItem[]>([])

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  )

  const load = useCallback(async () => {
    try {
      const detail = await fetchCanvas(canvasId)
      setMeta(detail.canvas)
      setItems(detail.items)
      setMaxItems(detail.limits.maxItems)
      setError(null)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '加载画布失败')
    } finally {
      setLoading(false)
    }
  }, [canvasId])

  const refreshQuota = useCallback(() => {
    fetchQuota()
      .then(setQuota)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    void load()
    refreshQuota()
  }, [load, refreshQuota])

  /**
   * 把一张图放到画布上。宽高按图片真实比例算，落点从期望位置起找第一个空位。
   */
  const placeImage = useCallback(
    async (
      src: string,
      preferred: { x: number; y: number },
      extra: { label?: string; sourceRunId?: number; sourceItemId?: number } = {},
    ) => {
      const size = await measureImage(src)
      const spot = findFreeSpot(itemsRef.current, { ...preferred, ...size })
      const item = await addCanvasItem(canvasId, { src, ...spot, ...size, ...extra })
      itemsRef.current = [...itemsRef.current, item]
      setItems((prev) => [...prev, item])
      return item
    },
    [canvasId],
  )

  // 有任务在跑就轮询；全部结束后停表。
  useEffect(() => {
    if (pending.length === 0) {
      if (pollTimer.current) window.clearInterval(pollTimer.current)
      pollTimer.current = null
      return
    }

    pollTimer.current = window.setInterval(() => {
      void (async () => {
        for (const job of [...pending]) {
          let run: WorkflowRun
          try {
            run = await fetchRun(job.runId)
          } catch {
            continue
          }
          if (!isTerminal(run.status)) continue

          setPending((prev) => prev.filter((entry) => entry.runId !== job.runId))
          refreshQuota()

          if (run.status !== 'succeeded') {
            setError(run.error ?? `${job.workflowName}失败`)
            continue
          }

          // 产出摆在原图右侧，保持「从这张图改出来的」空间关系；
          // 该位置已有图时由 placeImage 沿纵向让开。
          for (const output of run.outputs) {
            if (!output.url) continue
            await placeImage(
              output.url,
              { x: job.sourceItem.x + job.sourceItem.width + GAP, y: job.sourceItem.y },
              { label: job.workflowName, sourceRunId: run.id, sourceItemId: job.sourceItem.id },
            )
          }
        }
      })()
    }, POLL_MS)

    return () => {
      if (pollTimer.current) window.clearInterval(pollTimer.current)
      pollTimer.current = null
    }
  }, [pending, placeImage, refreshQuota])

  const handleCommitGeometry = async (
    id: number,
    patch: { x?: number; y?: number; width?: number; height?: number },
  ) => {
    // 先改本地再落库：等接口回来才动，拖完手会看到图弹回去。
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
    try {
      await updateCanvasItem(canvasId, id, patch)
    } catch {
      // 落库失败就把权威状态拉回来，避免界面与数据长期不一致。
      void load()
    }
  }

  const handleDeleteSelected = async () => {
    if (!selected) return
    setItems((prev) => prev.filter((item) => item.id !== selected.id))
    setSelectedId(null)
    setRegion(null)
    try {
      await deleteCanvasItem(canvasId, selected.id)
    } catch {
      void load()
    }
  }

  const handleBringToFront = async () => {
    if (!selected) return
    const top = Math.max(...items.map((item) => item.z), 0) + 1
    setItems((prev) => prev.map((item) => (item.id === selected.id ? { ...item, z: top } : item)))
    try {
      await updateCanvasItem(canvasId, selected.id, { z: top })
    } catch {
      void load()
    }
  }

  const handleSubmitOp = async (params: Record<string, ParamValue>) => {
    if (!activeOp || !selected) return
    setSubmitting(true)
    setServerErrors({})
    setError(null)
    try {
      const { run } = await submitRun(activeOp.slug, params)
      setPending((prev) => [...prev, { runId: run.id, sourceItem: selected, workflowName: activeOp.name }])
      setActiveOp(null)
      setRegion(null)
      setTool('select')
      refreshQuota()
    } catch (caught) {
      if (caught instanceof ApiError) {
        setServerErrors(caught.fieldErrors)
        if (Object.keys(caught.fieldErrors).length === 0) setError(caught.message)
      } else {
        setError('提交失败，请重试')
      }
    } finally {
      setSubmitting(false)
    }
  }

  /** 视图归位：把所有图框进可视区域，缩放到刚好放得下。 */
  const fitToItems = () => {
    if (items.length === 0) {
      setViewport({ x: 80, y: 60, scale: 1 })
      return
    }
    const minX = Math.min(...items.map((item) => item.x))
    const minY = Math.min(...items.map((item) => item.y))
    const maxX = Math.max(...items.map((item) => item.x + item.width))
    const maxY = Math.max(...items.map((item) => item.y + item.height))
    const width = maxX - minX
    const height = maxY - minY
    const stage = document.getElementById('canvas-stage')?.getBoundingClientRect()
    if (!stage || width <= 0 || height <= 0) return
    const scale = Math.min(Math.min((stage.width - 80) / width, (stage.height - 80) / height), 1)
    setViewport({
      x: (stage.width - width * scale) / 2 - minX * scale,
      y: (stage.height - height * scale) / 2 - minY * scale,
      scale,
    })
  }

  const opDisabledReason = (op: WorkflowDefinition): string | null => {
    if (!selected) return '请先选中一张图'
    if (NEEDS_REGION.has(op.slug) && (!region || region.itemId !== selected.id || region.w < 2)) {
      return '请先用「框选」工具在图上框出要修改的区域'
    }
    if (quota && quota.remainingCredits < op.costCredits) {
      return `今日额度剩余 ${quota.remainingCredits} 点，本次需要 ${op.costCredits} 点`
    }
    if (quota && quota.pendingRuns >= quota.pendingLimit) {
      return `已有 ${quota.pendingRuns} 个任务在队列中`
    }
    if (items.length >= maxItems) return `本画布图片已达上限 ${maxItems} 张`
    return null
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        正在加载画布…
      </div>
    )
  }

  if (!meta) {
    return (
      <p className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-red-300" role="alert">
        {error ?? '画布不存在'}
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <CanvasHeader
        meta={meta}
        onRenamed={(name) => setMeta((prev) => (prev ? { ...prev, name } : prev))}
      />

      {error && (
        <p className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/60 p-2">
        <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
          <ToolButton active={tool === 'select'} onClick={() => setTool('select')} icon={MousePointer2} label="选择" />
          <ToolButton
            active={tool === 'region'}
            onClick={() => setTool('region')}
            icon={Crop}
            label="框选"
          />
        </div>

        <span className="h-5 w-px bg-border" aria-hidden="true" />

        <Button variant="outline" size="sm" onClick={() => setPicker('runs')}>
          <ImagePlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          加入图片
        </Button>

        <span className="h-5 w-px bg-border" aria-hidden="true" />

        {canvasWorkflows.map((op) => {
          const Icon = OP_ICONS[op.slug] ?? Pencil
          const reason = opDisabledReason(op)
          return (
            <Button
              key={op.slug}
              variant={activeOp?.slug === op.slug ? 'default' : 'outline'}
              size="sm"
              disabled={Boolean(reason)}
              title={reason ?? op.summary}
              onClick={() => {
                setActiveOp(op)
                setServerErrors({})
              }}
            >
              <Icon className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {op.name}
            </Button>
          )
        })}

        <span className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={handleBringToFront} disabled={!selected} aria-label="置于顶层">
            <BringToFront className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void handleDeleteSelected()}
            disabled={!selected}
            aria-label="删除选中图片"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
          <span className="h-5 w-px bg-border" aria-hidden="true" />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setViewport((v) => ({ ...v, scale: Math.max(v.scale / 1.2, 0.1) }))}
            aria-label="缩小"
          >
            <ZoomOut className="h-4 w-4" aria-hidden="true" />
          </Button>
          <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
            {Math.round(viewport.scale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setViewport((v) => ({ ...v, scale: Math.min(v.scale * 1.2, 3) }))}
            aria-label="放大"
          >
            <ZoomIn className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={fitToItems} aria-label="适应画布">
            <Layers className="h-4 w-4" aria-hidden="true" />
          </Button>
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div id="canvas-stage" className="h-[62vh] min-h-[420px]">
          <CanvasStage
            items={items}
            selectedId={selectedId}
            tool={tool}
            viewport={viewport}
            region={region}
            busyItemIds={pending.map((job) => job.sourceItem.id)}
            onViewportChange={setViewport}
            onSelect={setSelectedId}
            onCommitGeometry={(id, patch) => void handleCommitGeometry(id, patch)}
            onRegionChange={setRegion}
          />
        </div>

        <aside className="space-y-4">
          {activeOp && selected ? (
            <CanvasOpPanel
              key={`${activeOp.slug}-${selected.id}`}
              workflow={activeOp}
              item={selected}
              region={region && region.itemId === selected.id ? region : null}
              submitting={submitting}
              disabledReason={opDisabledReason(activeOp)}
              serverErrors={serverErrors}
              onCancel={() => setActiveOp(null)}
              onSubmit={(params) => void handleSubmitOp(params)}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-border p-4 text-xs leading-6 text-muted-foreground">
              <p className="mb-2 font-semibold text-foreground/80">怎么用</p>
              <ol className="list-decimal space-y-1 pl-4">
                <li>「加入图片」把任务产出或图片链接放到画布上</li>
                <li>拖动摆位，右下角小方块等比缩放</li>
                <li>选中一张图后可「扩图」或「生成变体」</li>
                <li>要改局部：切到「框选」，在图上拖出范围，再点「局部重绘」</li>
                <li>产出会自动摆在原图右侧，可继续在它上面接着改</li>
              </ol>
              <p className="mt-3 border-t border-border pt-2">
                滚轮平移，按住 ⌘/Ctrl 滚轮缩放。
              </p>
            </div>
          )}

          {pending.length > 0 && (
            <div className="rounded-xl border border-gold/20 bg-gold/[0.06] p-3 text-xs text-gold-soft">
              <p className="flex items-center gap-1.5 font-semibold">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                {pending.length} 个任务生成中
              </p>
              <p className="mt-1 text-gold-soft/80">完成后会自动摆到原图右侧，可以先做别的。</p>
            </div>
          )}

          <div className="rounded-xl border border-border p-3 text-xs text-muted-foreground">
            <p>
              {items.length} / {maxItems} 张图
              {quota && ` · 今日额度已用 ${quota.usedCredits} / ${quota.limitCredits} 点`}
            </p>
            {selected?.sourceItemId && (
              <p className="mt-1">当前选中的图由画布上另一张图改出。</p>
            )}
          </div>
        </aside>
      </div>

      {picker && (
        <AddImageDialog
          mode={picker}
          onModeChange={setPicker}
          onClose={() => setPicker(null)}
          onPick={async (src, label, sourceRunId) => {
            setPicker(null)
            try {
              // 新图放在现有内容右侧，不覆盖已有摆位。
              const x = items.length ? Math.max(...items.map((item) => item.x + item.width)) + GAP : 0
              await placeImage(src, { x, y: 0 }, { label, sourceRunId })
            } catch (caught) {
              setError(caught instanceof ApiError ? caught.message : '加入图片失败')
            }
          }}
        />
      )}
    </div>
  )
}

function ToolButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: typeof MousePointer2
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
        active ? 'bg-gold/15 text-gold-soft' : 'text-muted-foreground hover:bg-muted',
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  )
}

function CanvasHeader({ meta, onRenamed }: { meta: CanvasMeta; onRenamed: (name: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(meta.name)

  const commit = async () => {
    setEditing(false)
    const next = name.trim()
    if (!next || next === meta.name) {
      setName(meta.name)
      return
    }
    try {
      await renameCanvas(meta.id, next)
      onRenamed(next)
    } catch {
      setName(meta.name)
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
          <Link to="/canvas">
            <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
            全部画布
          </Link>
        </Button>
        {editing ? (
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void commit()
              if (event.key === 'Escape') {
                setName(meta.name)
                setEditing(false)
              }
            }}
            className="h-8 w-52"
            aria-label="画布名称"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-lg font-bold text-paper hover:bg-muted"
            title="点击重命名"
          >
            <Frame className="h-4 w-4 text-gold" aria-hidden="true" />
            {meta.name}
          </button>
        )}
      </div>
      <ServerAccountBar />
    </div>
  )
}

/** 加入图片：从我的任务产出里挑，或直接贴一个图片链接。 */
function AddImageDialog({
  mode,
  onModeChange,
  onClose,
  onPick,
}: {
  mode: 'runs' | 'url'
  onModeChange: (mode: 'runs' | 'url') => void
  onClose: () => void
  onPick: (src: string, label: string, sourceRunId?: number) => void
}) {
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [loading, setLoading] = useState(true)
  const [url, setUrl] = useState('')

  useEffect(() => {
    fetchRuns(50)
      .then((list) =>
        setRuns(list.filter((run) => run.status === 'succeeded' && run.outputs.some((o) => o.url))),
      )
      .catch(() => setRuns([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/70 p-4" role="dialog" aria-modal="true">
      <div className="glass-panel max-h-[80vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-border shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-semibold text-paper">加入图片</h2>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted">
            关闭
          </button>
        </div>

        <div className="flex gap-1 border-b border-border px-5 py-2">
          {(['runs', 'url'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onModeChange(value)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm',
                mode === value ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {value === 'runs' ? '从我的任务' : '从链接'}
            </button>
          ))}
        </div>

        <div className="max-h-[56vh] overflow-y-auto p-5">
          {mode === 'url' ? (
            <div className="space-y-3">
              <Input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://…（图片直链）"
                aria-label="图片链接"
              />
              <p className="text-xs text-muted-foreground">
                只接受公网可访问的图片直链。请勿贴入含未公开项目内容的素材。
              </p>
              <Button
                size="sm"
                disabled={!url.trim().startsWith('http')}
                onClick={() => onPick(url.trim(), '外部图片')}
              >
                加入画布
              </Button>
            </div>
          ) : loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">正在加载任务产出…</p>
          ) : runs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              还没有可用的图片产出。先去「AI 工作流」跑一条出图的流水线。
            </p>
          ) : (
            <div className="space-y-5">
              {runs.map((run) => (
                <div key={run.id}>
                  <p className="mb-2 text-xs text-muted-foreground">
                    #{run.id} {run.workflowName}
                  </p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {run.outputs
                      .filter((output) => output.url)
                      .map((output, index) => (
                        <button
                          key={index}
                          type="button"
                          onClick={() => onPick(output.url as string, run.workflowName, run.id)}
                          className="overflow-hidden rounded-lg border border-border transition-colors hover:border-gold"
                        >
                          <img src={output.url} alt="" loading="lazy" className="aspect-video w-full object-cover" />
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function CanvasEditor() {
  const { id } = useParams()
  const canvasId = Number(id)

  useEffect(() => {
    document.title = '画布 · 横店影视数智服务门户'
  }, [])

  return (
    <div className="mx-auto max-w-[100rem] px-4 py-6 lg:px-6">
      <DemoBanner />
      <ServerAccountGate>
        {Number.isInteger(canvasId) && canvasId > 0 ? (
          <CanvasWorkspace canvasId={canvasId} />
        ) : (
          <p className="text-sm text-muted-foreground">画布编号不合法。</p>
        )}
      </ServerAccountGate>
    </div>
  )
}
