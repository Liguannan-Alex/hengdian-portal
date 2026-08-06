/**
 * 工作流定义门禁。
 *
 * 工作流定义同时驱动前端表单、后端参数校验与派单，写错一个字段类型
 * 就会在运行时才暴露，因此在提交前先做结构校验，与 validate-tools 同级。
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflowsPath = path.join(projectRoot, 'src/data/workflows.json')
const toolsPath = path.join(projectRoot, 'src/data/tools.json')

export const SCENE_SLUGS = new Set([
  'scriptwriting',
  'concept-art',
  'video-generation',
  'post-production',
  'promotion',
  'productivity',
])

export const OUTPUT_KINDS = new Set(['image', 'video', 'text'])
export const SURFACES = new Set(['library', 'canvas'])
export const INPUT_TYPES = new Set(['text', 'textarea', 'select', 'number', 'toggle', 'image_url'])

const SLUG_PATTERN = /^[a-z][a-z0-9-]{1,48}[a-z0-9]$/
const KEY_PATTERN = /^[a-z][a-zA-Z0-9]{0,38}$/
const PROVIDER_PATTERN = /^[a-z][a-z0-9-]{1,30}$/

export async function loadWorkflowData() {
  const [workflows, tools] = await Promise.all([
    readFile(workflowsPath, 'utf8').then(JSON.parse),
    readFile(toolsPath, 'utf8').then(JSON.parse),
  ])
  return { workflows, tools }
}

export function validateWorkflowData(dataset, tools) {
  const errors = []
  const addError = (message) => errors.push(message)

  if (!dataset || typeof dataset !== 'object') {
    return { errors: ['workflows.json 顶层需为对象'], summary: null }
  }
  if (dataset.version !== 1) addError('workflows.json 的 version 当前只支持 1')
  if (!Array.isArray(dataset.workflows) || dataset.workflows.length === 0) {
    return { errors: [...errors, 'workflows 需为非空数组'], summary: null }
  }

  const toolIds = new Set((Array.isArray(tools) ? tools : []).map((tool) => tool.id))
  const seenSlugs = new Set()
  const providers = new Set()
  const coveredScenes = new Set()
  let inputCount = 0
  let libraryCount = 0
  let canvasCount = 0

  for (const workflow of dataset.workflows) {
    const label = workflow?.slug ?? '(缺少 slug)'

    if (typeof workflow.slug !== 'string' || !SLUG_PATTERN.test(workflow.slug)) {
      addError(`工作流 ${label} 的 slug 需为小写字母、数字与连字符组成的稳定标识`)
    }
    if (seenSlugs.has(workflow.slug)) addError(`工作流 slug 重复: ${workflow.slug}`)
    seenSlugs.add(workflow.slug)

    for (const field of ['name', 'summary', 'description', 'providerRef']) {
      if (typeof workflow[field] !== 'string' || !workflow[field].trim()) {
        addError(`工作流 ${label} 缺少 ${field}`)
      }
    }
    if (typeof workflow.provider !== 'string' || !PROVIDER_PATTERN.test(workflow.provider)) {
      addError(`工作流 ${label} 的 provider 不合法`)
    } else {
      providers.add(workflow.provider)
    }
    if (!SURFACES.has(workflow.surface)) {
      addError(`工作流 ${label} 的 surface 需为 library 或 canvas，当前: ${workflow.surface}`)
    }
    if (!SCENE_SLUGS.has(workflow.sceneSlug)) {
      addError(`工作流 ${label} 的 sceneSlug 非法: ${workflow.sceneSlug}`)
    } else if (workflow.surface === 'library') {
      // 场景覆盖只统计列表里露出的流水线：画布操作不需要在场景导航中出现。
      coveredScenes.add(workflow.sceneSlug)
    }
    if (workflow.surface === 'library') libraryCount += 1
    if (workflow.surface === 'canvas') canvasCount += 1
    if (!OUTPUT_KINDS.has(workflow.outputKind)) {
      addError(`工作流 ${label} 的 outputKind 非法: ${workflow.outputKind}`)
    }
    if (!Number.isInteger(workflow.estimatedSeconds) || workflow.estimatedSeconds <= 0) {
      addError(`工作流 ${label} 的 estimatedSeconds 需为正整数`)
    }
    if (!Number.isInteger(workflow.costCredits) || workflow.costCredits <= 0) {
      addError(`工作流 ${label} 的 costCredits 需为正整数，配额按它扣减`)
    }

    if (!Array.isArray(workflow.relatedToolIds)) {
      addError(`工作流 ${label} 的 relatedToolIds 需为数组`)
    } else {
      for (const id of workflow.relatedToolIds) {
        if (!toolIds.has(id)) addError(`工作流 ${label} 关联了不存在的工具 ID ${id}`)
      }
    }

    if (!Array.isArray(workflow.inputs) || workflow.inputs.length === 0) {
      addError(`工作流 ${label} 需至少定义一个输入字段`)
      continue
    }

    const seenKeys = new Set()
    let hasRequired = false

    for (const input of workflow.inputs) {
      inputCount += 1
      const inputLabel = `${label}.${input?.key ?? '(缺少 key)'}`

      if (typeof input.key !== 'string' || !KEY_PATTERN.test(input.key)) {
        addError(`字段 ${inputLabel} 的 key 需为小驼峰标识`)
      }
      if (seenKeys.has(input.key)) addError(`字段 key 在同一工作流内重复: ${inputLabel}`)
      seenKeys.add(input.key)

      if (typeof input.label !== 'string' || !input.label.trim()) addError(`字段 ${inputLabel} 缺少 label`)
      if (!INPUT_TYPES.has(input.type)) addError(`字段 ${inputLabel} 的 type 非法: ${input.type}`)
      if (typeof input.required !== 'boolean') addError(`字段 ${inputLabel} 的 required 需为布尔值`)
      if (input.required) hasRequired = true

      if (input.supplied !== undefined) {
        if (input.supplied !== 'canvas') {
          addError(`字段 ${inputLabel} 的 supplied 目前只支持 canvas`)
        } else if (workflow.surface !== 'canvas') {
          addError(`字段 ${inputLabel} 标了 supplied=canvas，但所属工作流不在画布上`)
        } else if (!input.required) {
          // 画布自动填的字段若可选，忘了填也不会报错，问题会推迟到算力方才暴露。
          addError(`字段 ${inputLabel} 由画布填入，必须是必填字段`)
        }
      }

      if (input.type === 'select') {
        if (!Array.isArray(input.options) || input.options.length < 2) {
          addError(`字段 ${inputLabel} 为下拉框，需至少两个选项`)
        } else {
          const values = input.options.map((option) => option.value)
          if (new Set(values).size !== values.length) addError(`字段 ${inputLabel} 的选项值重复`)
          for (const option of input.options) {
            if (typeof option.value !== 'string' || !option.value.trim()) {
              addError(`字段 ${inputLabel} 存在空选项值`)
            }
            if (typeof option.label !== 'string' || !option.label.trim()) {
              addError(`字段 ${inputLabel} 存在空选项文案`)
            }
          }
          if (input.default !== undefined && !values.includes(input.default)) {
            addError(`字段 ${inputLabel} 的默认值不在选项内`)
          }
        }
      } else if (input.options !== undefined) {
        addError(`字段 ${inputLabel} 不是下拉框，不应带 options`)
      }

      if (input.type === 'number') {
        if (!Number.isFinite(input.min) || !Number.isFinite(input.max)) {
          addError(`字段 ${inputLabel} 为数字，必须同时声明 min 与 max，避免向算力方提交无上限参数`)
        } else if (input.min > input.max) {
          addError(`字段 ${inputLabel} 的 min 大于 max`)
        } else if (input.default !== undefined && (input.default < input.min || input.default > input.max)) {
          addError(`字段 ${inputLabel} 的默认值超出 min/max 范围`)
        }
      }

      if (['text', 'textarea', 'image_url'].includes(input.type)) {
        if (!Number.isInteger(input.maxLength) || input.maxLength <= 0) {
          addError(`字段 ${inputLabel} 为文本，必须声明 maxLength，避免提交无上限内容`)
        }
        if (input.minLength !== undefined && input.minLength > (input.maxLength ?? 0)) {
          addError(`字段 ${inputLabel} 的 minLength 大于 maxLength`)
        }
      }

      if (input.default !== undefined) {
        const expected =
          input.type === 'toggle' ? 'boolean' : input.type === 'number' ? 'number' : 'string'
        if (typeof input.default !== expected) {
          addError(`字段 ${inputLabel} 的默认值类型应为 ${expected}`)
        }
      }
    }

    if (!hasRequired) addError(`工作流 ${label} 没有任何必填字段，无法判断提交是否有效`)

    if (workflow.surface === 'canvas') {
      const source = workflow.inputs.find((input) => input.key === 'sourceUrl')
      if (!source || source.supplied !== 'canvas') {
        addError(`画布操作 ${label} 必须有由画布填入的 sourceUrl 字段`)
      }
      // 画布操作至少要留一个用户能填的字段，否则它就是个没有可调参数的按钮。
      if (!workflow.inputs.some((input) => input.supplied === undefined)) {
        addError(`画布操作 ${label} 全部字段都由画布填入，用户没有任何可调参数`)
      }
    }
  }

  return {
    errors,
    summary: {
      workflows: dataset.workflows.length,
      libraryWorkflows: libraryCount,
      canvasWorkflows: canvasCount,
      inputs: inputCount,
      providers: [...providers].sort(),
      coveredScenes: [...coveredScenes].sort(),
      outputKinds: [...new Set(dataset.workflows.map((workflow) => workflow.outputKind))].sort(),
      totalCostCredits: dataset.workflows.reduce((sum, workflow) => sum + (workflow.costCredits ?? 0), 0),
    },
  }
}

export async function validateWorkflows() {
  const { workflows, tools } = await loadWorkflowData()
  return validateWorkflowData(workflows, tools)
}

async function main() {
  const result = await validateWorkflows()
  if (result.errors.length) {
    console.error(`工作流定义校验失败（${result.errors.length} 项）：`)
    for (const error of result.errors) console.error(`- ${error}`)
    process.exitCode = 1
    return
  }
  console.log('工作流定义校验通过')
  console.log(JSON.stringify(result.summary, null, 2))
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) await main()
