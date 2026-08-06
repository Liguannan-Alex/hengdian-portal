/**
 * 节点图语义：输入槽位、占位符、脏标记传播。
 *
 * 这里是节点画布真正不同于图板的地方，因此单独成文件、保持纯函数、可单测：
 *
 * 1. **连线拓扑翻译成输入槽位**。上游连进来的节点按类型编号成「图 1」「文 1」，
 *    生成节点的 `sourceUrl` 自动取「图 1」，提示词里可以用 `{{文 1}}` 引用文本上游。
 *    这样一份提示词模板能在不同上游之间复用，而不是每次重写。
 *
 * 2. **脏标记**。上游产出变了，下游就不再对应当前上游，必须让人看见。
 *    没有这一步，画布上摆的就是一堆来源不明的旧图。
 */
import type { GraphEdge, GraphNode, NodeData, NodeType } from '@/lib/canvasApi'
import { editableInputs, workflowBySlug, type ParamValue, type WorkflowDefinition } from '@/data/workflows'

export interface Slot {
  /** 展示名，也是占位符里写的名字，如「图 1」。 */
  name: string
  type: NodeType
  node: GraphNode
}

const TYPE_LABEL: Record<NodeType, string> = { image: '图', video: '视频', text: '文' }

/** 直接上游，按节点在图中的纵向位置排序，保证槽位编号稳定可预期。 */
export function upstreamOf(nodes: GraphNode[], edges: GraphEdge[], targetKey: string): GraphNode[] {
  const byKey = new Map(nodes.map((node) => [node.key, node]))
  return edges
    .filter((edge) => edge.target === targetKey)
    .map((edge) => byKey.get(edge.source))
    .filter((node): node is GraphNode => Boolean(node))
    .sort((a, b) => a.y - b.y || a.x - b.x)
}

/** 直接下游。 */
export function downstreamOf(nodes: GraphNode[], edges: GraphEdge[], sourceKey: string): GraphNode[] {
  const byKey = new Map(nodes.map((node) => [node.key, node]))
  return edges
    .filter((edge) => edge.source === sourceKey)
    .map((edge) => byKey.get(edge.target))
    .filter((node): node is GraphNode => Boolean(node))
}

/** 把上游按类型编号成槽位：图 1、图 2、文 1…… */
export function slotsOf(nodes: GraphNode[], edges: GraphEdge[], targetKey: string): Slot[] {
  const counters: Record<string, number> = {}
  return upstreamOf(nodes, edges, targetKey).map((node) => {
    counters[node.type] = (counters[node.type] ?? 0) + 1
    return { name: `${TYPE_LABEL[node.type]} ${counters[node.type]}`, type: node.type, node }
  })
}

/** 槽位能提供的内容：图/视频给 url，文本给正文。 */
function contentOf(node: GraphNode): string | null {
  if (node.type === 'text') return node.data.text?.trim() || null
  return node.data.url ?? null
}

/**
 * 把 `{{图 1}}` 这类占位符换成上游的实际内容。
 *
 * 找不到对应槽位时原样保留：静默删掉会让人以为提示词生效了，
 * 而实际提交给算力方的是一句缺了主语的话。
 */
export function fillPlaceholders(text: string, slots: Slot[]): string {
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (whole, rawName: string) => {
    const slot = slots.find((entry) => entry.name.replace(/\s+/g, '') === rawName.replace(/\s+/g, ''))
    if (!slot) return whole
    return contentOf(slot.node) ?? whole
  })
}

export interface ResolveResult {
  params: Record<string, ParamValue>
  /** 阻止提交的原因，按人能直接行动的说法写。 */
  blockers: string[]
  slots: Slot[]
}

/**
 * 把节点参数 + 上游槽位解析成最终提交给后端的 params。
 *
 * 服务端仍会重新校验这份 params——这里只是把图上的信息翻译过去，不是判定方。
 */
export function resolveParams(
  node: GraphNode,
  nodes: GraphNode[],
  edges: GraphEdge[],
): ResolveResult {
  const slots = slotsOf(nodes, edges, node.key)
  const blockers: string[] = []

  const action = node.data.action
  if (!action) {
    return { params: {}, blockers: ['该节点没有绑定动作，只作为下游的素材'], slots }
  }
  const workflow = workflowBySlug.get(action)
  if (!workflow) {
    return { params: {}, blockers: [`动作已下线：${action}`], slots }
  }

  const params: Record<string, ParamValue> = {}
  for (const [key, value] of Object.entries(node.data.params ?? {})) {
    params[key] = typeof value === 'string' ? fillPlaceholders(value, slots) : value
  }

  for (const input of workflow.inputs) {
    if (input.supplied !== 'canvas') continue

    if (input.key === 'sourceUrl') {
      // 取第一个能提供图像的上游。视频也接受：它的封面同样是一张图。
      const source = slots.find((slot) => slot.type === 'image' || slot.type === 'video')
      const url = source ? contentOf(source.node) : null
      if (!url) {
        blockers.push('缺少上游图片：把一个图片节点连到这个节点的左侧')
      } else {
        params[input.key] = url
      }
      continue
    }

    // 选区之类的字段由节点自己的参数提供（检视面板里框选），不来自连线。
    if (params[input.key] === undefined && input.default !== undefined) {
      params[input.key] = input.default
    }
  }

  return { params, blockers, slots }
}

/** 节点的默认参数：动作定义里的默认值，供用户在检视面板里改。 */
export function defaultNodeParams(workflow: WorkflowDefinition): Record<string, ParamValue> {
  const params: Record<string, ParamValue> = {}
  for (const input of editableInputs(workflow)) {
    if (input.default !== undefined) {
      params[input.key] = input.default
      continue
    }
    params[input.key] = input.type === 'toggle' ? false : input.type === 'number' ? (input.min ?? 0) : ''
  }
  // 选区字段由画布填但不来自连线，需要在节点上留默认值。
  for (const input of workflow.inputs) {
    if (input.supplied === 'canvas' && input.key !== 'sourceUrl' && input.default !== undefined) {
      params[input.key] = input.default
    }
  }
  return params
}

/**
 * 从某个节点出发，把所有下游标脏。
 *
 * 广度优先并记录已访问：图里出现环时不会转不出来。连线时禁止自环，
 * 但两点互连仍可能被连出来，所以这里必须自己防。
 */
export function staleKeysFrom(
  nodes: GraphNode[],
  edges: GraphEdge[],
  changedKey: string,
): Set<string> {
  const stale = new Set<string>()
  const queue = [changedKey]
  const seen = new Set([changedKey])

  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const node of downstreamOf(nodes, edges, current)) {
      if (seen.has(node.key)) continue
      seen.add(node.key)
      // 素材节点没有产出可言，标脏没有意义。
      if (node.data.action) stale.add(node.key)
      queue.push(node.key)
    }
  }
  return stale
}

/** 连线是否会形成环。React Flow 允许任意连线，成环由我们自己拦。 */
export function wouldCreateCycle(edges: GraphEdge[], source: string, target: string): boolean {
  if (source === target) return true
  const queue = [target]
  const seen = new Set([target])
  while (queue.length > 0) {
    const current = queue.shift() as string
    if (current === source) return true
    for (const edge of edges.filter((entry) => entry.source === current)) {
      if (seen.has(edge.target)) continue
      seen.add(edge.target)
      queue.push(edge.target)
    }
  }
  return false
}

/** 节点标题：优先用户改过的名字，否则用动作名，最后退到类型。 */
export function titleOf(node: GraphNode): string {
  if (node.data.label?.trim()) return node.data.label.trim()
  if (node.data.action) return workflowBySlug.get(node.data.action)?.name ?? node.data.action
  return node.type === 'text' ? '文本' : node.type === 'video' ? '视频' : '图片'
}

/** 该节点是否正在跑。 */
export function isRunning(data: NodeData): boolean {
  return data.taskInfo?.status === 'queued' || data.taskInfo?.status === 'running'
}
