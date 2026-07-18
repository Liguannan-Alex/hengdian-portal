import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BadgeCheck,
  Boxes,
  Clapperboard,
  Compass,
  Sparkles,
  UserRound,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ToolCard } from '@/components/ToolCard'
import {
  CATEGORIES,
  effectiveTools,
  FEATURED_TOOL_IDS,
  SCENE_DEFINITIONS,
  toolById,
} from '@/data/tools'
import { useAuth } from '@/lib/auth'

const requireProfile = () => window.dispatchEvent(new CustomEvent('hd:require-auth'))

export default function Home() {
  const { currentUser } = useAuth()

  const stats = useMemo(
    () => ({
      toolCount: effectiveTools.length,
      categoryCount: new Set(effectiveTools.map((tool) => tool.category)).size || CATEGORIES.length,
      sceneCount: SCENE_DEFINITIONS.length,
      verifiedCount: effectiveTools.filter((tool) => tool.verificationStatus === 'verified').length,
    }),
    [],
  )

  const sceneCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const tool of effectiveTools) {
      for (const slug of tool.sceneSlugs) counts.set(slug, (counts.get(slug) ?? 0) + 1)
    }
    return counts
  }, [])

  // 首页精选只认数据层显式白名单，不从排序或场景结果中隐式推导。
  const featuredTools = useMemo(
    () =>
      FEATURED_TOOL_IDS.map((id) => toolById.get(id)).filter(
        (tool): tool is NonNullable<typeof tool> => Boolean(tool),
      ),
    [],
  )

  useEffect(() => {
    document.title = '横店影视数智服务门户 · AI 工具'
  }, [])

  return (
    <div>
      <section className="relative overflow-hidden border-b border-border bg-paper">
        <div className="pointer-events-none absolute inset-0 portal-grid opacity-45" aria-hidden="true" />
        <div
          className="pointer-events-none absolute -right-24 -top-32 h-96 w-96 rounded-full bg-gold/10 blur-3xl"
          aria-hidden="true"
        />
        <div className="relative mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:py-20 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-center lg:px-6 lg:py-24">
          <div>
            <Badge
              variant="outline"
              className="border-primary/25 bg-card/80 px-3 py-1 text-primary shadow-sm"
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              数智服务门户 · 首发 AI 工具模块
            </Badge>
            <h1 className="mt-6 max-w-4xl text-4xl font-bold leading-[1.12] tracking-tight text-ink sm:text-5xl lg:text-6xl">
              从剧组要做的事出发，
              <span className="block text-primary">找到真正能用的 AI 工具</span>
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-muted-foreground sm:text-lg">
              不堆链接，不替工具厂商背书。门户按六类影视工作场景重新组织工具，补充编辑核验状态和推荐理由，帮助剧组更快完成第一轮判断。
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link to="/tools">
                  进入 AI 工具库
                  <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="bg-card/70">
                <Link to={{ pathname: '/', hash: '#scenes' }}>
                  <Compass className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  按场景找工具
                </Link>
              </Button>
            </div>
          </div>

          <aside className="rounded-2xl border border-border bg-ink p-6 text-paper shadow-xl shadow-ink/10 sm:p-7" aria-label="门户数据概览">
            <div className="flex items-center gap-2 text-sm font-medium text-gold-soft">
              <Clapperboard className="h-4 w-4" aria-hidden="true" />
              当前上线模块
            </div>
            <h2 className="mt-3 text-2xl font-semibold">AI 工具服务</h2>
            <p className="mt-2 text-sm leading-6 text-paper/65">
              目录、核验、场景推荐与本机收藏已接入；后续模块沿用同一门户壳扩展。
            </p>
            <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-paper/10 bg-paper/10">
              {[
                ['可浏览工具', stats.toolCount],
                ['本轮已核验', stats.verifiedCount],
                ['工作场景', stats.sceneCount],
                ['基础分类', stats.categoryCount],
              ].map(([label, value]) => (
                <div key={label} className="bg-ink-soft px-4 py-4">
                  <dt className="text-xs text-paper/50">{label}</dt>
                  <dd className="mt-1 text-2xl font-semibold text-gold-soft">{value}</dd>
                </div>
              ))}
            </dl>
          </aside>
        </div>
      </section>

      <section id="scenes" className="scroll-mt-24 bg-background">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:py-20 lg:px-6">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold tracking-[0.14em] text-primary">SCENE FIRST</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">按六类工作场景进入</h2>
              <p className="mt-4 leading-7 text-muted-foreground">
                先选择正在推进的任务，再用分类、核验状态和关键词缩小范围。每个入口都可以复制链接，稍后继续。
              </p>
            </div>
            <Button asChild variant="outline">
              <Link to="/tools">
                查看全部 {stats.toolCount} 个工具
                <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SCENE_DEFINITIONS.map(({ slug, name, icon: Icon, tagline }, index) => (
              <Link
                key={slug}
                to={`/tools?scene=${slug}`}
                className="group relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-6"
              >
                <span className="absolute right-5 top-4 font-mono text-xs text-muted-foreground/45" aria-hidden="true">
                  0{index + 1}
                </span>
                <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-5 text-xl font-semibold">{name}</h3>
                <p className="mt-2 min-h-12 text-sm leading-6 text-muted-foreground">{tagline}</p>
                <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-sm">
                  <span className="text-muted-foreground">{sceneCounts.get(slug) ?? 0} 个工具</span>
                  <span className="inline-flex items-center font-medium text-primary">
                    查看工具
                    <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-secondary/55">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:py-20 lg:px-6">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                编辑精选 · 显式白名单
              </div>
              <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">先从这组工具开始</h2>
              <p className="mt-4 leading-7 text-muted-foreground">
                精选结果来自只读数据层维护的固定名单，不按热度自动上榜。卡片会说明核验状态与被推荐的原因。
              </p>
            </div>
            <Button asChild variant="outline" className="bg-card">
              <Link to="/tools?status=verified&sort=recommended">浏览已核验工具</Link>
            </Button>
          </div>

          {featuredTools.length > 0 ? (
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {featuredTools.map((tool) => (
                <ToolCard key={tool.id} tool={tool} />
              ))}
            </div>
          ) : (
            <div className="mt-10 rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
              精选名单正在由编辑核验，全部工具仍可在工具库浏览。
            </div>
          )}
        </div>
      </section>

      <section className="bg-paper">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-14 sm:py-16 lg:grid-cols-[1fr_auto] lg:items-center lg:px-6">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-primary">
              {currentUser ? <Boxes className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
              本机档案与收藏
            </div>
            <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
              {currentUser ? `${currentUser.username}，继续整理你的剧组工具箱` : '建立本机档案，保留自己的工具清单'}
            </h2>
            <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
              收藏只保存在当前浏览器，不需要网络账号。你可以先浏览工具，需要收藏时再建立档案。
            </p>
          </div>
          <div className="flex flex-wrap gap-3 lg:justify-end">
            {currentUser ? (
              <Button asChild size="lg">
                <Link to="/favorites">查看我的收藏</Link>
              </Button>
            ) : (
              <Button size="lg" onClick={requireProfile}>建立本机档案</Button>
            )}
            <Button asChild size="lg" variant="outline">
              <Link to="/about">了解门户原则</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
