/**
 * 工作流参数校验（服务端权威版）。
 *
 * 前端也会按同一份定义做即时校验，但那只是体验；提交进来的内容一律
 * 在这里重新判定并归一化。返回逐字段错误而不是一句笼统的「参数不合法」，
 * 表单才能把提示落到具体输入框上。
 *
 * 归一化的另一个作用是给算力方一份干净参数：去首尾空白、数字转成数字、
 * 未填的可选项直接缺省，不把空字符串透传出去。
 */
import type { WorkflowDefinition, WorkflowInput } from './definitions.ts'

export type ParamValue = string | number | boolean

export interface ParamCheckResult {
  ok: boolean
  params: Record<string, ParamValue>
  fieldErrors: Record<string, string>
}

function checkOne(input: WorkflowInput, raw: unknown): { error: string | null; value?: ParamValue } {
  if (input.type === 'toggle') {
    if (raw === undefined || raw === null) return { error: null, value: input.default === true }
    if (typeof raw !== 'boolean') return { error: `${input.label} 需为开关值` }
    return { error: null, value: raw }
  }

  if (input.type === 'number') {
    if (raw === undefined || raw === null || raw === '') {
      if (input.required) return { error: `请填写${input.label}` }
      return { error: null }
    }
    const value = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(value)) return { error: `${input.label} 需为数字` }
    if (input.min !== undefined && value < input.min) return { error: `${input.label} 不能小于 ${input.min}` }
    if (input.max !== undefined && value > input.max) return { error: `${input.label} 不能大于 ${input.max}` }
    if (input.step === 1 && !Number.isInteger(value)) return { error: `${input.label} 需为整数` }
    return { error: null, value }
  }

  if (raw !== undefined && raw !== null && typeof raw !== 'string') {
    return { error: `${input.label} 需为文本` }
  }
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) {
    if (input.required) return { error: `请填写${input.label}` }
    return { error: null }
  }

  if (input.type === 'select') {
    const allowed = (input.options ?? []).map((option) => option.value)
    if (!allowed.includes(text)) return { error: `${input.label} 取值不在可选范围内` }
    return { error: null, value: text }
  }

  if (input.type === 'image_url') {
    let parsed: URL
    try {
      parsed = new URL(text)
    } catch {
      return { error: `${input.label} 需为完整链接，以 http:// 或 https:// 开头` }
    }
    // 只放行 http(s)。javascript: 与 data: 一旦入库，结果页把它渲染成 <img src> 就成了注入面。
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { error: `${input.label} 只支持 http 或 https 链接` }
    }
  }

  if (input.minLength !== undefined && text.length < input.minLength) {
    return { error: `${input.label} 至少 ${input.minLength} 个字符` }
  }
  if (input.maxLength !== undefined && text.length > input.maxLength) {
    return { error: `${input.label} 最多 ${input.maxLength} 个字符` }
  }
  return { error: null, value: text }
}

export function checkParams(workflow: WorkflowDefinition, body: unknown): ParamCheckResult {
  const source = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const params: Record<string, ParamValue> = {}
  const fieldErrors: Record<string, string> = {}

  for (const input of workflow.inputs) {
    const { error, value } = checkOne(input, source[input.key])
    if (error) {
      fieldErrors[input.key] = error
      continue
    }
    if (value !== undefined) params[input.key] = value
  }

  // 定义之外的键不透传：避免通过额外参数影响算力方的默认行为。
  const unknownKeys = Object.keys(source).filter(
    (key) => !workflow.inputs.some((input) => input.key === key),
  )
  if (unknownKeys.length > 0) {
    fieldErrors.__form__ = `存在未定义的参数：${unknownKeys.slice(0, 5).join('、')}`
  }

  return { ok: Object.keys(fieldErrors).length === 0, params, fieldErrors }
}
