import { useEffect } from 'react'
import { ArrowLeft, Compass } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  useEffect(() => {
    document.title = '页面未找到 · 横店影视数智服务门户'
  }, [])

  return (
    <section className="relative mx-auto flex min-h-[62vh] max-w-3xl items-center px-4 py-16">
      <div className="glass-panel relative w-full overflow-hidden rounded-2xl px-6 pb-14 pt-16 text-center shadow-2xl shadow-black/50 sm:px-12">
        {/* 场记板斜纹条 */}
        <div
          className="absolute inset-x-0 top-0 h-3.5"
          style={{
            background:
              'repeating-linear-gradient(-45deg, hsl(var(--gold) / 0.5) 0 16px, transparent 16px 32px)',
          }}
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 70% 55% at 50% 0%, hsl(var(--gold) / 0.1), transparent 65%)',
          }}
          aria-hidden="true"
        />
        <div className="film-grain pointer-events-none absolute inset-0" aria-hidden="true" />

        {/* NO SIGNAL 状态条（装饰） */}
        <div
          className="relative inline-flex items-center gap-2.5 rounded-full border border-paper/15 bg-ink-soft/70 px-4 py-1.5 font-mono text-[0.68rem] tracking-[0.3em] text-paper/55"
          aria-hidden="true"
        >
          <span className="h-2 w-2 rounded-full bg-crimson animate-rec-blink" />
          NO&nbsp;SIGNAL
        </div>

        <p className="text-gilded relative mt-6 animate-gilded-shift font-mono text-7xl font-bold tracking-[0.12em] sm:text-8xl">
          404
        </p>
        <h1 className="relative mt-4 text-3xl font-bold tracking-tight text-paper sm:text-4xl">
          这个页面还没开机
        </h1>
        <p className="relative mx-auto mt-4 max-w-lg leading-relaxed text-muted-foreground">
          链接可能已经调整，也可能属于尚未上线的服务模块。你可以返回首页，或继续从 AI
          工具场景中寻找合适的工具。
        </p>
        <div className="relative mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button asChild className="shadow-[0_0_24px_-4px_hsl(var(--gold)/0.5)]">
            <Link to="/">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              返回首页
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            className="border-paper/20 bg-paper/[0.04] text-paper hover:border-gold/45 hover:bg-gold/10 hover:text-gold-soft"
          >
            <Link to="/tools">
              <Compass className="mr-1.5 h-4 w-4" />
              浏览 AI 工具
            </Link>
          </Button>
        </div>

        <div className="relative mx-auto mt-10 h-px w-2/3 hairline-gold" aria-hidden="true" />
        <div className="film-sprockets relative mt-3" aria-hidden="true" />
      </div>
    </section>
  )
}
