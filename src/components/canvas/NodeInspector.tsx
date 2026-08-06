/**
 * 节点检视面板：选中节点的动作、输入槽位、参数与运行。
 *
 * 参数不放在节点里，因为缩放着看全局是节点画布最常用的姿势，缩到 50% 时
 * 节点内的表单就什么都读不了了。面板固定在右侧，读写都稳定。
 */
import { AlertTriangle, ExternalLink, Link2, Loader2, Play, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fieldClass } from '@/components/ui/field-styles'
import { WorkflowField } from '@/components/WorkflowField'
import { RegionPicker, type RegionValue } from '@/components/canvas/RegionPicker'
import { editableInputs, workflowBySlug, type ParamValue } from '@/data/workflows'
import type { GraphEdge, GraphNode } from '@/lib/canvasApi'
import { isRunning, resolveParams, titleOf } from '@/lib/graph'
import { cn } from '@/lib/utils'

/** 能作为节点动作的工作流：画布只能供上 sourceUrl，需要其它连线输入的排除掉。 */
export interface NodeActionOption {
  slug: string
  name: string
  outputKind: 'image' | 'video' | 'text'
  costCredits: number
}

export interface NodeInspectorProps {
  node: GraphNode
  nodes: GraphNode[]
  edges: GraphEdge[]
  actions: NodeActionOption[]
  submitting: boolean
  quotaBlocker: string | null
  serverErrors: Record<string, string>
  onPatch: (key: string, patch: Partial<GraphNode['data']>) => void
  onRun: () => void
  onDelete: () => void
}

const REGION_KEYS = ['regionX', 'regionY', 'regionW', 'regionH'] as const

export function NodeInspector({
  node,
  nodes,
  edges,
  actions,
  submitting,
  quotaBlocker,
  serverErrors,
  onPatch,
  onRun,
  onDelete,
}: NodeInspectorProps) {
  const workflow = node.data.action ? workflowBySlug.get(node.data.action) : null
  const { blockers, slots } = resolveParams(node, nodes, edges)
  const params = node.data.params ?? {}
  const running = isRunning(node.data)

  const setParam = (key: string, value: ParamValue) => {
    onPatch(node.key, { params: { ...params, [key]: value } })
  }

  const needsRegion = Boolean(workflow?.inputs.some((input) => input.key === 'regionW'))
  const regionSource = slots.find((slot) => slot.type === 'image' || slot.type === 'video')
  const region: RegionValue = {
    x: Number(params.regionX ?? 0),
    y: Number(params.regionY ?? 0),
    w: Number(params.regionW ?? 0),
    h: Number(params.regionH ?? 0),
  }

  // 只把「用户还能自己解决」的问题作为运行阻断展示；额度类问题单列。
  const runBlockers = [...blockers, ...(quotaBlocker ? [quotaBlocker] : [])]
  const canRun = Boolean(workflow) && runBlockers.length === 0 && !running

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      <div className="space-y-1.5">
        <Label htmlFor="node-label">节点名称</Label>
        <Input
          id="node-label"
          value={node.data.label ?? ''}
          placeholder={titleOf(node)}
          onChange={(event) => onPatch(node.key, { label: event.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="node-action">动作</Label>
        <select
          id="node-action"
          className={fieldClass}
          value={node.data.action ?? ''}
          onChange={(event) => {
            const slug = event.target.value
            const next = slug ? workflowBySlug.get(slug) : null
            onPatch(node.key, {
              action: slug || undefined,
              // 换动作等于换参数集合，旧参数留着只会把无关字段提交上去。
              params: next ? Object.fromEntries(
                next.inputs
                  .filter((input) => input.default !== undefined)
                  .map((input) => [input.key, input.default as ParamValue]),
              ) : {},
            })
          }}
        >
          <option value="">（素材节点，不生成）</option>
          {actions.map((action) => (
            <option key={action.slug} value={action.slug}>
              {action.name}（{action.costCredits} 点）
            </option>
          ))}
        </select>
        {!node.data.action && (
          <p className="text-xs text-muted-foreground">
            素材节点只作为下游的输入。选一个动作，它就会自己产出内容。
          </p>
        )}
      </div>

      {node.type === 'text' && !node.data.action && (
        <div className="space-y-1.5">
          <Label htmlFor="node-text">文本内容</Label>
          <textarea
            id="node-text"
            rows={6}
            className={cn(fieldClass, 'min-h-28 resize-y leading-6')}
            value={node.data.text ?? ''}
            placeholder="写入剧本片段、风格描述等，供下游节点用 {{文 1}} 引用。"
            onChange={(event) => onPatch(node.key, { text: event.target.value })}
          />
        </div>
      )}

      {node.type !== 'text' && !node.data.action && (
        <div className="space-y-1.5">
          <Label htmlFor="node-url">图片链接</Label>
          <Input
            id="node-url"
            value={node.data.url ?? ''}
            placeholder="https://…"
            onChange={(event) => onPatch(node.key, { url: event.target.value })}
          />
        </div>
      )}

      {slots.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-border p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground/80">
            <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
            输入槽位
          </p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {slots.map((slot) => (
              <li key={slot.node.key} className="flex items-center justify-between gap-2">
                <code className="rounded bg-muted px-1.5 py-0.5 text-[0.7rem] text-gold-soft">
                  {`{{${slot.name}}}`}
                </code>
                <span className="min-w-0 flex-1 truncate text-right">{titleOf(slot.node)}</span>
              </li>
            ))}
          </ul>
          <p className="pt-1 text-[0.68rem] leading-4 text-muted-foreground/80">
            提示词里写占位符即可引用上游内容；图片类上游会自动作为原图送进去。
          </p>
        </div>
      )}

      {workflow && needsRegion && (
        <div className="space-y-1.5">
          <Label>修改区域</Label>
          {regionSource?.node.data.url ? (
            <RegionPicker
              src={regionSource.node.data.url}
              value={region}
              onChange={(next) => {
                onPatch(node.key, {
                  params: {
                    ...params,
                    regionX: Number(next.x.toFixed(1)),
                    regionY: Number(next.y.toFixed(1)),
                    regionW: Number(next.w.toFixed(1)),
                    regionH: Number(next.h.toFixed(1)),
                  },
                })
              }}
            />
          ) : (
            <p className="text-xs text-amber-300">先把一个图片节点连到这里，才能框选区域。</p>
          )}
        </div>
      )}

      {workflow &&
        editableInputs(workflow)
          .filter((input) => !(REGION_KEYS as readonly string[]).includes(input.key))
          .map((input) => (
            <WorkflowField
              key={input.key}
              input={input}
              idPrefix="node-param-"
              value={params[input.key] ?? ''}
              error={serverErrors[input.key] ?? null}
              onChange={(next) => setParam(input.key, next)}
            />
          ))}

      {serverErrors.__form__ && (
        <p className="text-xs font-medium text-destructive" role="alert">
          {serverErrors.__form__}
        </p>
      )}

      {node.data.isStale && (
        <p className="flex items-start gap-1.5 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          上游已经变过，当前产出对应的是旧上游。重跑一次即可对齐。
        </p>
      )}

      {node.data.taskInfo?.status === 'failed' && node.data.taskInfo.error && (
        <p className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-red-300" role="alert">
          {node.data.taskInfo.error}
        </p>
      )}

      <div className="mt-auto space-y-2 border-t border-border pt-4">
        {workflow && (
          <>
            <Button className="w-full" disabled={!canRun || submitting} onClick={onRun}>
              {submitting || running ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="mr-1.5 h-4 w-4" aria-hidden="true" />
              )}
              {running ? '生成中…' : node.data.url || node.data.text ? `重跑（${workflow.costCredits} 点）` : `运行（${workflow.costCredits} 点）`}
            </Button>
            {runBlockers.map((reason) => (
              <p key={reason} className="text-xs text-muted-foreground" role="status">
                {reason}
              </p>
            ))}
          </>
        )}

        {node.data.url && (
          <Button asChild variant="outline" size="sm" className="w-full">
            <a href={node.data.url} target="_blank" rel="noopener noreferrer">
              打开原图（新窗口）
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </Button>
        )}

        <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={onDelete}>
          <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
          删除节点
        </Button>
      </div>
    </div>
  )
}
