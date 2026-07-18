import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const toolsPath = path.join(projectRoot, 'src/data/tools.json')
const editorialPath = path.join(projectRoot, 'src/data/tool-editorial.json')
const sceneRulesPath = path.join(projectRoot, 'src/data/scene-rules.json')

export const SCENE_SLUGS = new Set([
  'scriptwriting',
  'concept-art',
  'video-generation',
  'post-production',
  'promotion',
  'productivity',
])

const SCENE_NAMES = new Set([
  '剧本创作',
  '概念美术',
  '视频生成',
  '后期制作',
  '宣发物料',
  '综合效率',
])

const CATEGORIES = new Set(['视频AI工具', '图片AI工具', '文字创作AI工具'])
const STATUSES = new Set(['verified', 'needs-review', 'excluded', 'unreviewed'])
const TRACKING_PARAM = /^(?:utm(?:_.+)?|ref|_?f|fr|via|source(?:_?id)?|from(?:_?id)?|channel(?:code|id)?|invite(?:r)?(?:_?id|_?code)?|invitationtype|huiwainvitecode|shareruserid|share(?:r)?_?code|sid)$/i

function normalizedName(value) {
  return String(value).trim().toLocaleLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '')
}

function duplicateValues(values) {
  const seen = new Set()
  const duplicates = new Set()
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return [...duplicates]
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
}

function hasTrackingParams(rawUrl) {
  try {
    const url = new URL(String(rawUrl).replaceAll('&amp;', '&'))
    return [...url.searchParams.keys()].some((key) => TRACKING_PARAM.test(key.replace(/^amp;/i, '')))
  } catch {
    return false
  }
}

export function sanitizeToolUrl(rawValue) {
  const value = String(rawValue ?? '').trim().replaceAll('&amp;', '&')
  if (!value) return ''
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key.replace(/^amp;/i, ''))) url.searchParams.delete(key)
    }
    return url.toString()
  } catch {
    return ''
  }
}

function duplicateKeyForUrl(rawValue) {
  const cleaned = sanitizeToolUrl(rawValue)
  if (!cleaned) return ''
  const url = new URL(cleaned)
  url.hash = ''
  const value = url.toString()
  return url.pathname === '/' && !url.search ? value.replace(/\/$/, '') : value
}

export async function loadToolData() {
  const [tools, editorial, sceneRules] = await Promise.all([
    readFile(toolsPath, 'utf8').then(JSON.parse),
    readFile(editorialPath, 'utf8').then(JSON.parse),
    readFile(sceneRulesPath, 'utf8').then(JSON.parse),
  ])
  return { tools, editorial, sceneRules }
}

export function inferSceneSlugs(tool, sceneRules) {
  const text = `${tool.name} ${tool.desc}`
  const rules = sceneRules.categoryRules[tool.category] ?? []
  const matched = rules
    .filter((rule) => new RegExp(rule.pattern, 'i').test(text))
    .map((rule) => rule.scene)
  return matched.length ? [...new Set(matched)] : [...(sceneRules.fallbackScenes[tool.category] ?? [])]
}

export function validateToolData(tools, editorial, sceneRules) {
  const errors = []
  const addError = (message) => errors.push(message)

  if (!Array.isArray(tools)) addError('tools.json 顶层必须是数组')
  if (!editorial || typeof editorial !== 'object') addError('tool-editorial.json 顶层必须是对象')
  if (!sceneRules || typeof sceneRules !== 'object') addError('scene-rules.json 顶层必须是对象')
  if (errors.length) return { errors, summary: null }

  const toolIds = tools.map((tool) => tool.id)
  const duplicateToolIds = duplicateValues(toolIds)
  if (duplicateToolIds.length) addError(`tools.json 存在重复 ID: ${duplicateToolIds.join(', ')}`)

  const toolById = new Map(tools.map((tool) => [tool.id, tool]))
  for (const tool of tools) {
    if (!Number.isInteger(tool.id) || tool.id <= 0) addError(`工具 ID 必须是正整数: ${tool.id}`)
    if (!tool.name?.trim()) addError(`工具 ${tool.id} 缺少名称`)
    if (!CATEGORIES.has(tool.category)) addError(`工具 ${tool.id} 使用非法分类: ${tool.category}`)
    if (!Array.isArray(tool.scenes) || tool.scenes.some((scene) => !SCENE_NAMES.has(scene))) {
      addError(`工具 ${tool.id} 使用非法中文场景: ${JSON.stringify(tool.scenes)}`)
    }
  }

  const entries = Array.isArray(editorial.entries) ? editorial.entries : []
  const coreToolIds = Array.isArray(editorial.coreToolIds) ? editorial.coreToolIds : []
  const featuredToolIds = Array.isArray(editorial.featuredToolIds) ? editorial.featuredToolIds : []
  const duplicateEditorialIds = duplicateValues(entries.map((entry) => entry.id))
  const duplicateCoreIds = duplicateValues(coreToolIds)
  const duplicateFeaturedIds = duplicateValues(featuredToolIds)

  if (duplicateEditorialIds.length) addError(`编辑层存在重复 ID: ${duplicateEditorialIds.join(', ')}`)
  if (duplicateCoreIds.length) addError(`核心白名单存在重复 ID: ${duplicateCoreIds.join(', ')}`)
  if (duplicateFeaturedIds.length) addError(`精选白名单存在重复 ID: ${duplicateFeaturedIds.join(', ')}`)
  if (coreToolIds.length !== 50) addError(`核心白名单必须恰好 50 条，当前为 ${coreToolIds.length} 条`)
  if (!featuredToolIds.length) addError('精选工具必须使用非空的 featuredToolIds 显式白名单')

  const editorialById = new Map(entries.map((entry) => [entry.id, entry]))

  for (const category of CATEGORIES) {
    const rules = sceneRules.categoryRules?.[category]
    const fallbackScenes = sceneRules.fallbackScenes?.[category]
    if (!Array.isArray(rules) || !rules.length) {
      addError(`场景规则缺少分类: ${category}`)
      continue
    }
    for (const rule of rules) {
      if (!SCENE_SLUGS.has(rule.scene)) addError(`场景规则 ${category} 使用非法 slug: ${rule.scene}`)
      try {
        new RegExp(rule.pattern, 'i')
      } catch {
        addError(`场景规则 ${category}/${rule.scene} 的正则表达式非法: ${rule.pattern}`)
      }
    }
    if (!Array.isArray(fallbackScenes) || !fallbackScenes.length) {
      addError(`场景规则缺少 fallback: ${category}`)
    } else {
      for (const scene of fallbackScenes) {
        if (!SCENE_SLUGS.has(scene)) addError(`场景规则 ${category} 的 fallback 非法: ${scene}`)
      }
    }
  }

  const regressionCases = Array.isArray(sceneRules.regressionCases) ? sceneRules.regressionCases : []
  if (!regressionCases.length) addError('scene-rules.json 必须提供明显错标回归样例')
  for (const regressionCase of regressionCases) {
    const tool = toolById.get(regressionCase.id)
    if (!tool) {
      addError(`场景规则回归样例 ID ${regressionCase.id} 不存在`)
      continue
    }
    const inferred = inferSceneSlugs(tool, sceneRules)
    for (const scene of regressionCase.include ?? []) {
      if (!inferred.includes(scene)) {
        addError(`场景规则回归失败：工具 ${tool.id}:${tool.name} 应包含 ${scene}，实际为 ${inferred.join(', ')}`)
      }
    }
    for (const scene of regressionCase.exclude ?? []) {
      if (inferred.includes(scene)) {
        addError(`场景规则回归失败：工具 ${tool.id}:${tool.name} 不应包含 ${scene}，实际为 ${inferred.join(', ')}`)
      }
    }
  }

  for (const entry of entries) {
    if (!toolById.has(entry.id)) addError(`编辑层 ID ${entry.id} 不存在于 tools.json`)
    if (!STATUSES.has(entry.status)) addError(`编辑层 ID ${entry.id} 使用非法状态: ${entry.status}`)
    if (!isIsoDate(entry.verifiedAt)) addError(`编辑层 ID ${entry.id} 缺少合法 verifiedAt 日期`)
    if (!Array.isArray(entry.recommendedScenes)) {
      addError(`编辑层 ID ${entry.id} 的 recommendedScenes 必须是数组`)
    } else {
      for (const scene of entry.recommendedScenes) {
        if (!SCENE_SLUGS.has(scene)) addError(`编辑层 ID ${entry.id} 使用非法场景 slug: ${scene}`)
      }
    }
    if (!Number.isFinite(entry.sortWeight)) addError(`编辑层 ID ${entry.id} 缺少数值 sortWeight`)

    if (entry.status === 'verified') {
      if (!entry.recommendationReason?.trim()) addError(`已核验工具 ${entry.id} 缺少推荐理由`)
      try {
        const url = new URL(entry.url)
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol')
      } catch {
        addError(`已核验工具 ${entry.id} 缺少合法 canonical URL: ${entry.url ?? '(empty)'}`)
      }
      if (hasTrackingParams(entry.url)) addError(`已核验工具 ${entry.id} 的 URL 仍含跟踪参数: ${entry.url}`)
      if (!entry.recommendedScenes?.length) addError(`已核验工具 ${entry.id} 至少需要一个推荐场景`)
    }

    if (entry.status === 'excluded') {
      if (!Number.isInteger(entry.duplicateOf) || !toolById.has(entry.duplicateOf)) {
        addError(`排除项 ${entry.id} 必须指向存在的 duplicateOf`)
      }
      if (entry.duplicateOf === entry.id) addError(`排除项 ${entry.id} 不能指向自身`)
    }
  }

  for (const id of coreToolIds) {
    const entry = editorialById.get(id)
    if (!toolById.has(id)) addError(`核心工具 ${id} 不存在于 tools.json`)
    if (!entry) addError(`核心工具 ${id} 缺少编辑复核记录`)
    else if (entry.status !== 'verified') addError(`核心工具 ${id} 必须为 verified，当前为 ${entry.status}`)
  }

  for (const id of featuredToolIds) {
    const entry = editorialById.get(id)
    if (!coreToolIds.includes(id)) addError(`精选工具 ${id} 必须同时位于核心白名单`)
    if (!entry || entry.status !== 'verified') addError(`精选工具 ${id} 必须完成本轮复核`)
  }

  const excludedIds = new Set(
    entries.filter((entry) => entry.status === 'excluded').map((entry) => entry.id),
  )

  const emptyEffectiveToolIds = []
  const invalidEffectiveToolIds = []
  const trackingInputToolIds = []
  const remainingTrackingToolIds = []
  const effectiveToolsByUrl = new Map()

  for (const tool of tools) {
    if (excludedIds.has(tool.id)) continue
    const entry = editorialById.get(tool.id)
    const rawUrl = entry?.url ?? tool.url ?? ''
    if (!String(rawUrl).trim()) {
      emptyEffectiveToolIds.push(tool.id)
      if (entry?.status !== 'needs-review' || !entry.recommendationReason?.trim()) {
        addError(`空官网入口工具 ${tool.id}:${tool.name} 必须显式标为 needs-review 并说明原因`)
      }
      continue
    }

    if (hasTrackingParams(rawUrl)) trackingInputToolIds.push(tool.id)
    const cleanedUrl = sanitizeToolUrl(rawUrl)
    if (!cleanedUrl) {
      invalidEffectiveToolIds.push(tool.id)
      addError(`有效工具 ${tool.id}:${tool.name} 使用非法官网 URL: ${rawUrl}`)
      continue
    }
    if (hasTrackingParams(cleanedUrl)) {
      remainingTrackingToolIds.push(tool.id)
      addError(`有效工具 ${tool.id}:${tool.name} 清理后仍含跟踪参数: ${cleanedUrl}`)
    }

    const duplicateKey = duplicateKeyForUrl(cleanedUrl)
    const sameUrlTools = effectiveToolsByUrl.get(duplicateKey) ?? []
    sameUrlTools.push({ id: tool.id, name: tool.name })
    effectiveToolsByUrl.set(duplicateKey, sameUrlTools)
  }

  const duplicateEffectiveUrlGroups = [...effectiveToolsByUrl.entries()]
    .filter(([, sameUrlTools]) => sameUrlTools.length > 1)
    .map(([url, sameUrlTools]) => ({ url, tools: sameUrlTools }))

  const toolsByName = Map.groupBy(tools, (tool) => normalizedName(tool.name))
  for (const sameNameTools of toolsByName.values()) {
    if (sameNameTools.length < 2) continue
    const active = sameNameTools.filter((tool) => !excludedIds.has(tool.id))
    if (active.length > 1) {
      addError(
        `同名工具未收束为单一有效条目: ${sameNameTools.map((tool) => `${tool.id}:${tool.name}`).join(' / ')}`,
      )
    }
  }

  const verifiedEntries = entries.filter((entry) => entry.status === 'verified')
  const coveredScenes = new Set(verifiedEntries.flatMap((entry) => entry.recommendedScenes))
  for (const scene of SCENE_SLUGS) {
    if (!coveredScenes.has(scene)) addError(`核心编辑层未覆盖场景: ${scene}`)
  }

  const effectiveSceneCounts = Object.fromEntries([...SCENE_SLUGS].map((scene) => [scene, 0]))
  for (const tool of tools) {
    const editorialEntry = editorialById.get(tool.id)
    if (editorialEntry?.status === 'excluded') continue
    const scenes = editorialEntry?.recommendedScenes?.length
      ? editorialEntry.recommendedScenes
      : inferSceneSlugs(tool, sceneRules)
    if (!scenes.length) addError(`有效工具 ${tool.id}:${tool.name} 未得到任何场景`)
    for (const scene of scenes) {
      if (!SCENE_SLUGS.has(scene)) addError(`有效工具 ${tool.id}:${tool.name} 得到非法场景 ${scene}`)
      else effectiveSceneCounts[scene] += 1
    }
  }

  return {
    errors,
    summary: {
      sourceTools: tools.length,
      effectiveTools: tools.length - excludedIds.size,
      editorialEntries: entries.length,
      coreTools: coreToolIds.length,
      featuredTools: featuredToolIds.length,
      excludedTools: excludedIds.size,
      coveredScenes: [...coveredScenes].sort(),
      inferredRegressionCases: regressionCases.length,
      effectiveSceneCounts,
      linkStatus: {
        emptyEffectiveToolIds,
        invalidEffectiveToolIds,
        trackingParametersRemoved: trackingInputToolIds.length,
        remainingTrackingToolIds,
        duplicateEffectiveUrlGroups,
      },
    },
  }
}

export async function validateTools() {
  const { tools, editorial, sceneRules } = await loadToolData()
  return validateToolData(tools, editorial, sceneRules)
}

async function main() {
  const result = await validateTools()
  if (result.errors.length) {
    console.error(`数据校验失败（${result.errors.length} 项）：`)
    for (const error of result.errors) console.error(`- ${error}`)
    process.exitCode = 1
    return
  }
  console.log('数据校验通过')
  console.log(JSON.stringify(result.summary, null, 2))
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) await main()
