import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Compass, LogIn, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToolCard } from '@/components/ToolCard'
import { toolById } from '@/data/tools'
import type { Tool } from '@/data/tools'
import { useAuth } from '@/lib/auth'

/** 触发全局登录弹窗（Layout 监听该事件） */
const requireAuth = () => window.dispatchEvent(new CustomEvent('hd:require-auth'))

/**
 * 我的收藏 —— 登录用户的「剧组工具箱」
 * - 未登录：友好空态，引导登录
 * - 已登录：按收藏 id 映射工具，用 ToolCard 网格展示；空收藏引导去工具库
 */
export default function Favorites() {
  const { currentUser, favorites } = useAuth()

  useEffect(() => {
    document.title = '我的收藏 · 横店影视 AIGC 门户'
  }, [])

  // ---------- 未登录空态 ----------
  if (!currentUser) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16">
        <div className="mx-auto flex max-w-md flex-col items-center rounded-xl border border-border bg-card px-6 py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent">
            <Star className="h-7 w-7 text-gold" />
          </div>
          <h1 className="mt-5 text-2xl font-bold">登录后，组建你的剧组工具箱</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            收藏好用的 AI 工具，按剧组工作流随时取用。
            <br />
            登录或注册一个本地演示账号即可开始。
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button onClick={requireAuth}>
              <LogIn className="mr-1.5 h-4 w-4" />
              登录 / 注册
            </Button>
            <Button variant="outline" asChild>
              <Link to="/tools">
                <Compass className="mr-1.5 h-4 w-4" />
                先逛逛工具库
              </Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // ---------- 已登录 ----------
  // 按收藏 id 取工具详情（最新收藏的排在前面），过滤掉数据里已不存在的 id
  const favoriteTools = [...favorites]
    .reverse()
    .map((id) => toolById.get(id))
    .filter((tool): tool is Tool => Boolean(tool))

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Star className="h-7 w-7 fill-gold text-gold" />
            我的剧组工具箱
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {currentUser.username}，你已收藏{' '}
            <span className="font-semibold text-foreground">{favoriteTools.length}</span> 个工具
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/tools">
            <Compass className="mr-1.5 h-4 w-4" />
            继续逛工具库
          </Link>
        </Button>
      </header>

      {favoriteTools.length === 0 ? (
        // 空收藏：引导去工具库
        <div className="mt-10 flex flex-col items-center rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent">
            <Star className="h-7 w-7 text-gold" />
          </div>
          <h2 className="mt-5 text-xl font-semibold">工具箱还是空的</h2>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
            去工具库看看，点击卡片上的星标，把适合本剧组的工具收进来。
          </p>
          <Button className="mt-6" asChild>
            <Link to="/tools">去工具库收藏工具</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {favoriteTools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  )
}
