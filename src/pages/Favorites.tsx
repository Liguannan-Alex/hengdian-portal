import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { CircleAlert, Compass, HardDrive, Star, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToolCard } from '@/components/ToolCard'
import { toolById } from '@/data/tools'
import type { EffectiveTool } from '@/data/tools'
import { useAuth } from '@/lib/auth'

/** 触发全局本机档案弹窗（Layout 监听该事件）。 */
const requireProfile = () => window.dispatchEvent(new CustomEvent('hd:require-auth'))

interface StorageNoticeProps {
  available: boolean
  notice: string | null
}

function StorageNotice({ available, notice }: StorageNoticeProps) {
  if (!notice) return null
  const Icon = available ? HardDrive : CircleAlert

  return (
    <div
      className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground"
      role={available ? 'status' : 'alert'}
      aria-live="polite"
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{notice}</span>
    </div>
  )
}

/** 本机工具箱：单机档案的收藏集合，不涉及登录、注册或云同步。 */
export default function Favorites() {
  const {
    currentUser,
    favorites,
    storageAvailable,
    storageNotice,
    actionNotice,
    clearActionNotice,
  } = useAuth()

  useEffect(() => {
    document.title = '本机工具箱 · 横店影视数智服务门户'
  }, [])

  if (!currentUser) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16">
        <div className="mx-auto max-w-md space-y-4">
          <StorageNotice available={storageAvailable} notice={storageNotice} />
          <div className="glass-panel relative flex flex-col items-center overflow-hidden rounded-2xl px-6 py-14 text-center shadow-xl shadow-black/40">
            <div className="film-grain pointer-events-none absolute inset-0" aria-hidden="true" />
            <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-gold/25 bg-gold/10 shadow-[0_0_18px_-4px_hsl(var(--gold)/0.4)]">
              <Star className="h-7 w-7 text-gold" />
            </div>
            <h1 className="relative mt-5 text-2xl font-bold text-paper">建立本机档案，开始收藏工具</h1>
            <p className="relative mt-3 text-sm leading-relaxed text-muted-foreground">
              只需填写一个显示名称，无需密码或网络账号。
              <br />
              收藏默认保存在当前浏览器的本机工具箱中。
            </p>
            <div className="relative mt-6 flex flex-wrap items-center justify-center gap-3">
              <Button onClick={requireProfile}>
                <UserRound className="mr-1.5 h-4 w-4" />
                建立本机档案
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
      </div>
    )
  }

  // 按收藏 id 取工具详情（最新收藏的排在前面），过滤数据中已不存在的 id。
  const favoriteTools = [...favorites]
    .reverse()
    .map((id) => toolById.get(id))
    .filter((tool): tool is EffectiveTool => Boolean(tool))

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="space-y-3">
        <StorageNotice available={storageAvailable} notice={storageNotice} />
        {actionNotice && (
          <div
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gold/25 bg-gold/10 px-4 py-3 text-sm text-gold-soft"
            role="status"
            aria-live="polite"
          >
            <span>{actionNotice}</span>
            <Button type="button" variant="ghost" size="sm" onClick={clearActionNotice}>
              知道了
            </Button>
          </div>
        )}
      </div>

      <header className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p
            className="flex items-center gap-3 font-mono text-xs font-semibold tracking-[0.3em] text-gold"
            aria-hidden="true"
          >
            MY&nbsp;TOOLKIT
            <span className="hairline-gold h-px w-12" />
          </p>
          <h1 className="mt-2 flex items-center gap-2 text-3xl font-bold text-paper">
            <Star className="h-7 w-7 fill-gold text-gold" />
            本机工具箱
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {currentUser.username}，本机已收藏{' '}
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
        <div className="glass-panel mt-10 flex flex-col items-center rounded-2xl border-dashed px-6 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-gold/25 bg-gold/10 shadow-[0_0_18px_-4px_hsl(var(--gold)/0.4)]">
            <Star className="h-7 w-7 text-gold" />
          </div>
          <h2 className="mt-5 text-xl font-semibold text-paper">本机工具箱还是空的</h2>
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
