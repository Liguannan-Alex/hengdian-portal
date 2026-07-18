import { ExternalLink, Star } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import type { Tool } from '@/data/tools'

/** 一级分类徽标用短文案（数据层全称为「视频AI工具」等，卡片上从简） */
const CATEGORY_SHORT: Record<string, string> = {
  视频AI工具: '视频',
  图片AI工具: '图片',
  文字创作AI工具: '文字',
}

export interface ToolCardProps {
  tool: Tool
}

/**
 * 共享工具卡片（HOME / TOOLS / AUTH 三端共用，请勿各自重复实现）
 * - 白卡：名称 + 两行截断简介 + 分类/场景徽标 + 收藏星标 + 官网直达
 * - 收藏星标：未登录时 toggleFavorite 返回 false，派发 'hd:require-auth' 事件由 Layout 打开登录弹窗
 * - 官网直达：新窗口打开；url 为空时禁用并显示「官网暂缺」
 */
export function ToolCard({ tool }: ToolCardProps) {
  const { isFavorite, toggleFavorite } = useAuth()
  const favorited = isFavorite(tool.id)
  const hasUrl = tool.url.trim().length > 0

  const handleToggleFavorite = () => {
    const ok = toggleFavorite(tool.id)
    if (!ok) {
      // 未登录：通知 Layout 打开登录 Dialog
      window.dispatchEvent(new CustomEvent('hd:require-auth'))
    }
  }

  return (
    <Card className="h-full gap-4 transition-shadow duration-200 hover:shadow-md">
      <CardHeader>
        <CardTitle className="text-base leading-snug">{tool.name}</CardTitle>
        <CardAction>
          <button
            type="button"
            onClick={handleToggleFavorite}
            aria-label={favorited ? '取消收藏' : '收藏'}
            aria-pressed={favorited}
            title={favorited ? '取消收藏' : '收藏'}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-gold"
          >
            <Star className={cn('h-5 w-5', favorited && 'fill-gold text-gold')} />
          </button>
        </CardAction>
      </CardHeader>

      <CardContent className="flex-1">
        <p className="line-clamp-2 min-h-10 text-sm leading-relaxed text-muted-foreground">
          {tool.desc}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {/* 分类徽标：低饱和鎏金 */}
          <Badge
            variant="outline"
            className="border-transparent bg-accent font-normal text-accent-foreground"
          >
            {CATEGORY_SHORT[tool.category] ?? tool.category}
          </Badge>
          {/* 场景徽标：低饱和宫墙红描边 */}
          {tool.scenes.map((scene) => (
            <Badge
              key={scene}
              variant="outline"
              className="border-destructive/30 bg-destructive/5 font-normal text-crimson"
            >
              {scene}
            </Badge>
          ))}
        </div>
      </CardContent>

      <CardFooter>
        {hasUrl ? (
          <Button asChild variant="outline" size="sm" className="w-full">
            <a href={tool.url} target="_blank" rel="noopener noreferrer">
              官网直达
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </a>
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="w-full" disabled>
            官网暂缺
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
