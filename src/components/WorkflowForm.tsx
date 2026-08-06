/**
 * 工作流参数表单。
 *
 * 表单完全由定义文件驱动：新增一条工作流只改 JSON，不改这里。
 * 前端校验只为即时反馈；提交后端返回的 fieldErrors 会覆盖同名字段的提示，
 * 因为服务端才是权威判定方。
 *
 * 切换工作流时的重置由调用方传 key 完成（见 WorkflowDetail），
 * 不在这里用 effect 同步 props 到 state。
 */
import { useState } from 'react'
import { Loader2, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { WorkflowField } from '@/components/WorkflowField'
import {
  defaultParams,
  editableInputs,
  validateParams,
  type ParamValue,
  type WorkflowDefinition,
} from '@/data/workflows'

export interface WorkflowFormProps {
  workflow: WorkflowDefinition
  submitting: boolean
  disabled: boolean
  disabledReason: string | null
  /** 后端返回的逐字段错误。__form__ 为整表级错误。 */
  serverErrors: Record<string, string>
  onSubmit: (params: Record<string, ParamValue>) => void
}

export function WorkflowForm({
  workflow,
  submitting,
  disabled,
  disabledReason,
  serverErrors,
  onSubmit,
}: WorkflowFormProps) {
  const [params, setParams] = useState<Record<string, ParamValue>>(() => defaultParams(workflow))
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [submitAttempted, setSubmitAttempted] = useState(false)

  const localErrors = validateParams(workflow, params)
  const fields = editableInputs(workflow)

  const errorFor = (key: string): string | null => {
    if (serverErrors[key]) return serverErrors[key]
    if (!submitAttempted && !touched[key]) return null
    return localErrors[key] ?? null
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitAttempted(true)
    if (Object.keys(localErrors).length > 0) {
      const firstKey = fields.find((input) => localErrors[input.key])?.key
      if (firstKey) document.getElementById(firstKey)?.focus()
      return
    }
    onSubmit(params)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {fields.map((input) => (
        <WorkflowField
          key={input.key}
          input={input}
          value={params[input.key] ?? ''}
          error={errorFor(input.key)}
          onChange={(next) => setParams((prev) => ({ ...prev, [input.key]: next }))}
          onBlur={() => setTouched((prev) => ({ ...prev, [input.key]: true }))}
        />
      ))}

      {serverErrors.__form__ && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {serverErrors.__form__}
        </p>
      )}

      <div className="space-y-2 border-t border-border pt-4">
        <Button type="submit" className="w-full" disabled={submitting || disabled}>
          {submitting ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="mr-1.5 h-4 w-4" aria-hidden="true" />
          )}
          {submitting ? '提交中…' : `运行（消耗 ${workflow.costCredits} 点额度）`}
        </Button>
        {disabled && disabledReason && (
          <p className="text-xs text-muted-foreground" role="status">
            {disabledReason}
          </p>
        )}
      </div>
    </form>
  )
}
