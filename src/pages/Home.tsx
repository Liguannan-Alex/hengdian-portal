import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Clapperboard, Sparkles, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ToolCard } from '@/components/ToolCard'
import { tools, CATEGORIES, SCENE_INFO } from '@/data/tools'
import type { SceneName, Tool } from '@/data/tools'
import { useAuth } from '@/lib/auth'

/** 实时统计：工具总数 / 一级分类数 / 场景数（均来自数据层，不写死） */
function useStats() {
  return useMemo(
    () => ({
      toolCount: tools.length,
      categoryCount: new Set(tools.map((t) => t.category)).size || CATEGORIES.length,
      sceneCount: SCENE_INFO.length,
    }),
    [],
  )
}

/** 每个场景的工具数 */
const sceneCountMap: ReadonlyMap<string, number> = (() => {
  const map = new Map<string, number>()
  for (const t of tools) {
    for (const s of t.scenes) map.set(s, (map.get(s) ?? 0) + 1)
  }
  return map
})()

/** 精选工具：每个场景取前 3 个有官网链接的工具 */
const featuredByScene: ReadonlyArray<{ scene: SceneName; items: Tool[] }> = SCENE_INFO.map(
  ({ name }) => ({
    scene: name,
    items: tools.filter((t) => t.scenes.includes(name) && t.url.trim() !== '').slice(0, 3),
  }),
)

export default function Home() {
  const { currentUser } = useAuth()
  const stats = useStats()

  useEffect(() => {
    document.title = '横店影视 AIGC 门户'
  }, [])

  return (
    <div className="bg-paper">
      {/* ========== 1. Hero 区 ========== */}
      <section className="relative overflow-hidden bg-ink text-paper">
        {/* 克制的装饰：细金线分隔带，营造片场/牌匾质感 */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gold/40"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full border border-gold/15"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full border border-gold/10"
          aria-hidden
        />

        <div className="relative mx-auto max-w-6xl px-4 py-20 sm:py-28">
          <Badge
            variant="outline"
            className="border-gold/40 bg-transparent text-gold-soft hover:bg-transparent"
          >
            <Clapperboard className="mr-1.5 h-3.5 w-3.5" />
            东方好莱坞 · 剧组 AI 工具箱
          </Badge>

          <h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            横店影视 <span className="text-gold">AIGC</span> 门户
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-paper/70 sm:text-lg">
            面向中小剧组的一站式 AI 工具门户——把散落的 AI 工具按影视生产流程重新组织，
            从剧本到宣发，让剧组人员找得到、看得懂、用得上。
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg" className="bg-gold text-ink hover:bg-gold-soft">
              <Link to="/tools">
                进入工具库
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-paper/30 bg-transparent text-paper hover:bg-paper/10 hover:text-paper"
            >
              <Link to="/#scenes">浏览场景</Link>
            </Button>
          </div>

          {/* 数据条：实时统计 */}
          <dl className="mt-14 grid max-w-xl grid-cols-3 gap-6 border-t border-paper/15 pt-8">
            <div>
              <dt className="text-sm text-paper/50">收录工具</dt>
              <dd className="mt-1 text-3xl font-bold text-gold-soft">{stats.toolCount}</dd>
            </div>
            <div>
              <dt className="text-sm text-paper/50">一级分类</dt>
              <dd className="mt-1 text-3xl font-bold text-gold-soft">{stats.categoryCount}</dd>
            </div>
            <div>
              <dt className="text-sm text-paper/50">影视场景</dt>
              <dd className="mt-1 text-3xl font-bold text-gold-soft">{stats.sceneCount}</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* ========== 2. 场景入口区（导航锚点） ========== */}
      <section id="scenes" className="scroll-mt-20">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              按剧组工作流找工具
            </h2>
            <p className="mt-3 leading-relaxed text-muted-foreground">
              不再按技术分类碰运气——从剧本创作到宣发物料，五大场景覆盖影视生产全流程，
              点进你的环节，直接看能用的工具。
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SCENE_INFO.map(({ name, icon: Icon, tagline }) => {
              const count = sceneCountMap.get(name) ?? 0
              return (
                <Link
                  key={name}
                  to={`/tools?scene=${encodeURIComponent(name)}`}
                  className="group rounded-lg border border-border bg-card p-5 shadow-xs transition-colors hover:border-gold/60 hover:bg-accent/50"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex h-10 w-10 items-center justify-center rounded-md bg-accent text-accent-foreground">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="text-xs text-muted-foreground">{count} 个工具</span>
                  </div>
                  <h3 className="mt-4 text-lg font-semibold">{name}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{tagline}</p>
                  <span className="mt-4 inline-flex items-center text-sm font-medium text-primary">
                    进入场景
                    <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              )
            })}

            {/* 第六格：直达全量工具库 */}
            <Link
              to="/tools"
              className="group flex flex-col justify-between rounded-lg border border-dashed border-border bg-transparent p-5 transition-colors hover:border-gold/60 hover:bg-accent/50"
            >
              <div>
                <h3 className="text-lg font-semibold">浏览全部工具</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  想自己逛逛？{stats.toolCount} 个工具全量列表，支持搜索与筛选。
                </p>
              </div>
              <span className="mt-4 inline-flex items-center text-sm font-medium text-primary">
                打开工具库
                <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* ========== 3. 精选工具区 ========== */}
      <section className="border-y border-border bg-secondary/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
                <Sparkles className="h-6 w-6 text-primary" />
                精选工具
              </h2>
              <p className="mt-3 leading-relaxed text-muted-foreground">
                每个场景先挑三件顺手的：都有官网可直达，点开就能试。
              </p>
            </div>
            <Button asChild variant="outline">
              <Link to="/tools">
                查看全部 {stats.toolCount} 个工具
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
          </div>

          <div className="mt-10 space-y-12">
            {featuredByScene.map(({ scene, items }) => {
              const info = SCENE_INFO.find((s) => s.name === scene)
              if (!info || items.length === 0) return null
              const Icon = info.icon
              return (
                <div key={scene}>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-2 text-lg font-semibold">
                      <Icon className="h-5 w-5 text-primary" />
                      {scene}
                    </h3>
                    <Link
                      to={`/tools?scene=${encodeURIComponent(scene)}`}
                      className="text-sm text-muted-foreground transition-colors hover:text-primary"
                    >
                      该场景全部 {sceneCountMap.get(scene) ?? 0} 个 →
                    </Link>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((tool) => (
                      <ToolCard key={tool.id} tool={tool} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ========== 4. 底部 CTA 区 ========== */}
      <section className="bg-ink text-paper">
        <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:py-20">
          {currentUser ? (
            <>
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                {currentUser.username}，继续搭建你的剧组工具箱
              </h2>
              <p className="mx-auto mt-4 max-w-xl leading-relaxed text-paper/70">
                在工具库点亮星标收藏常用工具，下次开工直接进「我的收藏」。
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Button asChild size="lg" className="bg-gold text-ink hover:bg-gold-soft">
                  <Link to="/tools">
                    直达工具库
                    <ArrowRight className="ml-1.5 h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="border-paper/30 bg-transparent text-paper hover:bg-paper/10 hover:text-paper"
                >
                  <Link to="/favorites">我的收藏</Link>
                </Button>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                注册账号，把顺手的工具收进剧组工具箱
              </h2>
              <p className="mx-auto mt-4 max-w-xl leading-relaxed text-paper/70">
                免费注册后即可收藏工具，为本剧组沉淀一份随取随用的 AI 工具清单。
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Button
                  size="lg"
                  className="bg-gold text-ink hover:bg-gold-soft"
                  onClick={() => window.dispatchEvent(new CustomEvent('hd:require-auth'))}
                >
                  <UserPlus className="mr-1.5 h-4 w-4" />
                  登录 / 注册
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="border-paper/30 bg-transparent text-paper hover:bg-paper/10 hover:text-paper"
                >
                  <Link to="/tools">先逛逛工具库</Link>
                </Button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
