/**
 * 工作流详情：填参数、提交、就地看结果。
 *
 * 提交成功后不跳转，而是把新任务顶在右侧栏并开始轮询——用户此刻的问题是
 * 「跑出来了吗」，跳走一次就得再找回来。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CircleAlert, ExternalLink, ListChecks } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DemoBanner } from '@/components/DemoBanner'
import { RunCard } from '@/components/RunCard'
import { ServerAccountBar, ServerAccountGate } from '@/components/ServerAccountGate'
import { WorkflowForm } from '@/components/WorkflowForm'
import { useServerAccount } from '@/lib/serverAccount'
import {
  ApiError,
  cancelRun,
  fetchQuota,
  fetchRun,
  isTerminal,
  submitRun,
  trackWorkflow,
  type Quota,
  type WorkflowAvailability,
  type WorkflowRun,
} from '@/lib/portalApi'
import { api } from '@/lib/portalApi'
import {
  OUTPUT_KIND_LABELS,
  relatedToolsOf,
  sceneOf,
  workflowBySlug,
  type ParamValue,
  type WorkflowDefinition,
} from '@/data/workflows'
import NotFound from '@/pages/NotFound'

/** 任务未结束时的轮询间隔。够快让人感到有反馈，又不至于把后端问穿。 */
const POLL_MS = 2500

function WorkflowRunner({ workflow }: { workflow: WorkflowDefinition }) {
  const [availability, setAvailability] = useState<WorkflowAvailability | null>(null)
  const [quota, setQuota] = useState<Quota | null>(null)
  const [run, setRun] = useState<WorkflowRun | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [canceling, setCanceling] = useState(false)
  const pollTimer = useRef<number | null>(null)

  const refreshQuota = useCallback(() => {
    fetchQuota()
      .then(setQuota)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    let alive = true
    api<{ workflow: WorkflowAvailability }>(`/api/workflows/${workflow.slug}`)
      .then(({ workflow: info }) => {
        if (alive) setAvailability(info)
      })
      .catch(() => undefined)
    refreshQuota()
    return () => {
      alive = false
    }
  }, [workflow.slug, refreshQuota])

  // 任务未进入终态时持续轮询；终态立刻停表，不留后台空转。
  useEffect(() => {
    if (!run || isTerminal(run.status)) {
      if (pollTimer.current) window.clearInterval(pollTimer.current)
      pollTimer.current = null
      return
    }
    pollTimer.current = window.setInterval(() => {
      fetchRun(run.id)
        .then((fresh) => {
          setRun(fresh)
          if (isTerminal(fresh.status)) refreshQuota()
        })
        .catch(() => undefined)
    }, POLL_MS)
    return () => {
      if (pollTimer.current) window.clearInterval(pollTimer.current)
      pollTimer.current = null
    }
  }, [run, refreshQuota])

  const handleSubmit = async (params: Record<string, ParamValue>) => {
    setSubmitting(true)
    setFormError(null)
    setServerErrors({})
    try {
      const { run: created } = await submitRun(workflow.slug, params)
      setRun(created)
      trackWorkflow('workflow_submit', workflow.slug, '/workflows/detail', workflow.sceneSlug)
      refreshQuota()
    } catch (error) {
      if (error instanceof ApiError) {
        setServerErrors(error.fieldErrors)
        // 字段级错误已经落到对应输入框，顶部只显示整体性问题，避免重复。
        if (Object.keys(error.fieldErrors).length === 0) setFormError(error.message)
      } else {
        setFormError('提交失败，请重试')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleCancel = async (id: number) => {
    setCanceling(true)
    try {
      await cancelRun(id)
      setRun(await fetchRun(id))
      refreshQuota()
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : '取消失败')
    } finally {
      setCanceling(false)
    }
  }

  const outOfQuota = quota !== null && quota.remainingCredits < workflow.costCredits
  const tooManyPending = quota !== null && quota.pendingRuns >= quota.pendingLimit
  const notRunnable = availability !== null && !availability.runnable

  const disabledReason = notRunnable
    ? availability?.unavailableReason
    : outOfQuota
      ? `今日额度剩余 ${quota?.remainingCredits} 点，本次需要 ${workflow.costCredits} 点。`
      : tooManyPending
        ? `已有 ${quota?.pendingRuns} 个任务在队列中，等其中一个结束后再提交。`
        : null

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <section aria-labelledby="params-heading">
        <h2 id="params-heading" className="mb-4 text-lg font-semibold text-paper">
          参数
        </h2>
        {formError && (
          <p className="mb-4 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-red-300" role="alert">
            {formError}
          </p>
        )}
        <WorkflowForm
          key={workflow.slug}
          workflow={workflow}
          submitting={submitting}
          disabled={Boolean(disabledReason)}
          disabledReason={disabledReason ?? null}
          serverErrors={serverErrors}
          onSubmit={(params) => void handleSubmit(params)}
        />
        {quota && (
          <p className="mt-4 text-xs text-muted-foreground">
            今日额度：已用 {quota.usedCredits} / {quota.limitCredits} 点，
            队列中 {quota.pendingRuns} / {quota.pendingLimit} 个任务。
          </p>
        )}
      </section>

      <section aria-labelledby="result-heading">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="result-heading" className="text-lg font-semibold text-paper">
            本次结果
          </h2>
          <Button asChild variant="ghost" size="sm">
            <Link to="/runs">
              <ListChecks className="mr-1.5 h-4 w-4" aria-hidden="true" />
              全部任务
            </Link>
          </Button>
        </div>
        {run ? (
          <RunCard run={run} onCancel={(id) => void handleCancel(id)} canceling={canceling} />
        ) : (
          <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
            填好左侧参数后提交，结果会出现在这里。
            <br />
            任务在后台排队，离开本页也不会中断，可到「我的任务」查看。
          </div>
        )}
      </section>
    </div>
  )
}

export default function WorkflowDetail() {
  const { slug = '' } = useParams()
  const workflow = workflowBySlug.get(slug)
  const { configured } = useServerAccount()

  useEffect(() => {
    if (!workflow) return
    document.title = `${workflow.name} · AI 工作流 · 横店影视数智服务门户`
    if (configured) trackWorkflow('workflow_view', workflow.slug, '/workflows/detail', workflow.sceneSlug)
  }, [workflow, configured])

  if (!workflow) return <NotFound />

  const scene = sceneOf(workflow)
  const relatedTools = relatedToolsOf(workflow)

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 lg:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2 text-muted-foreground">
            <Link to="/workflows">
              <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
              全部工作流
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-paper sm:text-3xl">{workflow.name}</h1>
            {scene && (
              <Badge variant="secondary" className="font-normal">
                {scene.name}
              </Badge>
            )}
            <Badge variant="outline" className="border-border bg-background font-normal text-muted-foreground">
              出{OUTPUT_KIND_LABELS[workflow.outputKind]}
            </Badge>
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{workflow.description}</p>
        </div>
        <ServerAccountBar />
      </div>

      {relatedTools.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>同类市面工具：</span>
          {relatedTools.map((tool) =>
            tool.url ? (
              <a
                key={tool.id}
                href={tool.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 hover:bg-muted hover:text-foreground"
              >
                {tool.name}
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            ) : (
              <span key={tool.id} className="rounded-full border border-border px-2.5 py-1">
                {tool.name}
              </span>
            ),
          )}
        </div>
      )}

      <div className="mt-8 flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs leading-5 text-muted-foreground">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          参数会提交到第三方算力服务生成结果。请勿填入未公开的剧本、合同、人员信息或其他项目秘密；
          产出的版权与商用条件以对应厂商条款为准。
        </span>
      </div>

      <div className="mt-8">
        <DemoBanner />
        <ServerAccountGate>
          {/* key 让切换工作流时整块重挂载：否则「本次结果」会留着上一条流水线的任务。 */}
          <WorkflowRunner key={workflow.slug} workflow={workflow} />
        </ServerAccountGate>
      </div>
    </div>
  )
}
