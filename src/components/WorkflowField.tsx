/**
 * 单个工作流参数的渲染。
 *
 * 抽出来是因为它有两个使用方：工作流详情页的完整表单，和画布上的操作面板。
 * 两处若各写一份，控件行为（数字清空、下拉取值、无障碍属性）迟早会走偏。
 */
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fieldClass } from '@/components/ui/field-styles'
import { cn } from '@/lib/utils'
import type { ParamValue, WorkflowInput } from '@/data/workflows'

export interface WorkflowFieldProps {
  input: WorkflowInput
  value: ParamValue
  error: string | null
  /** 同一页面可能出现多个同名字段（画布面板与表单），用前缀区分 DOM id。 */
  idPrefix?: string
  compact?: boolean
  onChange: (next: ParamValue) => void
  onBlur?: () => void
}

export function WorkflowField({
  input,
  value,
  error,
  idPrefix = '',
  compact = false,
  onChange,
  onBlur,
}: WorkflowFieldProps) {
  const id = `${idPrefix}${input.key}`
  const describedBy = input.help ? `${id}-help` : undefined
  const invalid = Boolean(error)
  const common = { id, 'aria-invalid': invalid || undefined, 'aria-describedby': describedBy }

  let control
  if (input.type === 'textarea') {
    control = (
      <textarea
        {...common}
        rows={compact ? 3 : 5}
        maxLength={input.maxLength}
        placeholder={input.placeholder}
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          fieldClass,
          'resize-y leading-6',
          compact ? 'min-h-16' : 'min-h-28',
          invalid && 'border-destructive',
        )}
      />
    )
  } else if (input.type === 'select') {
    control = (
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
  } else if (input.type === 'toggle') {
    control = (
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
  } else if (input.type === 'number') {
    control = (
      <Input
        {...common}
        type="number"
        min={input.min}
        max={input.max}
        step={input.step ?? 1}
        value={value === '' ? '' : Number(value)}
        // 允许暂时清空：边输边判会在删到空时立刻塞回 0，没法改数。
        onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
        className={cn(invalid && 'border-destructive')}
      />
    )
  } else {
    control = (
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

  return (
    <div className="space-y-1.5" onBlur={onBlur}>
      {input.type !== 'toggle' && (
        <Label htmlFor={id} className={compact ? 'text-xs' : undefined}>
          {input.label}
          {input.required && (
            <span className="ml-1 text-destructive" aria-hidden="true">
              *
            </span>
          )}
        </Label>
      )}
      {control}
      {input.help && !compact && (
        <p id={`${id}-help`} className="text-xs leading-5 text-muted-foreground">
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
}
