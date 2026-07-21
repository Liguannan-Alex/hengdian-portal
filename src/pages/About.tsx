import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BadgeCheck,
  Database,
  ExternalLink,
  HardDrive,
  Layers3,
  Workflow,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { effectiveTools, SCENE_DEFINITIONS } from '@/data/tools'

const PRINCIPLES = [
  {
    icon: Workflow,
    title: '场景优先',
    description: '先按剧本、美术、生成、后期、宣发和综合效率六类任务进入，再用基础分类缩小范围。',
  },
  {
    icon: BadgeCheck,
    title: '编辑核验',
    description: '对本轮核心工具记录核验状态、日期和推荐理由；未进入本轮核验的条目也会清楚标注。',
  },
  {
    icon: ExternalLink,
    title: '只去官网',
    description: '工具卡只提供厂商官网入口，不把第三方聚合详情页包装成工具主页。',
  },
] as const

export default function About() {
  const verifiedCount = effectiveTools.filter((tool) => tool.verificationStatus === 'verified').length

  useEffect(() => {
    document.title = '关于门户 · 横店影视数智服务门户'
  }, [])

  return (
    <div>
      {/* ===== 页头：熄灯影棚 + 聚光灯 ===== */}
      <header className="relative overflow-hidden border-b border-border bg-ink">
        <div className="pointer-events-none absolute inset-0 stage-light" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-0 portal-grid opacity-40" aria-hidden="true" />
        <div className="film-grain pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative mx-auto max-w-5xl px-4 py-14 sm:py-20">
          <p className="font-mono text-sm font-semibold tracking-[0.3em] text-gold">ABOUT THE PORTAL</p>
          <h1 className="mt-4 max-w-3xl text-4xl font-bold leading-tight tracking-tight text-paper sm:text-5xl">
            一个可持续扩展的横店影视数智服务入口
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
            AIGC 工具是门户首个上线模块。当前版本先把分散的工具按剧组工作场景重新组织，并给出可追溯的编辑核验信息；未来其他数智服务可沿用同一导航、档案与收藏体系接入。
          </p>
        </div>
      </header>

      {/* ===== 分区一：收录原则（bg-background） ===== */}
      <section aria-labelledby="principles-heading" className="bg-background">
        <div className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
          <h2 id="principles-heading" className="text-2xl font-bold tracking-tight text-paper">
            三条收录与展示原则
          </h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {PRINCIPLES.map(({ icon: Icon, title, description }, index) => (
              <Card
                key={title}
                className="glass-panel group relative overflow-hidden !border-paper/[0.09] bg-transparent shadow-lg shadow-black/30 transition-all duration-300 hover:-translate-y-1 hover:glow-gold"
              >
                <span
                  className="pointer-events-none absolute -right-2 -top-5 font-mono text-7xl font-bold text-paper/[0.05] transition-colors duration-300 group-hover:text-gold/[0.09]"
                  aria-hidden="true"
                >
                  0{index + 1}
                </span>
                <CardHeader>
                  <span className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-gold/25 bg-gold/10 text-gold-soft shadow-[0_0_14px_-4px_hsl(var(--gold)/0.4)]">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <CardTitle className="relative mt-3 text-lg text-paper">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="relative text-sm leading-6 text-muted-foreground">{description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <div className="h-px hairline-gold" aria-hidden="true" />

      {/* ===== 分区二：数据来源与核验边界（bg-ink-soft/45） ===== */}
      <section className="bg-ink-soft/45" aria-labelledby="data-heading">
        <div className="mx-auto grid max-w-5xl gap-6 px-4 py-12 sm:py-16 lg:grid-cols-[1.35fr_0.65fr]">
          <div className="glass-panel rounded-2xl p-6 shadow-lg shadow-black/30 sm:p-8">
            <div className="flex items-center gap-2 text-gold">
              <Database className="h-5 w-5" aria-hidden="true" />
              <h2 id="data-heading" className="text-xl font-semibold text-paper">数据从哪里来</h2>
            </div>
            <p className="mt-4 leading-7 text-muted-foreground">
              基础工具目录整理自 ai-bot.cn 的公开信息；门户在此基础上维护独立编辑层，用于更正官网入口、补充推荐场景、标记核验状态和控制展示顺序。底表仍只承担来源追溯，不作为站内跳转目标。
            </p>
            <div className="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-paper/10 bg-paper/10">
              {[
                ['当前可浏览', effectiveTools.length],
                ['本轮已核验', verifiedCount],
                ['工作场景', SCENE_DEFINITIONS.length],
              ].map(([label, value]) => (
                <div key={label} className="bg-ink-soft/90 px-3 py-4 text-center">
                  <p className="font-mono text-2xl font-semibold text-gold-soft">{value}</p>
                  <p className="mt-1 text-xs text-paper/45">{label}</p>
                </div>
              ))}
            </div>
          </div>

          <aside className="rounded-2xl border border-gold/20 bg-gold/[0.06] p-6 sm:p-8">
            <BadgeCheck className="h-6 w-6 text-gold" aria-hidden="true" />
            <h2 className="mt-4 text-xl font-semibold text-paper">核验边界</h2>
            <p className="mt-3 text-sm leading-6 text-foreground/75">
              “本轮已核验”表示编辑层已检查当前条目的名称、归类和官网入口，不等同实时可用性、采购背书、信息安全评估或合规审查。
            </p>
            <p className="mt-3 text-sm leading-6 text-foreground/75">
              实际使用前，请以工具官网的最新服务条款、价格、数据政策与授权范围为准。
            </p>
          </aside>
        </div>
      </section>

      <div className="h-px hairline-gold" aria-hidden="true" />

      {/* ===== 分区三：档案与门户壳（bg-background） ===== */}
      <section className="bg-background">
        <div className="mx-auto grid max-w-5xl gap-6 px-4 py-12 sm:grid-cols-2 sm:py-16">
          <div className="glass-panel rounded-2xl p-6 shadow-lg shadow-black/30 transition-all duration-300 hover:-translate-y-1 hover:glow-gold sm:p-8">
            <HardDrive className="h-6 w-6 text-gold" aria-hidden="true" />
            <h2 className="mt-4 text-xl font-semibold text-paper">本机档案，不是云账号</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              昵称与收藏仅保存在当前浏览器，用来区分本机上的工具清单；不会创建网络账号，也不收集个人资料。清除浏览器数据后，档案与收藏可能一并消失。
            </p>
          </div>
          <div className="glass-panel rounded-2xl p-6 shadow-lg shadow-black/30 transition-all duration-300 hover:-translate-y-1 hover:glow-gold sm:p-8">
            <Layers3 className="h-6 w-6 text-gold" aria-hidden="true" />
            <h2 className="mt-4 text-xl font-semibold text-paper">门户壳持续扩展</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              v0.2 先验证场景入口、编辑数据层、URL 筛选与收藏闭环。后续模块是否上线，以真实业务流程和可维护数据为前提逐步推进。
            </p>
          </div>
        </div>
      </section>

      {/* ===== CTA：暗场收尾 ===== */}
      <section className="relative overflow-hidden bg-ink">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px hairline-gold" aria-hidden="true" />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 55% 70% at 50% 115%, hsl(var(--gold) / 0.12), transparent 65%)',
          }}
          aria-hidden="true"
        />
        <div className="film-grain pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-10 sm:py-14">
          <Button asChild size="lg" className="shadow-[0_0_24px_-4px_hsl(var(--gold)/0.5)]">
            <Link to="/tools">
              进入 AI 工具库
              <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="border-paper/20 bg-paper/[0.04] text-paper hover:border-gold/45 hover:bg-gold/10 hover:text-gold-soft"
          >
            <Link to={{ pathname: '/', hash: '#scenes' }}>查看六类场景</Link>
          </Button>
        </div>
      </section>
    </div>
  )
}
