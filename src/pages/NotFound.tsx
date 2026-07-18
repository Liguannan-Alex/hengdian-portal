import { useEffect } from 'react'
import { ArrowLeft, Compass } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  useEffect(() => {
    document.title = '页面未找到 · 横店影视数智服务门户'
  }, [])

  return (
    <section className="mx-auto flex min-h-[62vh] max-w-3xl items-center px-4 py-16">
      <div className="w-full rounded-2xl border border-border bg-card px-6 py-14 text-center shadow-sm sm:px-12">
        <p className="font-mono text-sm font-semibold tracking-[0.22em] text-primary">404</p>
        <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">这个页面还没开机</h1>
        <p className="mx-auto mt-4 max-w-lg leading-relaxed text-muted-foreground">
          链接可能已经调整，也可能属于尚未上线的服务模块。你可以返回首页，或继续从 AI
          工具场景中寻找合适的工具。
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button asChild>
            <Link to="/">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              返回首页
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/tools">
              <Compass className="mr-1.5 h-4 w-4" />
              浏览 AI 工具
            </Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
