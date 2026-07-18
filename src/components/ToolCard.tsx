import {
  BadgeCheck,
  CircleAlert,
  Clock3,
  ExternalLink,
  Lightbulb,
  Star,
} from 'lucide-react'
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
import {
  VERIFICATION_STATUS_LABELS,
  type EffectiveTool,
  type VerificationStatus,
} from '@/data/tools'

const CATEGORY_SHORT: Record<string, string> = {
  视频AI工具: '视频',
  图片AI工具: '图片',
  文字创作AI工具: '文字',
}

const STATUS_STYLES: Record<VerificationStatus, string> = {
  verified: 'border-emerald-700/25 bg-emerald-50 text-emerald-800',
  'needs-review': 'border-amber-700/25 bg-amber-50 text-amber-800',
  unreviewed: 'border-border bg-muted text-muted-foreground',
  excluded: 'border-destructive/25 bg-destructive/5 text-destructive',
}

const STATUS_ICONS = {
  verified: BadgeCheck,
  'needs-review': CircleAlert,
  unreviewed: Clock3,
  excluded: CircleAlert,
} satisfies Record<VerificationStatus, typeof BadgeCheck>

function formatVerifiedDate(value: string | null) {
  if (!value) return null
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (dateOnly) return `${dateOnly[1]}/${dateOnly[2]}/${dateOnly[3]}`
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export interface ToolCardProps {
  tool: EffectiveTool
}

export function ToolCard({ tool }: ToolCardProps) {
  const { isFavorite, toggleFavorite } = useAuth()
  const favorited = isFavorite(tool.id)
  const hasOfficialUrl = tool.url.trim().length > 0
  const StatusIcon = STATUS_ICONS[tool.verificationStatus]
  const verifiedDate = formatVerifiedDate(tool.verifiedAt)

  const handleToggleFavorite = () => {
    if (!toggleFavorite(tool.id)) {
      window.dispatchEvent(new CustomEvent('hd:require-auth'))
    }
  }

  return (
    <Card className="group h-full gap-0 overflow-hidden border-border bg-card shadow-sm transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md">
      <CardHeader className="gap-3 border-b border-border/75 pb-4">
        <div className="flex flex-wrap items-center gap-2 pr-8">
          <Badge
            variant="outline"
            className={cn('gap-1 font-normal', STATUS_STYLES[tool.verificationStatus])}
            title={verifiedDate ? `最近核验：${verifiedDate}` : undefined}
          >
            <StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {VERIFICATION_STATUS_LABELS[tool.verificationStatus]}
          </Badge>
          {tool.featured && (
            <Badge variant="outline" className="border-primary/20 bg-accent font-normal text-accent-foreground">
              编辑精选
            </Badge>
          )}
        </div>
        <CardTitle className="text-lg leading-snug">{tool.name}</CardTitle>
        <CardAction>
          <button
            type="button"
            onClick={handleToggleFavorite}
            aria-label={favorited ? `取消收藏 ${tool.name}` : `收藏 ${tool.name}`}
            aria-pressed={favorited}
            title={favorited ? '取消收藏' : '收藏到本机工具箱'}
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Star className={cn('h-5 w-5', favorited && 'fill-gold text-primary')} aria-hidden="true" />
          </button>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col pt-4">
        <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{tool.desc}</p>

        {tool.recommendationReason && (
          <div className="mt-4 rounded-lg border border-primary/15 bg-accent/55 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-accent-foreground">
              <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
              推荐理由
            </p>
            <p className="mt-1 text-xs leading-5 text-foreground/75">{tool.recommendationReason}</p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="font-normal">
            {CATEGORY_SHORT[tool.category] ?? tool.category}
          </Badge>
          {tool.scenes.map((scene) => (
            <Badge
              key={scene}
              variant="outline"
              className="border-border bg-background font-normal text-muted-foreground"
            >
              {scene}
            </Badge>
          ))}
        </div>
        {verifiedDate && (
          <p className="mt-3 text-[0.68rem] text-muted-foreground">最近核验：{verifiedDate}</p>
        )}
      </CardContent>

      <CardFooter className="mt-4 border-t border-border/75 bg-muted/28 pt-4">
        {hasOfficialUrl ? (
          <Button asChild size="sm" className="w-full">
            <a href={tool.url} target="_blank" rel="noopener noreferrer">
              访问官网（新窗口）
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="w-full" disabled>
            官网入口待核验
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
