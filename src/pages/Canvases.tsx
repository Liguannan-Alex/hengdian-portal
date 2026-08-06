/**
 * 画布列表。
 *
 * 画布是工作区，不是资产库：一个项目开一块，图在上面反复迭代。
 * 因此这里只做「进哪块画布」，不做画廊式的产出浏览。
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Frame, Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DemoBanner } from '@/components/DemoBanner'
import { ServerAccountBar, ServerAccountGate } from '@/components/ServerAccountGate'
import { ApiError } from '@/lib/portalApi'
import { createCanvas, deleteCanvas, fetchCanvases, type CanvasSummary } from '@/lib/canvasApi'

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function CanvasList() {
  const navigate = useNavigate()
  const [canvases, setCanvases] = useState<CanvasSummary[]>([])
  const [limit, setLimit] = useState(20)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const result = await fetchCanvases()
      setCanvases(result.canvases)
      setLimit(result.limit)
      setError(null)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '加载画布失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleCreate = async () => {
    setCreating(true)
    setError(null)
    try {
      const canvas = await createCanvas()
      navigate(`/canvas/${canvas.id}`)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '新建画布失败')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (canvas: CanvasSummary) => {
    // 删画布会连带删掉上面所有图，且没有回收站，必须确认。
    if (!window.confirm(`删除「${canvas.name}」？画布上的 ${canvas.nodeCount} 个节点会一并删除，且无法恢复。`)) {
      return
    }
    try {
      await deleteCanvas(canvas.id)
      await load()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '删除失败')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        正在加载画布…
      </div>
    )
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          共 {canvases.length} / {limit} 块画布
        </p>
        <Button onClick={() => void handleCreate()} disabled={creating || canvases.length >= limit}>
          {creating ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          )}
          新建画布
        </Button>
      </div>

      {error && (
        <p className="mb-6 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}

      {canvases.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-6 py-16 text-center">
          <Frame className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-sm text-muted-foreground">
            还没有画布。新建一块，把节点连起来跑一条自己的流水线。
          </p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {canvases.map((canvas) => (
            <div
              key={canvas.id}
              className="glass-panel group relative overflow-hidden rounded-xl border border-paper/[0.09] shadow-lg shadow-black/30 transition-transform duration-300 hover:-translate-y-1"
            >
              <Link to={`/canvas/${canvas.id}`} className="block">
                <div className="flex aspect-video items-center justify-center bg-ink/60">
                  {canvas.previewSrc ? (
                    <img
                      src={canvas.previewSrc}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Frame className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                  )}
                </div>
                <div className="p-4">
                  <h2 className="truncate font-semibold text-paper">{canvas.name}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {canvas.nodeCount} 个节点 · {formatTime(canvas.updatedAt)}
                  </p>
                </div>
              </Link>
              <button
                type="button"
                onClick={() => void handleDelete(canvas)}
                aria-label={`删除画布 ${canvas.name}`}
                className="absolute right-2 top-2 rounded-md bg-ink/70 p-1.5 text-paper/70 opacity-0 transition-opacity hover:text-red-300 focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export default function Canvases() {
  useEffect(() => {
    document.title = '画布 · 横店影视数智服务门户'
  }, [])

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 lg:px-6">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-bold text-paper sm:text-3xl">画布</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            把产出摆在一块画布上反复改：框一块局部重绘、换画幅时扩图、拿不准就出几个变体并排比。
            不用每次回到表单从头描述。
          </p>
        </div>
        <ServerAccountBar />
      </div>

      <DemoBanner />

      <ServerAccountGate>
        <CanvasList />
      </ServerAccountGate>
    </div>
  )
}
