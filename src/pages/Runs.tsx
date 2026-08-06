/**
 * 我的任务：所有提交过的工作流任务与产出。
 *
 * 只要还有任务未进入终态就持续轮询，全部结束后停表——用户关掉页面任务
 * 照跑，回到这里能看到结果，这是「任务在后台」的直觉所要求的。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, RefreshCw, Workflow as WorkflowIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DemoBanner } from '@/components/DemoBanner'
import { RunCard } from '@/components/RunCard'
import { ServerAccountBar, ServerAccountGate } from '@/components/ServerAccountGate'
import {
  ApiError,
  cancelRun,
  fetchQuota,
  fetchRuns,
  isTerminal,
  type Quota,
  type WorkflowRun,
} from '@/lib/portalApi'

const POLL_MS = 3000

function RunList() {
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [quota, setQuota] = useState<Quota | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cancelingId, setCancelingId] = useState<number | null>(null)
  const timer = useRef<number | null>(null)

  const load = useCallback(async () => {
    try {
      const [list, currentQuota] = await Promise.all([fetchRuns(50), fetchQuota()])
      setRuns(list)
      setQuota(currentQuota)
      setError(null)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '加载任务失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const hasActive = runs.some((run) => !isTerminal(run.status))

  useEffect(() => {
    if (!hasActive) {
      if (timer.current) window.clearInterval(timer.current)
      timer.current = null
      return
    }
    timer.current = window.setInterval(() => void load(), POLL_MS)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
      timer.current = null
    }
  }, [hasActive, load])

  const handleCancel = async (id: number) => {
    setCancelingId(id)
    try {
      await cancelRun(id)
      await load()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '取消失败')
    } finally {
      setCancelingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        正在加载任务…
      </div>
    )
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          共 {runs.length} 个任务
          {quota && ` · 今日额度已用 ${quota.usedCredits} / ${quota.limitCredits} 点`}
          {hasActive && ' · 有任务进行中，本页自动刷新'}
        </p>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
          刷新
        </Button>
      </div>

      {error && (
        <p className="mb-6 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}

      {runs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-6 py-16 text-center">
          <p className="text-sm text-muted-foreground">还没有任务。</p>
          <Button asChild className="mt-4">
            <Link to="/workflows">
              <WorkflowIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
              去看看工作流
            </Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {runs.map((run) => (
            <RunCard
              key={run.id}
              run={run}
              onCancel={(id) => void handleCancel(id)}
              canceling={cancelingId === run.id}
            />
          ))}
        </div>
      )}
    </>
  )
}

export default function Runs() {
  useEffect(() => {
    document.title = '我的任务 · 横店影视数智服务门户'
  }, [])

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 lg:px-6">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-paper sm:text-3xl">我的任务</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            工作流任务与产出只对你自己可见。产出链接由算力方托管，可能有有效期，需要长期保存请及时下载。
          </p>
        </div>
        <ServerAccountBar />
      </div>

      <DemoBanner />

      <ServerAccountGate>
        <RunList />
      </ServerAccountGate>
    </div>
  )
}
