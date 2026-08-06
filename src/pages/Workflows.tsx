/**
 * 工作流总览。
 *
 * 与「AI 工具库」的分工：工具库回答「有哪些工具、去哪用」，一律跳转外站；
 * 工作流回答「在门户里直接跑出结果」。两者共用同一套场景定义，
 * 用户在同一个场景下能看到「可跳转的工具」和「可直接运行的流水线」。
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CircleAlert, ListChecks, Workflow as WorkflowIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { DemoBanner } from '@/components/DemoBanner'
import { ServerAccountBar } from '@/components/ServerAccountGate'
import { useServerAccount } from '@/lib/serverAccount'
import { fetchAvailability, type WorkflowAvailability } from '@/lib/portalApi'
import { OUTPUT_KIND_LABELS, sceneOf, workflows } from '@/data/workflows'
import { SCENE_DEFINITIONS } from '@/data/tools'
import { cn } from '@/lib/utils'

export default function Workflows() {
  const { configured } = useServerAccount()
  const [availability, setAvailability] = useState<Map<string, WorkflowAvailability>>(new Map())
  const [sceneFilter, setSceneFilter] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'AI 工作流 · 横店影视数智服务门户'
  }, [])

  useEffect(() => {
    if (!configured) return
    let alive = true
    fetchAvailability()
      .then((list) => {
        if (alive) setAvailability(new Map(list.map((item) => [item.slug, item])))
      })
      // 拿不到可用性不影响浏览：卡片会退化为「状态未知」，点进详情页再判定。
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [configured])

  const visible = sceneFilter ? workflows.filter((w) => w.sceneSlug === sceneFilter) : workflows
  const scenesInUse = SCENE_DEFINITIONS.filter((scene) =>
    workflows.some((workflow) => workflow.sceneSlug === scene.slug),
  )

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 lg:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2">
            <WorkflowIcon className="h-5 w-5 text-gold" aria-hidden="true" />
            <h1 className="text-2xl font-bold text-paper sm:text-3xl">AI 工作流</h1>
            <Badge variant="outline" className="border-gold/30 bg-gold/10 font-normal text-gold-soft">
              v0.1 编排层
            </Badge>
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            填参数、提交、等结果——不用在几个工具网站之间来回搬运素材。
            每条流水线的产出都留在你自己的任务记录里，方便复盘与汇报。
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <ServerAccountBar />
          <Button asChild variant="outline" size="sm">
            <Link to="/runs">
              <ListChecks className="mr-1.5 h-4 w-4" aria-hidden="true" />
              我的任务
            </Link>
          </Button>
        </div>
      </div>

      <div className="mt-6">
        <DemoBanner />
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="按场景筛选工作流">
        <button
          type="button"
          onClick={() => setSceneFilter(null)}
          className={cn(
            'rounded-full border px-3 py-1.5 text-sm transition-colors',
            sceneFilter === null
              ? 'border-gold/40 bg-gold/10 text-gold-soft'
              : 'border-border text-muted-foreground hover:bg-muted',
          )}
        >
          全部（{workflows.length}）
        </button>
        {scenesInUse.map((scene) => {
          const count = workflows.filter((workflow) => workflow.sceneSlug === scene.slug).length
          return (
            <button
              key={scene.slug}
              type="button"
              onClick={() => setSceneFilter(scene.slug)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm transition-colors',
                sceneFilter === scene.slug
                  ? 'border-gold/40 bg-gold/10 text-gold-soft'
                  : 'border-border text-muted-foreground hover:bg-muted',
              )}
            >
              {scene.name}（{count}）
            </button>
          )
        })}
      </div>

      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((workflow) => {
          const scene = sceneOf(workflow)
          const status = availability.get(workflow.slug)
          const SceneIcon = scene?.icon

          return (
            <Card
              key={workflow.slug}
              className="glass-panel group h-full gap-0 overflow-hidden !border-paper/[0.09] bg-transparent shadow-lg shadow-black/30 transition-all duration-300 hover:-translate-y-1 hover:glow-gold"
            >
              <CardHeader className="gap-3 border-b border-border/75 pb-4">
                <div className="flex flex-wrap items-center gap-2">
                  {scene && (
                    <Badge variant="secondary" className="gap-1 font-normal">
                      {SceneIcon && <SceneIcon className="h-3.5 w-3.5" aria-hidden="true" />}
                      {scene.name}
                    </Badge>
                  )}
                  <Badge variant="outline" className="border-border bg-background font-normal text-muted-foreground">
                    出{OUTPUT_KIND_LABELS[workflow.outputKind]}
                  </Badge>
                  {status?.usingMock && (
                    <Badge variant="outline" className="border-amber-400/25 bg-amber-400/10 font-normal text-amber-300">
                      演示算力
                    </Badge>
                  )}
                </div>
                <CardTitle className="text-lg leading-snug">{workflow.name}</CardTitle>
              </CardHeader>

              <CardContent className="flex flex-1 flex-col pt-4">
                <p className="text-sm leading-6 text-muted-foreground">{workflow.summary}</p>
                <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span>约 {workflow.estimatedSeconds} 秒</span>
                  <span>消耗 {workflow.costCredits} 点额度</span>
                </div>
                {status && !status.runnable && (
                  <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-300">
                    <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {status.unavailableReason}
                  </p>
                )}
              </CardContent>

              <CardFooter className="mt-4 border-t border-paper/[0.07] bg-paper/[0.02] pt-4">
                <Button asChild size="sm" className="w-full">
                  <Link to={`/workflows/${workflow.slug}`}>
                    打开
                    <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </Button>
              </CardFooter>
            </Card>
          )
        })}
      </div>

      <p className="mt-10 max-w-3xl text-xs leading-6 text-muted-foreground">
        产出由第三方模型生成，版权、授权范围与商用条件以对应厂商条款为准；门户不对生成内容做背书。
        请勿在参数中填入未公开的项目内容、合同信息或个人敏感信息。
      </p>
    </div>
  )
}
