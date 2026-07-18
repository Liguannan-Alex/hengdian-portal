import {
  Clapperboard,
  Gauge,
  Megaphone,
  Palette,
  PenLine,
  Scissors,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import sceneRulesJson from './scene-rules.json'
import editorialJson from './tool-editorial.json'
import toolsJson from './tools.json'

/** 一级分类（抓取底表的稳定值）。 */
export const CATEGORIES = ['视频AI工具', '图片AI工具', '文字创作AI工具'] as const
export type CategoryName = (typeof CATEGORIES)[number]

/** 中文场景名保留给界面展示和旧链接兼容；持久化、查询参数优先使用 SceneSlug。 */
export const SCENES = [
  '剧本创作',
  '概念美术',
  '视频生成',
  '后期制作',
  '宣发物料',
  '综合效率',
] as const
export type SceneName = (typeof SCENES)[number]

/** 稳定的场景标识，不随中文展示文案调整。 */
export type SceneSlug =
  | 'scriptwriting'
  | 'concept-art'
  | 'video-generation'
  | 'post-production'
  | 'promotion'
  | 'productivity'

export interface SceneDefinition {
  slug: SceneSlug
  name: SceneName
  icon: LucideIcon
  tagline: string
  /** 仅用于兼容旧查询参数和常见短写，不用于界面展示。 */
  aliases: readonly string[]
}

export const SCENE_DEFINITIONS = [
  {
    slug: 'scriptwriting',
    name: '剧本创作',
    icon: PenLine,
    tagline: '大纲、剧本、台词与策划文字，让 AI 协助完成第一稿。',
    aliases: ['剧本', '编剧', 'script', 'script-writing', 'writing'],
  },
  {
    slug: 'concept-art',
    name: '概念美术',
    icon: Palette,
    tagline: '概念图、分镜、海报与服化道参考，快速确定视觉方向。',
    aliases: ['美术', '概念设计', 'concept', 'conceptart', 'image'],
  },
  {
    slug: 'video-generation',
    name: '视频生成',
    icon: Clapperboard,
    tagline: '预演、动态概念与生成式镜头，低成本验证镜头创意。',
    aliases: ['视频', '预演', 'video', 'video-generation'],
  },
  {
    slug: 'post-production',
    name: '后期制作',
    icon: Scissors,
    tagline: '剪辑、字幕、抠像、修复与调色，缩短素材到成片的周期。',
    aliases: ['后期', '剪辑', 'post', 'postproduction', 'editing'],
  },
  {
    slug: 'promotion',
    name: '宣发物料',
    icon: Megaphone,
    tagline: '海报、短视频切片与宣发文案，快速形成可分发物料。',
    aliases: ['宣发', '营销', '物料', 'marketing', 'publicity'],
  },
  {
    slug: 'productivity',
    name: '综合效率',
    icon: Gauge,
    tagline: '翻译、校对、资料整理与协作，补齐剧组日常效率环节。',
    aliases: ['综合', '效率', '通用', 'general', 'efficiency'],
  },
] as const satisfies readonly SceneDefinition[]

/** v0.1 组件使用的兼容导出。 */
export type SceneInfo = SceneDefinition
export const SCENE_INFO = SCENE_DEFINITIONS

export const sceneBySlug = new Map<SceneSlug, SceneDefinition>(
  SCENE_DEFINITIONS.map((scene) => [scene.slug, scene]),
)
export const sceneByName = new Map<SceneName, SceneDefinition>(
  SCENE_DEFINITIONS.map((scene) => [scene.name, scene]),
)

function normalizeSceneToken(rawValue: string): string {
  let value = rawValue.trim().replace(/\+/g, ' ')
  try {
    value = decodeURIComponent(value)
  } catch {
    // URLSearchParams 通常已解码；遇到不完整的百分号编码时继续按原值匹配。
  }
  return value.trim().toLocaleLowerCase().replace(/[\s_]+/g, '-')
}

const sceneTokenMap = new Map<string, SceneSlug>()
for (const scene of SCENE_DEFINITIONS) {
  for (const token of [scene.slug, scene.name, ...scene.aliases]) {
    sceneTokenMap.set(normalizeSceneToken(token), scene.slug)
  }
}

/**
 * 将 URL 中的 scene 参数解析为稳定 slug。
 * 同时接受稳定 slug、中文全称、URL 编码中文和少量 v0.1 短写。
 */
export function parseSceneParam(value: string | null | undefined): SceneSlug | null {
  if (!value?.trim()) return null
  return sceneTokenMap.get(normalizeSceneToken(value)) ?? null
}

export function isSceneSlug(value: string): value is SceneSlug {
  return sceneBySlug.has(value as SceneSlug)
}

export type VerificationStatus = 'verified' | 'needs-review' | 'excluded' | 'unreviewed'

export const VERIFICATION_STATUS_LABELS: Readonly<Record<VerificationStatus, string>> = {
  verified: '已完成本轮复核',
  'needs-review': '待复核',
  excluded: '排除不展示',
  unreviewed: '未进入本轮复核',
}

/** ai-bot.cn 抓取底表字段。 */
export interface Tool {
  id: number
  name: string
  desc: string
  /** 工具官网（新窗口打开）。 */
  url: string
  /** ai-bot.cn 详情页，仅用于来源追溯。 */
  detailUrl: string
  category: CategoryName
  /** 中文场景名；供展示及 v0.1 组件兼容。 */
  scenes: SceneName[]
}

/** 编辑复核层；只保存本轮复核结论和对底表的最小覆盖。 */
export interface ToolEditorial {
  id: number
  status: VerificationStatus
  verifiedAt: string
  recommendedScenes: SceneSlug[]
  recommendationReason: string
  sortWeight: number
  url?: string
  name?: string
  desc?: string
  category?: CategoryName
  duplicateOf?: number
}

interface EditorialDataset {
  schemaVersion: string
  verifiedAt: string
  verificationMethod: string
  coreToolIds: number[]
  featuredToolIds: number[]
  entries: ToolEditorial[]
}

export interface EffectiveTool extends Tool {
  /** 供路由、筛选和持久化使用的稳定场景标识。 */
  sceneSlugs: SceneSlug[]
  verificationStatus: VerificationStatus
  verifiedAt: string | null
  recommendationReason: string | null
  sortWeight: number
  /** 来自显式 FEATURED_TOOL_IDS 白名单，不由权重自动推断。 */
  featured: boolean
  editorial: ToolEditorial | null
}

interface SceneRule {
  scene: SceneSlug
  pattern: string
}

interface SceneRegressionCase {
  id: number
  include: SceneSlug[]
  exclude: SceneSlug[]
}

interface SceneRuleDataset {
  schemaVersion: string
  method: string
  categoryRules: Record<CategoryName, SceneRule[]>
  fallbackScenes: Record<CategoryName, SceneSlug[]>
  regressionCases: SceneRegressionCase[]
}

const editorialDataset = editorialJson as EditorialDataset
const sceneRuleDataset = sceneRulesJson as SceneRuleDataset
const sourceTools = toolsJson as Tool[]
const editorialById = new Map<number, ToolEditorial>(
  editorialDataset.entries.map((entry) => [entry.id, entry]),
)

export const CORE_TOOL_IDS: readonly number[] = editorialDataset.coreToolIds
export const FEATURED_TOOL_IDS: readonly number[] = editorialDataset.featuredToolIds
export const EDITORIAL_VERIFICATION_METHOD = editorialDataset.verificationMethod
export const EDITORIAL_SCHEMA_VERSION = editorialDataset.schemaVersion
export const EDITORIAL_VERIFIED_AT = editorialDataset.verifiedAt
export const SCENE_INFERENCE_VERSION = sceneRuleDataset.schemaVersion
export const SCENE_INFERENCE_METHOD = sceneRuleDataset.method
export const SCENE_INFERENCE_REGRESSION_CASES: readonly SceneRegressionCase[] =
  sceneRuleDataset.regressionCases

const featuredToolIdSet = new Set(FEATURED_TOOL_IDS)
const TRACKING_PARAM = /^(?:utm(?:_.+)?|ref|_?f|fr|via|source(?:_?id)?|from(?:_?id)?|channel(?:code|id)?|invite(?:r)?(?:_?id|_?code)?|invitationtype|huiwainvitecode|shareruserid|share(?:r)?_?code|sid)$/i

/**
 * 页面外链统一去除来源跟踪参数和 HTML 转义；非法或非 HTTP(S) 地址降级为空入口。
 * 原始抓取 URL 仍完整保留在 tools.json 中用于追溯。
 */
export function sanitizeToolUrl(rawValue: string): string {
  const value = rawValue.trim().replaceAll('&amp;', '&')
  if (!value) return ''

  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    for (const key of [...url.searchParams.keys()]) {
      const normalizedKey = key.replace(/^amp;/i, '')
      if (TRACKING_PARAM.test(normalizedKey)) url.searchParams.delete(key)
    }
    return url.toString()
  } catch {
    return ''
  }
}

const compiledSceneRules = new Map<CategoryName, Array<{ scene: SceneSlug; pattern: RegExp }>>(
  CATEGORIES.map((category) => [
    category,
    sceneRuleDataset.categoryRules[category].map((rule) => ({
      scene: rule.scene,
      pattern: new RegExp(rule.pattern, 'i'),
    })),
  ]),
)

/**
 * 对未进入编辑复核层的工具做保守场景初筛。
 * 原始 scenes 仅保留作来源追溯，不直接进入页面筛选结果。
 */
export function inferSceneSlugs(tool: Tool): SceneSlug[] {
  const text = `${tool.name} ${tool.desc}`
  const matched = (compiledSceneRules.get(tool.category) ?? [])
    .filter((rule) => rule.pattern.test(text))
    .map((rule) => rule.scene)
  return matched.length ? [...new Set(matched)] : [...sceneRuleDataset.fallbackScenes[tool.category]]
}

function mergeTool(source: Tool): EffectiveTool | null {
  const editorial = editorialById.get(source.id) ?? null
  if (editorial?.status === 'excluded') return null

  const sceneSlugs = editorial?.recommendedScenes.length
    ? editorial.recommendedScenes
    : inferSceneSlugs(source)

  return {
    ...source,
    name: editorial?.name ?? source.name,
    desc: editorial?.desc ?? source.desc,
    url: sanitizeToolUrl(editorial?.url ?? source.url),
    category: editorial?.category ?? source.category,
    scenes: sceneSlugs.map((slug) => sceneBySlug.get(slug)?.name).filter(Boolean) as SceneName[],
    sceneSlugs,
    verificationStatus: editorial?.status ?? 'unreviewed',
    verifiedAt: editorial?.verifiedAt ?? null,
    recommendationReason: editorial?.recommendationReason ?? null,
    sortWeight: editorial?.sortWeight ?? 0,
    featured: featuredToolIdSet.has(source.id),
    editorial,
  }
}

/**
 * 页面唯一应使用的工具集合：底表 + 编辑复核覆盖 - 明确排除项。
 * 已核验工具按编辑权重在前，其余工具保持原始 ID 顺序。
 */
export const effectiveTools: EffectiveTool[] = sourceTools
  .map(mergeTool)
  .filter((tool): tool is EffectiveTool => tool !== null)
  .sort((a, b) => b.sortWeight - a.sortWeight || a.id - b.id)

/** v0.1 页面使用的兼容别名。 */
export const tools = effectiveTools

export const toolById = new Map<number, EffectiveTool>(
  effectiveTools.map((tool) => [tool.id, tool]),
)

const coreToolIdSet = new Set(CORE_TOOL_IDS)
export const coreTools = effectiveTools.filter((tool) => coreToolIdSet.has(tool.id))
export const featuredTools = effectiveTools.filter((tool) => tool.featured)
