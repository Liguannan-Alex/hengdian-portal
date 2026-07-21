import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BadgeCheck,
  Boxes,
  Compass,
  Sparkles,
  UserRound,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
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

  // 胶片跑马灯素材：取权重靠前的工具名，复制一份实现无缝循环。
  const marqueeNames = useMemo(() => effectiveTools.slice(0, 24).map((tool) => tool.name), [])

  useEffect(() => {
    document.title = '横店影视数智服务门户 · AI 工具'
  }, [])

  return (
    <div>
      {/* ===== Hero：熄灯影棚，聚光灯亮起 ===== */}
      <section className="relative overflow-hidden border-b border-border bg-ink">
        <div className="pointer-events-none absolute inset-0 stage-light" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-0 portal-grid opacity-60" aria-hidden="true" />
        <div
          className="light-beam pointer-events-none absolute -top-24 left-[8%] h-[36rem] w-40 rotate-[18deg] blur-2xl animate-beam-sway"
          aria-hidden="true"
        />
        <div
          className="light-beam pointer-events-none absolute -top-32 right-[14%] h-[30rem] w-24 -rotate-[14deg] blur-2xl opacity-70 animate-glow-pulse"
          aria-hidden="true"
        />
        <div className="film-grain pointer-events-none absolute inset-0" aria-hidden="true" />

        <div className="relative mx-auto grid max-w-7xl gap-14 px-4 py-20 sm:py-24 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-center lg:px-6 lg:py-32">
          <div className="animate-fade-up">
            <p className="inline-flex items-center gap-2.5 rounded-full border border-gold/25 bg-gold/[0.07] px-4 py-1.5 font-mono text-xs tracking-[0.32em] text-gold-soft">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              HENGDIAN&nbsp;·&nbsp;数智影视门户
            </p>
            <h1 className="mt-8 max-w-4xl text-4xl font-bold leading-[1.14] tracking-tight text-paper sm:text-5xl lg:text-[4.2rem]">
              从剧组要做的事出发，
              <span className="text-gilded mt-2 block animate-gilded-shift pb-1">
                找到真正能用的 AI
              </span>
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-8 text-muted-foreground sm:text-lg">
              不堆链接，不替工具厂商背书。门户按六类影视工作场景重新组织工具，
              补充编辑核验状态和推荐理由，帮助剧组更快完成第一轮判断。
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Button
                asChild
                size="lg"
                className="h-12 px-7 text-base font-semibold shadow-[0_0_28px_-4px_hsl(var(--gold)/0.55)] transition-shadow hover:shadow-[0_0_44px_-4px_hsl(var(--gold)/0.75)]"
              >
                <Link to="/tools">
                  进入 AI 工具库
                  <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-12 border-paper/20 bg-paper/[0.04] px-7 text-base text-paper backdrop-blur hover:border-gold/45 hover:bg-gold/10 hover:text-gold-soft"
              >
                <Link to={{ pathname: '/', hash: '#scenes' }}>
                  <Compass className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  按场景找工具
                </Link>
              </Button>
            </div>
          </div>

          {/* 导演监视器：门户数据概览 */}
          <aside
            className="glass-panel animate-fade-up rounded-2xl p-1.5 shadow-2xl shadow-black/60 [animation-delay:150ms]"
            aria-label="门户数据概览"
          >
            <div className="flex items-center justify-between rounded-t-[0.85rem] border-b border-paper/10 bg-ink-soft/80 px-4 py-2.5 font-mono text-[0.68rem] tracking-[0.18em] text-paper/55">
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-crimson animate-rec-blink" aria-hidden="true" />
                REC&nbsp;·&nbsp;PORTAL&nbsp;MONITOR
              </span>
              <span>A-CAM&nbsp;01</span>
            </div>
            <div className="px-5 py-5 sm:px-6">
              <h2 className="text-xl font-semibold text-paper">AI 工具服务 · 当前上线</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                目录、核验、场景推荐与本机收藏已接入；后续模块沿用同一门户壳扩展。
              </p>
              <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-paper/10 bg-paper/10">
                {[
                  ['可浏览工具', stats.toolCount],
                  ['本轮已核验', stats.verifiedCount],
                  ['工作场景', stats.sceneCount],
                  ['基础分类', stats.categoryCount],
                ].map(([label, value]) => (
                  <div key={label} className="bg-ink-soft/90 px-4 py-4">
                    <dt className="text-xs text-paper/45">{label}</dt>
                    <dd className="mt-1.5 font-mono text-3xl font-semibold text-gold-soft">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 font-mono text-[0.65rem] tracking-[0.14em] text-paper/35">
                DATA&nbsp;VERIFIED&nbsp;BY&nbsp;EDITORIAL&nbsp;LAYER
              </p>
            </div>
          </aside>
        </div>

        {/* 胶片跑马灯：收录工具名滚动 */}
        <div className="relative border-t border-paper/10 bg-ink-soft/60" aria-hidden="true">
          <div className="film-sprockets" />
          <div className="marquee-mask overflow-hidden py-3">
            <div className="flex w-max animate-marquee gap-10 whitespace-nowrap">
              {[...marqueeNames, ...marqueeNames].map((name, index) => (
                <span
                  key={`${name}-${index}`}
                  className="inline-flex items-center gap-10 font-mono text-sm tracking-[0.08em] text-paper/40"
                >
                  {name}
                  <span className="h-1 w-1 rounded-full bg-gold/50" />
                </span>
              ))}
            </div>
          </div>
          <div className="film-sprockets" />
        </div>
      </section>

      {/* ===== 场景入口 ===== */}
      <section id="scenes" className="relative scroll-mt-24 bg-background">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:py-24 lg:px-6">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div className="max-w-2xl">
              <p className="font-mono text-sm font-semibold tracking-[0.3em] text-gold">
                SCENE&nbsp;FIRST
              </p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-paper sm:text-4xl">
                按六类工作场景进入
              </h2>
              <p className="mt-4 leading-7 text-muted-foreground">
                先选择正在推进的任务，再用分类、核验状态和关键词缩小范围。每个入口都可以复制链接，稍后继续。
              </p>
            </div>
            <Button
              asChild
              variant="outline"
              className="border-paper/20 bg-paper/[0.03] text-paper hover:border-gold/45 hover:bg-gold/10 hover:text-gold-soft"
            >
              <Link to="/tools">
                查看全部 {stats.toolCount} 个工具
                <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>

          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {SCENE_DEFINITIONS.map(({ slug, name, icon: Icon, tagline }, index) => (
              <Link
                key={slug}
                to={`/tools?scene=${slug}`}
                className="glass-panel group relative overflow-hidden rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1 hover:glow-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-7"
              >
                <span
                  className="pointer-events-none absolute -right-3 -top-6 font-mono text-8xl font-bold text-paper/[0.05] transition-colors duration-300 group-hover:text-gold/[0.09]"
                  aria-hidden="true"
                >
                  0{index + 1}
                </span>
                <span className="relative flex h-12 w-12 items-center justify-center rounded-xl border border-gold/25 bg-gold/10 text-gold-soft shadow-[0_0_18px_-4px_hsl(var(--gold)/0.4)]">
                  <Icon className="h-6 w-6" aria-hidden="true" />
                </span>
                <h3 className="relative mt-6 text-xl font-semibold text-paper">{name}</h3>
                <p className="relative mt-2.5 min-h-12 text-sm leading-6 text-muted-foreground">
                  {tagline}
                </p>
                <div className="relative mt-6 flex items-center justify-between border-t border-paper/10 pt-4 text-sm">
                  <span className="font-mono text-muted-foreground">
                    {sceneCounts.get(slug) ?? 0} 个工具
                  </span>
                  <span className="inline-flex items-center font-medium text-gold-soft">
                    查看工具
                    <ArrowRight
                      className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1"
                      aria-hidden="true"
                    />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ===== 编辑精选 ===== */}
      <section className="relative border-y border-border bg-ink-soft/45">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px hairline-gold" aria-hidden="true" />
        <div className="mx-auto max-w-7xl px-4 py-16 sm:py-24 lg:px-6">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 font-mono text-sm font-semibold tracking-[0.2em] text-gold">
                <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                编辑精选&nbsp;·&nbsp;显式白名单
              </div>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-paper sm:text-4xl">
                先从这组工具开始
              </h2>
              <p className="mt-4 leading-7 text-muted-foreground">
                精选结果来自只读数据层维护的固定名单，不按热度自动上榜。卡片会说明核验状态与被推荐的原因。
              </p>
            </div>
            <Button
              asChild
              variant="outline"
              className="border-paper/20 bg-paper/[0.03] text-paper hover:border-gold/45 hover:bg-gold/10 hover:text-gold-soft"
            >
              <Link to="/tools?status=verified&sort=recommended">浏览已核验工具</Link>
            </Button>
          </div>

          {featuredTools.length > 0 ? (
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {featuredTools.map((tool) => (
                <ToolCard key={tool.id} tool={tool} />
              ))}
            </div>
          ) : (
            <div className="glass-panel mt-12 rounded-2xl border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
              精选名单正在由编辑核验，全部工具仍可在工具库浏览。
            </div>
          )}
        </div>
      </section>

      {/* ===== 本机档案 CTA ===== */}
      <section className="relative overflow-hidden bg-ink">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 55% 70% at 50% 115%, hsl(var(--gold) / 0.13), transparent 65%)',
          }}
          aria-hidden="true"
        />
        <div className="film-grain pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:py-20 lg:grid-cols-[1fr_auto] lg:items-center lg:px-6">
          <div>
            <div className="flex items-center gap-2 font-mono text-sm font-semibold tracking-[0.2em] text-gold">
              {currentUser ? <Boxes className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
              本机档案与收藏
            </div>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-paper sm:text-3xl">
              {currentUser
                ? `${currentUser.username}，继续整理你的剧组工具箱`
                : '建立本机档案，保留自己的工具清单'}
            </h2>
            <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
              收藏只保存在当前浏览器，不需要网络账号。你可以先浏览工具，需要收藏时再建立档案。
            </p>
          </div>
          <div className="flex flex-wrap gap-3 lg:justify-end">
            {currentUser ? (
              <Button
                asChild
                size="lg"
                className="shadow-[0_0_24px_-4px_hsl(var(--gold)/0.5)]"
              >
                <Link to="/favorites">查看我的收藏</Link>
              </Button>
            ) : (
              <Button
                size="lg"
                onClick={requireProfile}
                className="shadow-[0_0_24px_-4px_hsl(var(--gold)/0.5)]"
              >
                建立本机档案
              </Button>
            )}
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-paper/20 bg-paper/[0.04] text-paper hover:border-gold/45 hover:bg-gold/10 hover:text-gold-soft"
            >
              <Link to="/about">了解门户原则</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
