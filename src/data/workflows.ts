/**
 * 工作流定义的前端读取层。
 *
 * 约束全部写在 `workflows.json` 里（必填、长度、取值范围、可选项），
 * 前端与后端各自解释同一份声明，而不是各写一套硬编码规则。
 * 前端校验只为即时反馈，最终判定以后端返回的 `fieldErrors` 为准。
 */
import workflowsJson from './workflows.json'
import { SCENE_DEFINITIONS, toolById, type SceneSlug, type EffectiveTool } from './tools'

/** 产出形态决定结果页如何渲染：图片走画廊，视频走播放器，文本走代码块。 */
export const OUTPUT_KINDS = ['image', 'video', 'text'] as const
export type OutputKind = (typeof OUTPUT_KINDS)[number]

/** 表单控件类型。本期不含文件上传，参考图只接受公网链接。 */
export const INPUT_TYPES = ['text', 'textarea', 'select', 'number', 'toggle', 'image_url'] as const
export type InputType = (typeof INPUT_TYPES)[number]

export interface SelectOption {
  value: string
  label: string
}

export interface WorkflowInput {
  key: string
  label: string
  type: InputType
  required: boolean
  help?: string
  placeholder?: string
  default?: string | number | boolean
  minLength?: number
  maxLength?: number
  min?: number
  max?: number
  step?: number
  options?: SelectOption[]
}

export interface WorkflowDefinition {
  slug: string
  name: string
  sceneSlug: SceneSlug
  summary: string
  description: string
  /** 算力来源标识。是否真正可用由后端按凭据配置判定，前端不做假设。 */
  provider: string
  providerRef: string
  outputKind: OutputKind
  estimatedSeconds: number
  /** 一次运行消耗的额度，用于每日配额计算。 */
  costCredits: number
  relatedToolIds: number[]
  inputs: WorkflowInput[]
}

interface WorkflowsFile {
  version: number
  updatedAt: string
  workflows: WorkflowDefinition[]
}

const dataset = workflowsJson as unknown as WorkflowsFile

export const WORKFLOWS_VERSION = dataset.version
export const WORKFLOWS_UPDATED_AT = dataset.updatedAt
export const workflows: WorkflowDefinition[] = dataset.workflows

export const workflowBySlug = new Map<string, WorkflowDefinition>(
  workflows.map((workflow) => [workflow.slug, workflow]),
)

const sceneBySlug = new Map(SCENE_DEFINITIONS.map((scene) => [scene.slug, scene]))

/** 工作流所属场景的展示信息；场景定义与工具库共用一套，避免出现第二份场景枚举。 */
export function sceneOf(workflow: WorkflowDefinition) {
  return sceneBySlug.get(workflow.sceneSlug) ?? null
}

/** 关联工具用于「这条流水线背后是哪些市面工具」，缺失的 ID 直接跳过而不是报错。 */
export function relatedToolsOf(workflow: WorkflowDefinition): EffectiveTool[] {
  return workflow.relatedToolIds
    .map((id) => toolById.get(id))
    .filter((tool): tool is EffectiveTool => Boolean(tool))
}

export function workflowsByScene(slug: SceneSlug): WorkflowDefinition[] {
  return workflows.filter((workflow) => workflow.sceneSlug === slug)
}

export const OUTPUT_KIND_LABELS: Record<OutputKind, string> = {
  image: '图片',
  video: '视频',
  text: '文本',
}

export type ParamValue = string | number | boolean

/** 表单初始值。有 default 用 default，否则按控件类型给一个空值。 */
export function defaultParams(workflow: WorkflowDefinition): Record<string, ParamValue> {
  const params: Record<string, ParamValue> = {}
  for (const input of workflow.inputs) {
    if (input.default !== undefined) {
      params[input.key] = input.default
      continue
    }
    params[input.key] = input.type === 'toggle' ? false : input.type === 'number' ? (input.min ?? 0) : ''
  }
  return params
}

/**
 * 单个字段的前端校验，返回中文错误或 null。
 *
 * 规则来自定义文件本身，新增工作流不需要改这里。
 */
export function validateInput(input: WorkflowInput, raw: ParamValue | undefined): string | null {
  if (input.type === 'toggle') {
    return typeof raw === 'boolean' || raw === undefined ? null : `${input.label} 需为开关值`
  }

  if (input.type === 'number') {
    if (raw === '' || raw === undefined || raw === null) {
      return input.required ? `请填写${input.label}` : null
    }
    const value = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(value)) return `${input.label} 需为数字`
    if (input.min !== undefined && value < input.min) return `${input.label} 不能小于 ${input.min}`
    if (input.max !== undefined && value > input.max) return `${input.label} 不能大于 ${input.max}`
    if (input.step === 1 && !Number.isInteger(value)) return `${input.label} 需为整数`
    return null
  }

  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return input.required ? `请填写${input.label}` : null

  if (input.type === 'select') {
    const allowed = (input.options ?? []).map((option) => option.value)
    return allowed.includes(text) ? null : `${input.label} 取值不在可选范围内`
  }

  if (input.type === 'image_url') {
    // 只允许 http(s)，避免 javascript: 与 data: 通过参数进入后端与结果页。
    let parsed: URL
    try {
      parsed = new URL(text)
    } catch {
      return `${input.label} 需为完整链接，以 http:// 或 https:// 开头`
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return `${input.label} 只支持 http 或 https 链接`
    }
  }

  if (input.minLength !== undefined && text.length < input.minLength) {
    return `${input.label} 至少 ${input.minLength} 个字符`
  }
  if (input.maxLength !== undefined && text.length > input.maxLength) {
    return `${input.label} 最多 ${input.maxLength} 个字符`
  }
  return null
}

/** 整表校验，返回字段键到错误文案的映射；为空表示可提交。 */
export function validateParams(
  workflow: WorkflowDefinition,
  params: Record<string, ParamValue>,
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const input of workflow.inputs) {
    const error = validateInput(input, params[input.key])
    if (error) errors[input.key] = error
  }
  return errors
}
