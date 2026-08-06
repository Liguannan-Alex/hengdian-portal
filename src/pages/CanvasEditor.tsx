/**
 * 节点画布编辑器。
 *
 * 三件事在这里合流：图的读写（canvasApi）、图的语义（graph.ts：槽位、占位符、
 * 脏标记）、以及生成——生成仍走 `/api/workflows/:slug/runs`，队列、配额、
 * 算力适配与埋点都是既有那一套，画布不自己造第二条执行链路。
 *
 * 持久化策略沿用「本地先动、防抖批量落库」：拖动节点时等接口回来才更新位置，
 * 手感会明显发黏。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ArrowLeft, Frame, ImagePlus, LayoutGrid, Loader2, Plus, Type } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DemoBanner } from '@/components/DemoBanner'
import { ServerAccountBar, ServerAccountGate } from '@/components/ServerAccountGate'
import { type FlowNodeData } from '@/components/canvas/CanvasNodes'
import { nodeTypes } from '@/components/canvas/nodeTypes'
import { NodeInspector, type NodeActionOption } from '@/components/canvas/NodeInspector'
import {
  fetchCanvas,
  measureImage,
  newKey,
  renameCanvas,
  saveGraph,
  type CanvasMeta,
  type GraphEdge,
  type GraphNode,
  type NodeData,
  type NodeType,
} from '@/lib/canvasApi'
import {
  ApiError,
  fetchQuota,
  fetchRuns,
  fetchRunsBatch,
  isTerminal,
  submitRun,
  trackWorkflow,
  type Quota,
  type WorkflowRun,
} from '@/lib/portalApi'
import { allWorkflows, workflowBySlug } from '@/data/workflows'
import { isRunning, resolveParams, staleKeysFrom, titleOf, wouldCreateCycle } from '@/lib/graph'

/** 批量查任务状态的间隔。画布上可能同时有十几个节点在跑，一个定时器全覆盖。 */
const POLL_MS = 2000
/** 落库防抖。拖动会产生大量位置变更，聚合后一次写。 */
const SAVE_DEBOUNCE_MS = 600

/**
 * 能作为节点动作的工作流。
 *
 * 画布能自动供上的连线输入只有 sourceUrl；其它 supplied=canvas 的字段
 * （目前是选区坐标）由节点自己的参数提供。两者都覆盖不了的动作不出现在这里，
 * 免得用户选了之后发现永远缺参数。
 */
const NODE_ACTIONS: NodeActionOption[] = allWorkflows
  .filter((workflow) =>
    workflow.inputs
      .filter((input) => input.supplied === 'canvas')
      .every((input) => input.key === 'sourceUrl' || input.default !== undefined),
  )
  .map((workflow) => ({
    slug: workflow.slug,
    name: workflow.name,
    outputKind: workflow.outputKind,
    costCredits: workflow.costCredits,
  }))

const DEFAULT_SIZE: Record<NodeType, { width: number; height: number }> = {
  image: { width: 320, height: 200 },
  video: { width: 320, height: 200 },
  text: { width: 280, height: 180 },
}

type FlowNode = Node<FlowNodeData>

/**
 * 领域节点 → React Flow 节点。
 *
 * 只在载入与新增时调用一次。**不能每次渲染都重建**：React Flow 把测量结果
 * （节点尺寸与句柄位置）挂在它自己持有的节点对象上，每渲染一次换一批新对象，
 * 测量就永远不会稳定，连线因此算不出端点、一条也画不出来。
 * 所以位置与尺寸由 React Flow 持有，我们只在落库时把它读回来。
 */
function toFlowNode(node: GraphNode): FlowNode {
  return {
    id: node.key,
    type: node.type,
    position: { x: node.x, y: node.y },
    style: { width: node.width, height: node.height },
    data: { ...node.data, title: titleOf(node) },
  }
}

/** React Flow 节点 → 领域节点，用于落库。 */
function toGraphNode(node: FlowNode): GraphNode {
  // title 是渲染用的派生字段，不落库：它由 label 与 action 算出来。
  const data: NodeData = { ...node.data }
  delete (data as Record<string, unknown>).title
  return {
    key: node.id,
    type: (node.type ?? 'image') as NodeType,
    x: Math.round(node.position.x),
    y: Math.round(node.position.y),
    width: Math.round(Number(node.style?.width ?? node.measured?.width ?? 320)),
    height: Math.round(Number(node.style?.height ?? node.measured?.height ?? 200)),
    z: 0,
    data,
  }
}

/** 标题依赖 label 与 action，改完要重算，否则节点头部还显示旧名字。 */
function withTitle(node: FlowNode): FlowNode {
  return { ...node, data: { ...node.data, title: titleOf(toGraphNode(node)) } }
}

function CanvasWorkspace({ canvasId }: { canvasId: number }) {
  const [meta, setMeta] = useState<CanvasMeta | null>(null)
  const [rfNodes, setRfNodes] = useState<FlowNode[]>([])
  const [rfEdges, setRfEdges] = useState<Edge[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [quota, setQuota] = useState<Quota | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [picker, setPicker] = useState(false)
  const [addMenu, setAddMenu] = useState(false)

  /** 待落库的变更。合并后由防抖定时器一次性提交。 */
  const dirtyRef = useRef({
    nodes: new Map<string, GraphNode>(),
    deletedNodes: new Set<string>(),
    edges: new Map<string, GraphEdge>(),
    deletedEdges: new Set<string>(),
  })
  const saveTimer = useRef<number | null>(null)
  /** 轮询回调里要读「此刻的节点」，但不能在 state updater 里做副作用，故留一份即时副本。 */
  const rfNodesRef = useRef<FlowNode[]>([])
  const nodesRef = useRef<GraphNode[]>([])
  const edgesRef = useRef<GraphEdge[]>([])

  // 图语义（槽位、脏标记、成环判断）用领域形状；渲染用 React Flow 形状。
  const nodes = useMemo(() => rfNodes.map(toGraphNode), [rfNodes])
  const edges = useMemo<GraphEdge[]>(
    () => rfEdges.map((edge) => ({ key: edge.id, source: edge.source, target: edge.target })),
    [rfEdges],
  )

  useEffect(() => {
    rfNodesRef.current = rfNodes
  }, [rfNodes])
  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])
  useEffect(() => {
    edgesRef.current = edges
  }, [edges])

  const selected = useMemo(
    () => nodes.find((node) => node.key === selectedKey) ?? null,
    [nodes, selectedKey],
  )

  const refreshQuota = useCallback(() => {
    fetchQuota()
      .then(setQuota)
      .catch(() => undefined)
  }, [])

  const load = useCallback(async () => {
    try {
      const detail = await fetchCanvas(canvasId)
      setMeta(detail.canvas)
      setRfNodes(detail.nodes.map(toFlowNode))
      setRfEdges(detail.edges.map((edge) => ({ id: edge.key, source: edge.source, target: edge.target })))
      setError(null)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '加载画布失败')
    } finally {
      setLoading(false)
    }
  }, [canvasId])

  useEffect(() => {
    void load()
    refreshQuota()
  }, [load, refreshQuota])

  const flush = useCallback(async () => {
    const dirty = dirtyRef.current
    if (
      dirty.nodes.size === 0 &&
      dirty.deletedNodes.size === 0 &&
      dirty.edges.size === 0 &&
      dirty.deletedEdges.size === 0
    ) {
      return
    }
    const patch = {
      upsertNodes: [...dirty.nodes.values()],
      deleteNodeKeys: [...dirty.deletedNodes],
      upsertEdges: [...dirty.edges.values()],
      deleteEdgeKeys: [...dirty.deletedEdges],
    }
    dirtyRef.current = {
      nodes: new Map(),
      deletedNodes: new Set(),
      edges: new Map(),
      deletedEdges: new Set(),
    }
    try {
      await saveGraph(canvasId, patch)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '保存失败')
      // 保存失败就把服务端的权威快照拉回来，避免界面与库长期不一致。
      void load()
    }
  }, [canvasId, load])

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => void flush(), SAVE_DEBOUNCE_MS)
  }, [flush])

  // 离开页面前把没落库的变更冲掉，否则最后几步操作会丢。
  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      void flush()
    }
  }, [flush])

  const markNodeDirty = useCallback(
    (node: GraphNode) => {
      dirtyRef.current.nodes.set(node.key, node)
      scheduleSave()
    },
    [scheduleSave],
  )

  const patchNode = useCallback(
    (key: string, patch: Partial<NodeData>) => {
      setRfNodes((prev) =>
        prev.map((node) => {
          if (node.id !== key) return node
          const next = withTitle({ ...node, data: { ...node.data, ...patch } })
          dirtyRef.current.nodes.set(key, toGraphNode(next))
          return next
        }),
      )
      scheduleSave()
    },
    [scheduleSave],
  )

  const addNode = useCallback(
    async (type: NodeType, seed: Partial<NodeData> = {}) => {
      const size = seed.url ? await measureImage(seed.url) : DEFAULT_SIZE[type]
      // 新节点摆在现有内容右侧，不压住已有布局。
      const x = nodesRef.current.length
        ? Math.max(...nodesRef.current.map((node) => node.x + node.width)) + 48
        : 0
      const node: GraphNode = {
        key: newKey(type === 'text' ? 't' : type === 'video' ? 'v' : 'i'),
        type,
        x,
        y: 0,
        width: size.width,
        height: size.height,
        z: nodesRef.current.length,
        data: { isStale: false, ...seed },
      }
      setRfNodes((prev) => [...prev, toFlowNode(node)])
      nodesRef.current = [...nodesRef.current, node]
      setSelectedKey(node.key)
      markNodeDirty(node)
      return node
    },
    [markNodeDirty],
  )

  const handleNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      for (const change of changes) {
        if (change.type === 'remove') {
          dirtyRef.current.deletedNodes.add(change.id)
          dirtyRef.current.nodes.delete(change.id)
        }
      }

      setRfNodes((prev) => {
        const next = applyNodeChanges(changes, prev)
        // 位置变化才需要落库；选中、尺寸测量这些是纯前端状态。
        for (const change of changes) {
          if (change.type !== 'position' || change.dragging) continue
          const moved = next.find((node) => node.id === change.id)
          if (moved) dirtyRef.current.nodes.set(moved.id, toGraphNode(moved))
        }
        return next
      })

      if (
        changes.some(
          (change) =>
            change.type === 'remove' || (change.type === 'position' && !change.dragging),
        )
      ) {
        scheduleSave()
      }
      const selectChange = changes.find((change) => change.type === 'select' && change.selected)
      if (selectChange && 'id' in selectChange) setSelectedKey(selectChange.id)
    },
    [scheduleSave],
  )

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removed = changes.filter((change) => change.type === 'remove')
      for (const change of removed) {
        dirtyRef.current.deletedEdges.add(change.id)
        dirtyRef.current.edges.delete(change.id)
      }
      setRfEdges((prev) => applyEdgeChanges(changes, prev))
      if (removed.length > 0) scheduleSave()
    },
    [scheduleSave],
  )

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return
      if (wouldCreateCycle(edgesRef.current, connection.source, connection.target)) {
        setNotice('不能连成环：下游又连回了上游')
        return
      }
      if (
        edgesRef.current.some(
          (edge) => edge.source === connection.source && edge.target === connection.target,
        )
      ) {
        return
      }

      const key = newKey('e')
      setRfEdges((prev) => addEdge({ ...connection, id: key }, prev))
      edgesRef.current = [
        ...edgesRef.current,
        { key, source: connection.source, target: connection.target },
      ]
      dirtyRef.current.edges.set(key, { key, source: connection.source, target: connection.target })

      // 接上新上游，下游当前产出就不再对应，直接标脏。
      const target = nodesRef.current.find((node) => node.key === connection.target)
      if (target?.data.action && (target.data.url || target.data.text)) {
        patchNode(target.key, { isStale: true })
      }
      scheduleSave()
      setNotice(null)
    },
    [patchNode, scheduleSave],
  )

  /** 一个节点产出更新后，把它的全部下游标脏。 */
  const propagateStale = useCallback(
    (changedKey: string) => {
      const stale = staleKeysFrom(nodesRef.current, edgesRef.current, changedKey)
      if (stale.size === 0) return

      const next = rfNodesRef.current.map((node) => {
        if (!stale.has(node.id) || node.data.isStale) return node
        const updated = { ...node, data: { ...node.data, isStale: true } }
        dirtyRef.current.nodes.set(node.id, toGraphNode(updated))
        return updated
      })
      rfNodesRef.current = next
      setRfNodes(next)
      scheduleSave()
    },
    [scheduleSave],
  )

  // 批量轮询：一次拿回所有在跑节点的状态，而不是每个节点一个定时器。
  const pendingRunIds = useMemo(
    () =>
      nodes
        .filter((node) => isRunning(node.data))
        .map((node) => node.data.taskInfo?.runId)
        .filter((id): id is number => typeof id === 'number'),
    [nodes],
  )

  useEffect(() => {
    if (pendingRunIds.length === 0) return
    const timer = window.setInterval(() => {
      void (async () => {
        let runs: WorkflowRun[]
        try {
          runs = await fetchRunsBatch(pendingRunIds)
        } catch {
          return
        }
        const byId = new Map(runs.map((run) => [run.id, run]))

        /*
         * 先在 updater 之外算好结果，再一次性写回。
         * 曾经把「哪些跑完了」收集在 setState 的 updater 里、调用后立刻读它——
         * updater 那时还没执行，收集到的永远是空的，于是既没落库也没标脏。
         */
        const nextNodes: FlowNode[] = []
        const finished: { key: string; run: WorkflowRun }[] = []
        let changed = false

        for (const node of rfNodesRef.current) {
          const runId = node.data.taskInfo?.runId
          const run = runId ? byId.get(runId) : undefined
          if (!run || run.status === node.data.taskInfo?.status) {
            nextNodes.push(node)
            continue
          }

          const data: FlowNodeData = {
            ...node.data,
            taskInfo: { runId: run.id, status: run.status, error: run.error },
          }
          if (isTerminal(run.status)) {
            if (run.status === 'succeeded') {
              const output = run.outputs[0]
              if (output?.url) data.url = output.url
              if (output?.text) data.text = output.text
              data.isStale = false
              data.producedAtMs = Date.now()
            }
            finished.push({ key: node.id, run })
          }
          const updated = { ...node, data }
          dirtyRef.current.nodes.set(node.id, toGraphNode(updated))
          nextNodes.push(updated)
          changed = true
        }

        if (!changed) return
        rfNodesRef.current = nextNodes
        setRfNodes(nextNodes)

        if (finished.length > 0) {
          scheduleSave()
          refreshQuota()
          // 产出变了，下游全部标脏——这是节点式工具的核心承诺。
          for (const entry of finished) {
            if (entry.run.status === 'succeeded') propagateStale(entry.key)
          }
        }
      })()
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [pendingRunIds, propagateStale, refreshQuota, scheduleSave])

  const quotaBlocker = (costCredits: number): string | null => {
    if (!quota) return null
    if (quota.remainingCredits < costCredits) {
      return `今日额度剩余 ${quota.remainingCredits} 点，本次需要 ${costCredits} 点`
    }
    if (quota.pendingRuns >= quota.pendingLimit) {
      return `已有 ${quota.pendingRuns} 个任务在队列中`
    }
    return null
  }

  const runNode = async (node: GraphNode) => {
    const workflow = node.data.action ? workflowBySlug.get(node.data.action) : null
    if (!workflow) return

    setSubmitting(true)
    setServerErrors({})
    setError(null)
    try {
      const { params } = resolveParams(node, nodesRef.current, edgesRef.current)
      const { run } = await submitRun(workflow.slug, params)
      patchNode(node.key, {
        taskInfo: { runId: run.id, status: run.status, error: null },
      })
      trackWorkflow('workflow_submit', workflow.slug, '/canvas', workflow.sceneSlug)
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

  const deleteNode = (key: string) => {
    dirtyRef.current.deletedNodes.add(key)
    dirtyRef.current.nodes.delete(key)
    setRfNodes((prev) => prev.filter((node) => node.id !== key))
    setRfEdges((prev) => {
      for (const edge of prev.filter((entry) => entry.source === key || entry.target === key)) {
        dirtyRef.current.deletedEdges.add(edge.id)
      }
      return prev.filter((edge) => edge.source !== key && edge.target !== key)
    })
    setSelectedKey(null)
    scheduleSave()
  }

  /** 自动整理：按拓扑层级从左到右排开，同层纵向排列。 */
  const autoLayout = () => {
    const depth = new Map<string, number>()
    const compute = (key: string, seen: Set<string>): number => {
      if (depth.has(key)) return depth.get(key) as number
      if (seen.has(key)) return 0
      seen.add(key)
      const parents = edgesRef.current.filter((edge) => edge.target === key)
      const value = parents.length === 0 ? 0 : Math.max(...parents.map((edge) => compute(edge.source, seen) + 1))
      depth.set(key, value)
      return value
    }
    for (const node of nodesRef.current) compute(node.key, new Set())

    const columns = new Map<number, GraphNode[]>()
    for (const node of nodesRef.current) {
      const level = depth.get(node.key) ?? 0
      columns.set(level, [...(columns.get(level) ?? []), node])
    }

    setRfNodes((prev) =>
      prev.map((node) => {
        const level = depth.get(node.id) ?? 0
        const column = columns.get(level) ?? []
        const index = column.findIndex((entry) => entry.key === node.id)
        const next = { ...node, position: { x: level * 420, y: index * 280 } }
        dirtyRef.current.nodes.set(node.id, toGraphNode(next))
        return next
      }),
    )
    scheduleSave()
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
    <div className="space-y-3">
      <CanvasHeader meta={meta} onRenamed={(name) => setMeta((prev) => (prev ? { ...prev, name } : prev))} />

      {(error || notice) && (
        <p
          className={cnNotice(Boolean(error))}
          role={error ? 'alert' : 'status'}
        >
          {error ?? notice}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/60 p-2">
        <div className="relative">
          <Button variant="outline" size="sm" onClick={() => setAddMenu((open) => !open)}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            添加节点
          </Button>
          {addMenu && (
            <div className="absolute left-0 top-full z-30 mt-1 w-48 rounded-lg border border-border bg-card p-1 shadow-xl">
              {(
                [
                  { type: 'image' as const, label: '图片节点', icon: ImagePlus },
                  { type: 'text' as const, label: '文本节点', icon: Type },
                ]
              ).map((entry) => (
                <button
                  key={entry.type}
                  type="button"
                  onClick={() => {
                    setAddMenu(false)
                    void addNode(entry.type)
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <entry.icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  {entry.label}
                </button>
              ))}
              <div className="my-1 border-t border-border" />
              <button
                type="button"
                onClick={() => {
                  setAddMenu(false)
                  setPicker(true)
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
              >
                <ImagePlus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                从我的任务导入
              </button>
            </div>
          )}
        </div>

        <Button variant="outline" size="sm" onClick={autoLayout} disabled={nodes.length === 0}>
          <LayoutGrid className="mr-1.5 h-4 w-4" aria-hidden="true" />
          自动整理
        </Button>

        <span className="ml-auto text-xs text-muted-foreground">
          {nodes.length} 个节点 · {edges.length} 条连线
          {quota && ` · 今日额度已用 ${quota.usedCredits} / ${quota.limitCredits} 点`}
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="h-[64vh] min-h-[460px] overflow-hidden rounded-xl border border-border">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            onPaneClick={() => setSelectedKey(null)}
            colorMode="dark"
            fitView
            minZoom={0.15}
            maxZoom={2}
            proOptions={{ hideAttribution: false }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="!bg-ink" />
          </ReactFlow>
        </div>

        <aside className="h-[64vh] min-h-[460px] overflow-hidden rounded-xl border border-border p-4">
          {selected ? (
            <NodeInspector
              key={selected.key}
              node={selected}
              nodes={nodes}
              edges={edges}
              actions={NODE_ACTIONS}
              submitting={submitting}
              quotaBlocker={
                selected.data.action
                  ? quotaBlocker(workflowBySlug.get(selected.data.action)?.costCredits ?? 0)
                  : null
              }
              serverErrors={serverErrors}
              onPatch={patchNode}
              onRun={() => void runNode(selected)}
              onDelete={() => deleteNode(selected.key)}
            />
          ) : (
            <div className="space-y-3 text-xs leading-6 text-muted-foreground">
              <p className="text-sm font-semibold text-foreground/80">怎么用</p>
              <ol className="list-decimal space-y-1 pl-4">
                <li>「添加节点」放一个图片或文本节点，或从我的任务导入产出</li>
                <li>选中节点，在这里给它选一个动作（比如概念气氛图、扩图）</li>
                <li>从上游节点右侧的圆点拖到下游节点左侧，建立连线</li>
                <li>连线会变成输入槽位；提示词里写 <code className="rounded bg-muted px-1">{'{{图 1}}'}</code> 就能引用上游</li>
                <li>点「运行」。上游后来改了，下游会标成「上游已更新」，重跑即可对齐</li>
              </ol>
              <p className="border-t border-border pt-2">
                在画布空白处拖动可平移，滚轮缩放，左下角有缩放控件与小地图。
              </p>
            </div>
          )}
        </aside>
      </div>

      {picker && (
        <ImportDialog
          onClose={() => setPicker(false)}
          onPick={async (url, label, sourceRunId) => {
            setPicker(false)
            await addNode('image', { url, label, isStale: false })
            void sourceRunId
          }}
        />
      )}
    </div>
  )
}

function cnNotice(isError: boolean): string {
  return isError
    ? 'rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-red-300'
    : 'rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-sm text-amber-200'
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

/** 从我的任务产出里导入一张图作为素材节点。 */
function ImportDialog({
  onClose,
  onPick,
}: {
  onClose: () => void
  onPick: (url: string, label: string, sourceRunId: number) => void
}) {
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [loading, setLoading] = useState(true)

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
          <h2 className="font-semibold text-paper">从我的任务导入</h2>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted">
            关闭
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-5">
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">正在加载任务产出…</p>
          ) : runs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              还没有可用的图片产出。先去「AI 工作流」跑一条出图的流水线，或直接在画布上加图片节点填链接。
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
    <div className="mx-auto max-w-[110rem] px-4 py-6 lg:px-6">
      <DemoBanner />
      <ServerAccountGate>
        {Number.isInteger(canvasId) && canvasId > 0 ? (
          <ReactFlowProvider>
            <CanvasWorkspace canvasId={canvasId} />
          </ReactFlowProvider>
        ) : (
          <p className="text-sm text-muted-foreground">画布编号不合法。</p>
        )}
      </ServerAccountGate>
    </div>
  )
}
