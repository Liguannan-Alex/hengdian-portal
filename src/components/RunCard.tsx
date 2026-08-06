/**
 * 任务卡片：状态、参数回显与产出。
 *
 * 产出链接来自算力方，一律作为普通外链和媒体资源渲染，不做任何富文本解析；
 * 参数里的文本按纯文本显示，避免用户贴进来的内容被当成标记执行。
 */
import { useState } from 'react'
import { Ban, CircleAlert, Clock3, Copy, ExternalLink, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { RUN_STATUS_LABELS, isTerminal, type RunStatus, type WorkflowRun } from '@/lib/portalApi'
import { workflowBySlug } from '@/data/workflows'

const STATUS_STYLES: Record<RunStatus, string> = {
  queued: 'border-border bg-muted text-muted-foreground',
  running: 'border-gold/30 bg-gold/10 text-gold-soft',
  succeeded: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
  failed: 'border-destructive/30 bg-destructive/10 text-red-300',
  canceled: 'border-border bg-muted text-muted-foreground',
}

function formatTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function TextOutput({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // 剪贴板不可用时不打断阅读，用户仍可手动选中复制。
      setCopied(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-background/60">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs text-muted-foreground">文本产出</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap px-3 py-3 text-sm leading-6 text-foreground/85">
        {text}
      </pre>
    </div>
  )
}

export interface RunCardProps {
  run: WorkflowRun
  onCancel?: (id: number) => void
  canceling?: boolean
}

export function RunCard({ run, onCancel, canceling }: RunCardProps) {
  const definition = workflowBySlug.get(run.workflowSlug)
  const active = !isTerminal(run.status)

  return (
    <Card className="glass-panel gap-0 overflow-hidden !border-paper/[0.09] bg-transparent shadow-lg shadow-black/30">
      <CardHeader className="gap-2 border-b border-border/75 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={cn('gap-1 font-normal', STATUS_STYLES[run.status])}>
            {run.status === 'running' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {run.status === 'queued' && <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />}
            {run.status === 'failed' && <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />}
            {run.status === 'canceled' && <Ban className="h-3.5 w-3.5" aria-hidden="true" />}
            {RUN_STATUS_LABELS[run.status]}
          </Badge>
          <span className="text-xs text-muted-foreground">#{run.id}</span>
          <span className="text-xs text-muted-foreground">{formatTime(run.createdAt)}</span>
          <span className="text-xs text-muted-foreground">消耗 {run.costCredits} 点</span>
        </div>
        <CardTitle className="text-base leading-snug">{run.workflowName}</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4 pt-4">
        <dl className="grid gap-1.5 text-xs">
          {Object.entries(run.params).map(([key, value]) => {
            const input = definition?.inputs.find((item) => item.key === key)
            const optionLabel =
              input?.type === 'select'
                ? input.options?.find((option) => option.value === value)?.label
                : null
            return (
              <div key={key} className="flex gap-2">
                <dt className="w-24 shrink-0 text-muted-foreground">{input?.label ?? key}</dt>
                <dd className="min-w-0 flex-1 truncate text-foreground/80" title={String(value)}>
                  {optionLabel ?? (typeof value === 'boolean' ? (value ? '是' : '否') : String(value))}
                </dd>
              </div>
            )
          })}
        </dl>

        {run.status === 'failed' && run.error && (
          <p className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-red-300" role="alert">
            {run.error}
          </p>
        )}

        {run.outputs.length > 0 && (
          <div className="space-y-3">
            {run.outputKind === 'text' ? (
              run.outputs.map((output, index) => (
                <TextOutput key={index} text={output.text ?? ''} />
              ))
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {run.outputs.map((output, index) =>
                  output.url ? (
                    <a
                      key={index}
                      href={output.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group relative block overflow-hidden rounded-lg border border-border"
                    >
                      <img
                        src={output.url}
                        alt={output.label ?? `产出 ${index + 1}`}
                        loading="lazy"
                        className="aspect-video w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                      <span className="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-ink/75 px-2 py-1 text-[0.68rem] text-paper/85">
                        {output.label ?? `产出 ${index + 1}`}
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </span>
                    </a>
                  ) : null,
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>

      {active && onCancel && (
        <CardFooter className="mt-4 border-t border-paper/[0.07] bg-paper/[0.02] pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onCancel(run.id)}
            disabled={canceling}
            className="w-full"
          >
            {canceling ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            取消任务
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}
