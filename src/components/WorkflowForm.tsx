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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fieldClass } from '@/components/ui/field-styles'
import { cn } from '@/lib/utils'
import {
  defaultParams,
  validateParams,
  type ParamValue,
  type WorkflowDefinition,
  type WorkflowInput,
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

function FieldControl({
  input,
  value,
  invalid,
  onChange,
}: {
  input: WorkflowInput
  value: ParamValue
  invalid: boolean
  onChange: (next: ParamValue) => void
}) {
  const describedBy = input.help ? `${input.key}-help` : undefined
  const common = {
    id: input.key,
    'aria-invalid': invalid || undefined,
    'aria-describedby': describedBy,
  }

  if (input.type === 'textarea') {
    return (
      <textarea
        {...common}
        rows={5}
        maxLength={input.maxLength}
        placeholder={input.placeholder}
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
        className={cn(fieldClass, 'min-h-28 resize-y leading-6', invalid && 'border-destructive')}
      />
    )
  }

  if (input.type === 'select') {
    return (
      <select
        {...common}
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
        className={cn(fieldClass, invalid && 'border-destructive')}
      >
        {(input.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    )
  }

  if (input.type === 'toggle') {
    return (
      <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground/85">
        <input
          {...common}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4 rounded border-input accent-[hsl(var(--gold))]"
        />
        {input.label}
      </label>
    )
  }

  if (input.type === 'number') {
    return (
      <Input
        {...common}
        type="number"
        min={input.min}
        max={input.max}
        step={input.step ?? 1}
        value={value === '' ? '' : Number(value)}
        onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
        className={cn(invalid && 'border-destructive')}
      />
    )
  }

  return (
    <Input
      {...common}
      type={input.type === 'image_url' ? 'url' : 'text'}
      maxLength={input.maxLength}
      placeholder={input.placeholder}
      value={String(value ?? '')}
      onChange={(event) => onChange(event.target.value)}
      className={cn(invalid && 'border-destructive')}
    />
  )
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

  const errorFor = (key: string): string | null => {
    if (serverErrors[key]) return serverErrors[key]
    if (!submitAttempted && !touched[key]) return null
    return localErrors[key] ?? null
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitAttempted(true)
    if (Object.keys(localErrors).length > 0) {
      const firstKey = workflow.inputs.find((input) => localErrors[input.key])?.key
      if (firstKey) document.getElementById(firstKey)?.focus()
      return
    }
    onSubmit(params)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {workflow.inputs.map((input) => {
        const error = errorFor(input.key)
        return (
          <div key={input.key} className="space-y-1.5">
            {input.type !== 'toggle' && (
              <Label htmlFor={input.key}>
                {input.label}
                {input.required && (
                  <span className="ml-1 text-destructive" aria-hidden="true">
                    *
                  </span>
                )}
              </Label>
            )}
            <div onBlur={() => setTouched((prev) => ({ ...prev, [input.key]: true }))}>
              <FieldControl
                input={input}
                value={params[input.key]}
                invalid={Boolean(error)}
                onChange={(next) => setParams((prev) => ({ ...prev, [input.key]: next }))}
              />
            </div>
            {input.help && (
              <p id={`${input.key}-help`} className="text-xs leading-5 text-muted-foreground">
                {input.help}
              </p>
            )}
            {error && (
              <p className="text-xs font-medium text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>
        )
      })}

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
