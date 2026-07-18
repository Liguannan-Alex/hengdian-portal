import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, SearchX, ChevronLeft, ChevronRight } from 'lucide-react'
import { tools, CATEGORIES, SCENES } from '@/data/tools'
import { ToolCard } from '@/components/ToolCard'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from '@/components/ui/pagination'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 24
const ALL = '全部'

/** 一级分类筛选 chips：值为数据层全称，文案从简 */
const CATEGORY_FILTERS = [
  { value: ALL, label: '全部' },
  { value: '视频AI工具', label: '视频' },
  { value: '图片AI工具', label: '图片' },
  { value: '文字创作AI工具', label: '文字' },
] as const

const SCENE_FILTERS = [ALL, ...SCENES] as const

/** 生成带省略号的页码序列（总页数 ≤7 时全展示） */
function buildPageList(current: number, total: number): Array<number | 'ellipsis'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const windowPages = [current - 1, current, current + 1].filter((p) => p > 1 && p < total)
  const items: Array<number | 'ellipsis'> = [1]
  if (windowPages[0] > 2) items.push('ellipsis')
  items.push(...windowPages)
  if (windowPages[windowPages.length - 1] < total - 1) items.push('ellipsis')
  items.push(total)
  return items
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-3.5 py-1.5 text-sm transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card text-foreground/75 hover:bg-accent hover:text-accent-foreground',
      )}
    >
      {children}
    </button>
  )
}

/**
 * 工具库：473 工具全量浏览
 * - 关键词搜索（名称/简介模糊匹配）+ 一级分类筛选 + 场景筛选
 * - 筛选条件同步到 URL（?q=&cat=&scene=），支持从首页 ?scene=xx 跳入
 * - 每页 24 个，shadcn Pagination 控件
 */
export default function Tools() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const resultTopRef = useRef<HTMLDivElement>(null)

  // 筛选状态以 URL 参数为准（可分享、可回退）；非法取值回退「全部」
  const rawCat = searchParams.get('cat') ?? ALL
  const rawScene = searchParams.get('scene') ?? ALL
  const keyword = searchParams.get('q') ?? ''
  const category = (CATEGORIES as readonly string[]).includes(rawCat) ? rawCat : ALL
  const scene = (SCENES as readonly string[]).includes(rawScene) ? rawScene : ALL

  useEffect(() => {
    document.title = '工具库 · 横店影视 AIGC 门户'
  }, [])

  /** 更新 URL 参数（空值即删除，保持链接干净；replace 避免刷屏历史记录） */
  const updateParams = (patch: Record<string, string>) => {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    setSearchParams(next, { replace: true })
  }

  // 筛选条件变化时回到第 1 页
  useEffect(() => {
    setPage(1)
  }, [keyword, category, scene])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return tools.filter((t) => {
      if (category !== ALL && t.category !== category) return false
      if (scene !== ALL && !t.scenes.includes(scene)) return false
      if (kw && !t.name.toLowerCase().includes(kw) && !t.desc.toLowerCase().includes(kw)) {
        return false
      }
      return true
    })
  }, [keyword, category, scene])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const goToPage = (p: number) => {
    setPage(p)
    resultTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const hasActiveFilter = keyword.trim() !== '' || category !== ALL || scene !== ALL
  const clearFilters = () => updateParams({ q: '', cat: '', scene: '' })

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      {/* 页头 */}
      <header>
        <h1 className="text-3xl font-bold tracking-tight">工具库</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          收录 <span className="font-medium text-gold">{tools.length}</span> 个 AI
          工具，按影视生产流程重新组织，找得到、看得懂、用得上。
        </p>
      </header>

      {/* 搜索 + 筛选 */}
      <section className="mt-6 space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={(e) => updateParams({ q: e.target.value })}
            placeholder="搜索工具名称或简介，如「剪辑」「海报」「剧本」…"
            className="pl-9"
            aria-label="搜索工具"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">分类</span>
          {CATEGORY_FILTERS.map((c) => (
            <Chip
              key={c.value}
              active={category === c.value}
              onClick={() => updateParams({ cat: c.value === ALL ? '' : c.value })}
            >
              {c.label}
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">场景</span>
          {SCENE_FILTERS.map((s) => (
            <Chip
              key={s}
              active={scene === s}
              onClick={() => updateParams({ scene: s === ALL ? '' : s })}
            >
              {s}
            </Chip>
          ))}
        </div>
      </section>

      {/* 结果计数 */}
      <div ref={resultTopRef} className="mt-6 flex scroll-mt-20 items-baseline justify-between">
        <p className="text-sm text-muted-foreground">
          共 <span className="font-semibold text-foreground">{filtered.length}</span> 个工具
          {hasActiveFilter && filtered.length !== tools.length && '（已筛选）'}
        </p>
        {hasActiveFilter && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-sm text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
          >
            清除筛选
          </button>
        )}
      </div>

      {/* 工具网格 / 空态 */}
      {pageItems.length > 0 ? (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {pageItems.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      ) : (
        <div className="mt-4 flex flex-col items-center rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
          <SearchX className="h-10 w-10 text-muted-foreground/60" />
          <p className="mt-4 font-medium">没有找到匹配的工具</p>
          <p className="mt-1 text-sm text-muted-foreground">
            换个关键词试试，或清除筛选后浏览全部 {tools.length} 个工具。
          </p>
          {hasActiveFilter && (
            <Button variant="outline" size="sm" className="mt-5" onClick={clearFilters}>
              清除全部筛选
            </Button>
          )}
        </div>
      )}

      {/* 分页 */}
      {totalPages > 1 && (
        <Pagination className="mt-8">
          <PaginationContent>
            <PaginationItem>
              <PaginationLink
                href="#"
                size="default"
                aria-label="上一页"
                aria-disabled={currentPage === 1}
                className={cn('gap-1 px-2.5', currentPage === 1 && 'pointer-events-none opacity-50')}
                onClick={(e) => {
                  e.preventDefault()
                  if (currentPage > 1) goToPage(currentPage - 1)
                }}
              >
                <ChevronLeft className="h-4 w-4" />
                <span className="hidden sm:block">上一页</span>
              </PaginationLink>
            </PaginationItem>
            {buildPageList(currentPage, totalPages).map((item, idx) =>
              item === 'ellipsis' ? (
                <PaginationItem key={`ellipsis-${idx}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={item}>
                  <PaginationLink
                    href="#"
                    isActive={item === currentPage}
                    onClick={(e) => {
                      e.preventDefault()
                      goToPage(item)
                    }}
                  >
                    {item}
                  </PaginationLink>
                </PaginationItem>
              ),
            )}
            <PaginationItem>
              <PaginationLink
                href="#"
                size="default"
                aria-label="下一页"
                aria-disabled={currentPage === totalPages}
                className={cn(
                  'gap-1 px-2.5',
                  currentPage === totalPages && 'pointer-events-none opacity-50',
                )}
                onClick={(e) => {
                  e.preventDefault()
                  if (currentPage < totalPages) goToPage(currentPage + 1)
                }}
              >
                <span className="hidden sm:block">下一页</span>
                <ChevronRight className="h-4 w-4" />
              </PaginationLink>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  )
}
