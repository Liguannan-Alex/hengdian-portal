/**
 * 画布节点组件。
 *
 * 节点上只放「这是什么、跑到哪一步、产出长什么样」——参数编辑在右侧检视面板。
 * 把整套参数表单塞进节点里，缩到 50% 视图时就什么都读不了了，而缩放着看全局
 * 恰恰是节点画布最常用的姿势。
 */
import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { AlertTriangle, Ban, CircleAlert, Clock3, ImageOff, Loader2, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { workflowBySlug } from '@/data/workflows'
import type { NodeData } from '@/lib/canvasApi'

/** React Flow 节点的 data 就是我们的 NodeData，外加渲染需要的少量派生信息。 */
export interface FlowNodeData extends NodeData, Record<string, unknown> {
  title: string
}

function StatusLine({ data }: { data: FlowNodeData }) {
  const status = data.taskInfo?.status

  if (status === 'queued') {
    return (
      <span className="flex items-center gap-1 text-muted-foreground">
        <Clock3 className="h-3 w-3" aria-hidden="true" />
        排队中
      </span>
    )
  }
  if (status === 'running') {
    return (
      <span className="flex items-center gap-1 text-gold-soft">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        生成中
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="flex items-center gap-1 text-red-300" title={data.taskInfo?.error ?? undefined}>
        <CircleAlert className="h-3 w-3" aria-hidden="true" />
        失败
      </span>
    )
  }
  if (status === 'canceled') {
    return (
      <span className="flex items-center gap-1 text-muted-foreground">
        <Ban className="h-3 w-3" aria-hidden="true" />
        已取消
      </span>
    )
  }
  if (data.isStale) {
    return (
      <span className="flex items-center gap-1 text-amber-300">
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        上游已更新
      </span>
    )
  }
  if (data.action && !data.url && !data.text) {
    return <span className="text-muted-foreground">未运行</span>
  }
  return <span className="text-muted-foreground">{data.action ? '已完成' : '素材'}</span>
}

function Shell({
  selected,
  data,
  children,
}: {
  selected: boolean
  data: FlowNodeData
  children: React.ReactNode
}) {
  const actionName = data.action ? (workflowBySlug.get(data.action)?.name ?? data.action) : null

  return (
    <div
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-lg border bg-card shadow-lg shadow-black/40 transition-colors',
        selected ? 'border-gold' : 'border-border',
        // 脏标记要在缩略状态下也一眼可见，所以用边框而不是只靠角标。
        data.isStale && !selected && 'border-amber-400/50',
      )}
    >
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1.5">
        {data.action && <Sparkles className="h-3 w-3 shrink-0 text-gold" aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate text-[0.7rem] font-medium text-paper">{data.title}</span>
      </div>

      <div className="relative min-h-0 flex-1">{children}</div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-2 py-1 text-[0.62rem]">
        <StatusLine data={data} />
        {actionName && <span className="truncate text-muted-foreground/70">{actionName}</span>}
      </div>
    </div>
  )
}

/** 左进右出。句柄做大一些，缩放到 50% 时仍然拖得中。 */
function Handles() {
  const style = { width: 10, height: 10, background: 'hsl(var(--gold))', border: '2px solid hsl(var(--ink))' }
  return (
    <>
      <Handle type="target" position={Position.Left} style={style} />
      <Handle type="source" position={Position.Right} style={style} />
    </>
  )
}

function MediaBody({ data }: { data: FlowNodeData }) {
  if (data.url) {
    return (
      <>
        <img
          src={data.url}
          alt={data.title}
          draggable={false}
          loading="lazy"
          className="h-full w-full object-cover"
        />
        {data.isStale && (
          <span className="absolute right-1 top-1 rounded bg-amber-400/90 px-1.5 py-0.5 text-[0.6rem] font-semibold text-ink">
            待重跑
          </span>
        )}
      </>
    )
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-ink/40 text-muted-foreground">
      {data.taskInfo?.status === 'running' || data.taskInfo?.status === 'queued' ? (
        <Loader2 className="h-5 w-5 animate-spin text-gold-soft" aria-hidden="true" />
      ) : (
        <ImageOff className="h-5 w-5" aria-hidden="true" />
      )}
      <span className="px-2 text-center text-[0.62rem] leading-4">
        {data.action ? '设好参数后运行' : '空节点'}
      </span>
    </div>
  )
}

export const ImageNode = memo(function ImageNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowNodeData
  return (
    <>
      <Handles />
      <Shell selected={Boolean(selected)} data={nodeData}>
        <MediaBody data={nodeData} />
      </Shell>
    </>
  )
})

export const VideoNode = memo(function VideoNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowNodeData
  return (
    <>
      <Handles />
      <Shell selected={Boolean(selected)} data={nodeData}>
        <MediaBody data={nodeData} />
        {nodeData.url && (
          <span className="absolute left-1 top-1 rounded bg-ink/80 px-1.5 py-0.5 text-[0.6rem] text-paper/85">
            视频
          </span>
        )}
      </Shell>
    </>
  )
})

export const TextNode = memo(function TextNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowNodeData
  return (
    <>
      <Handles />
      <Shell selected={Boolean(selected)} data={nodeData}>
        <div className="h-full w-full overflow-hidden bg-ink/30 px-2 py-1.5">
          {nodeData.text?.trim() ? (
            <p className="whitespace-pre-wrap text-[0.65rem] leading-4 text-foreground/80">
              {nodeData.text.length > 400 ? `${nodeData.text.slice(0, 400)}…` : nodeData.text}
            </p>
          ) : (
            <p className="text-[0.65rem] text-muted-foreground">
              {nodeData.action ? '设好参数后运行' : '双击右侧面板写入文本'}
            </p>
          )}
        </div>
      </Shell>
    </>
  )
})
