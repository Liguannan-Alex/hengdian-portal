import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Filter,
  Search,
  SearchX,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToolCard } from '@/components/ToolCard'
import { ToolFilters } from '@/components/ToolFilters'
import {
  SORT_OPTIONS,
  VISIBLE_STATUSES,
  type ToolSort,
  type VisibleStatus,
} from '@/components/tool-filter-options'
import {
  CATEGORIES,
  effectiveTools,
  parseSceneParam,
  SCENE_DEFINITIONS,
  type EffectiveTool,
  type SceneSlug,
} from '@/data/tools'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 18

function positiveInteger(value: string | null) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function buildPageList(current: number, total: number): Array<number | 'ellipsis'> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1)
  const nearby = [current - 1, current, current + 1].filter((page) => page > 1 && page < total)
  const items: Array<number | 'ellipsis'> = [1]
  if ((nearby[0] ?? total) > 2) items.push('ellipsis')
  items.push(...nearby)
  if ((nearby.at(-1) ?? 1) < total - 1) items.push('ellipsis')
  items.push(total)
  return items
}

function sortTools(items: EffectiveTool[], sort: ToolSort) {
  return [...items].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name, 'zh-CN')
    if (sort === 'recently-verified') {
      const aTime = a.verifiedAt ? Date.parse(a.verifiedAt) : 0
      const bTime = b.verifiedAt ? Date.parse(b.verifiedAt) : 0
      return bTime - aTime || b.sortWeight - a.sortWeight || a.name.localeCompare(b.name, 'zh-CN')
    }
    return (
      Number(b.featured) - Number(a.featured) ||
      b.sortWeight - a.sortWeight ||
      Number(b.verificationStatus === 'verified') - Number(a.verificationStatus === 'verified') ||
      a.name.localeCompare(b.name, 'zh-CN')
    )
  })
}

export default function Tools() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const resultTopRef = useRef<HTMLDivElement>(null)
  const filterButtonRef = useRef<HTMLButtonElement>(null)
  const filterCloseRef = useRef<HTMLButtonElement>(null)
  const filterDrawerRef = useRef<HTMLElement>(null)

  const keyword = searchParams.get('q') ?? ''
  const rawCategory = searchParams.get('cat') ?? ''
  const category = (CATEGORIES as readonly string[]).includes(rawCategory) ? rawCategory : ''
  const parsedScene = parseSceneParam(searchParams.get('scene'))
  const scene: SceneSlug | '' = parsedScene ?? ''
  const rawStatus = searchParams.get('status') ?? ''
  const status: VisibleStatus = (VISIBLE_STATUSES as readonly string[]).includes(rawStatus)
    ? (rawStatus as VisibleStatus)
    : ''
  const rawSort = searchParams.get('sort') ?? 'recommended'
  const sort: ToolSort = (SORT_OPTIONS.map((item) => item.value) as readonly string[]).includes(rawSort)
    ? (rawSort as ToolSort)
    : 'recommended'
  const requestedPage = positiveInteger(searchParams.get('page'))
  const sceneDefinition = scene
    ? SCENE_DEFINITIONS.find((item) => item.slug === scene) ?? null
    : null

  const setUrlState = (
    patch: Record<string, string>,
    options: { replace?: boolean; resetPage?: boolean } = {},
  ) => {
    window.dispatchEvent(new Event('hd:remember-scroll'))
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    if (options.resetPage) next.delete('page')
    setSearchParams(next, { replace: options.replace ?? false })
  }

  const filteredTools = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLocaleLowerCase('zh-CN')
    const matches = effectiveTools.filter((tool) => {
      if (category && tool.category !== category) return false
      if (scene && !tool.sceneSlugs.includes(scene as SceneSlug)) return false
      if (status && tool.verificationStatus !== status) return false
      if (!normalizedKeyword) return true
      const searchText = [
        tool.name,
        tool.desc,
        tool.recommendationReason ?? '',
        tool.category,
        ...tool.scenes,
      ]
        .join(' ')
        .toLocaleLowerCase('zh-CN')
      return searchText.includes(normalizedKeyword)
    })
    return sortTools(matches, sort)
  }, [category, keyword, scene, sort, status])

  const totalPages = Math.max(1, Math.ceil(filteredTools.length / PAGE_SIZE))
  const currentPage = Math.min(requestedPage, totalPages)
  const pageItems = filteredTools.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const activeFilterCount = Number(Boolean(category)) + Number(Boolean(scene)) + Number(Boolean(status)) + Number(sort !== 'recommended')
  const hasActiveFilters = activeFilterCount > 0
  const hasAnyQuery = hasActiveFilters || Boolean(keyword.trim())

  useEffect(() => {
    document.title = sceneDefinition
      ? `${sceneDefinition.name} AI 工具 · 横店影视数智服务门户`
      : 'AI 工具库 · 横店影视数智服务门户'
  }, [sceneDefinition])

  // 链接中的页码超出当前结果范围时，用 replace 归一化，避免制造无效历史记录。
  useEffect(() => {
    if (requestedPage <= totalPages) return
    window.dispatchEvent(new Event('hd:remember-scroll'))
    const next = new URLSearchParams(searchParams)
    if (totalPages > 1) next.set('page', String(totalPages))
    else next.delete('page')
    setSearchParams(next, { replace: true })
  }, [requestedPage, searchParams, setSearchParams, totalPages])

  useEffect(() => {
    if (!mobileFiltersOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    requestAnimationFrame(() => filterCloseRef.current?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileFiltersOpen(false)
        requestAnimationFrame(() => filterButtonRef.current?.focus())
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(
        filterDrawerRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.offsetParent !== null)
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      } else if (!filterDrawerRef.current?.contains(document.activeElement)) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [mobileFiltersOpen])

  // 抽屉打开时若跨过桌面断点，解除滚动锁定并回到常驻侧栏。
  useEffect(() => {
    if (!mobileFiltersOpen) return
    const media = window.matchMedia('(min-width: 1024px)')
    const closeAtDesktop = () => {
      if (media.matches) setMobileFiltersOpen(false)
    }
    media.addEventListener('change', closeAtDesktop)
    return () => media.removeEventListener('change', closeAtDesktop)
  }, [mobileFiltersOpen])

  const goToPage = (page: number) => {
    setUrlState({ page: page > 1 ? String(page) : '' })
    requestAnimationFrame(() => {
      const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
      resultTopRef.current?.focus({ preventScroll: true })
      resultTopRef.current?.scrollIntoView({ behavior, block: 'start' })
    })
  }

  const clearAll = () => {
    window.dispatchEvent(new Event('hd:remember-scroll'))
    setSearchParams({}, { replace: false })
  }

  const filterProps = {
    categories: CATEGORIES,
    scenes: SCENE_DEFINITIONS,
    category,
    scene,
    status,
    sort,
    hasActiveFilters,
    onCategoryChange: (value: string) => setUrlState({ cat: value }, { resetPage: true }),
    onSceneChange: (value: string) => setUrlState({ scene: value }, { resetPage: true }),
    onStatusChange: (value: VisibleStatus) => setUrlState({ status: value }, { resetPage: true }),
    onSortChange: (value: ToolSort) =>
      setUrlState({ sort: value === 'recommended' ? '' : value }, { resetPage: true }),
    onClear: () =>
      setUrlState({ cat: '', scene: '', status: '', sort: '' }, { resetPage: true }),
  } as const

  return (
    <div className="min-h-[70vh]">
      <header className="relative overflow-hidden border-b border-border bg-ink">
        <div className="pointer-events-none absolute inset-0 stage-light" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-0 portal-grid opacity-40" aria-hidden="true" />
        <div className="film-grain pointer-events-none absolute inset-0" aria-hidden="true" />
        <span
          className="pointer-events-none absolute -right-4 -top-10 select-none font-mono text-[7rem] font-bold leading-none text-paper/[0.04] sm:text-[9rem]"
          aria-hidden="true"
        >
          TOOLS
        </span>
        <div className="relative mx-auto max-w-7xl px-4 py-8 sm:py-10 lg:px-6">
          <nav className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" aria-label="面包屑">
            <Link to="/" className="hover:text-primary">首页</Link>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            {sceneDefinition ? (
              <>
                <Link to="/tools" className="hover:text-primary">AI 工具库</Link>
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                <span aria-current="page">{sceneDefinition.name}</span>
              </>
            ) : (
              <span aria-current="page">AI 工具库</span>
            )}
          </nav>

          <div className="mt-4 flex flex-wrap items-end justify-between gap-5">
            <div className="max-w-3xl">
              <p className="flex flex-wrap items-center gap-3 font-mono text-xs font-semibold tracking-[0.3em] text-gold">
                AI TOOLS
                <span className="hairline-gold h-px w-12" aria-hidden="true" />
                <span className="font-normal tracking-[0.2em] text-paper/45" aria-hidden="true">
                  INDEX&nbsp;{String(effectiveTools.length).padStart(2, '0')}
                </span>
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-paper sm:text-4xl">
                {sceneDefinition ? `${sceneDefinition.name}工具` : 'AI 工具库'}
              </h1>
              <p className="mt-3 leading-7 text-muted-foreground">
                {sceneDefinition
                  ? sceneDefinition.tagline
                  : '按剧组场景、工具分类与编辑核验状态筛选。列表只提供工具官网入口，不跳转第三方聚合详情页。'}
              </p>
            </div>
            <Button
              asChild
              variant="outline"
              className="border-paper/20 bg-paper/[0.04] text-paper backdrop-blur hover:border-gold/40 hover:bg-gold/10 hover:text-gold-soft"
            >
              <Link to={{ pathname: '/', hash: '#scenes' }}>
                <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
                返回场景总览
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-8 lg:px-6">
        <div className="grid gap-8 lg:grid-cols-[15.5rem_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <div className="glass-panel sticky top-24 rounded-2xl p-4 shadow-lg shadow-black/40">
              <ToolFilters {...filterProps} />
            </div>
          </aside>

          <div className="min-w-0">
            <div className="glass-panel flex gap-2 rounded-2xl p-2 shadow-lg shadow-black/30">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  type="search"
                  value={keyword}
                  onChange={(event) =>
                    setUrlState({ q: event.target.value }, { replace: true, resetPage: true })
                  }
                  placeholder="搜索名称、简介或推荐理由…"
                  className="h-11 border-paper/10 bg-ink-soft/70 pl-9 pr-10 focus-visible:border-gold/50"
                  aria-label="搜索 AI 工具"
                />
                {keyword && (
                  <button
                    type="button"
                    onClick={() => setUrlState({ q: '' }, { replace: true, resetPage: true })}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="清除搜索词"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              <Button
                ref={filterButtonRef}
                type="button"
                variant="outline"
                className="h-11 gap-2 border-paper/10 bg-ink-soft/70 hover:border-gold/40 hover:bg-gold/10 hover:text-gold-soft lg:hidden"
                onClick={() => setMobileFiltersOpen(true)}
                aria-expanded={mobileFiltersOpen}
                aria-controls="mobile-tool-filters"
              >
                <Filter className="h-4 w-4" aria-hidden="true" />
                筛选
                {activeFilterCount > 0 && (
                  <span className="rounded-full bg-primary px-1.5 py-0.5 text-[0.65rem] leading-none text-primary-foreground">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            </div>

            <div ref={resultTopRef} tabIndex={-1} className="mt-5 flex scroll-mt-24 flex-wrap items-center justify-between gap-3 outline-none">
              <p className="text-sm text-muted-foreground" aria-live="polite">
                找到 <span className="font-mono font-semibold text-gold-soft">{filteredTools.length}</span> 个工具
                {totalPages > 1 && ` · 第 ${currentPage}/${totalPages} 页`}
              </p>
              {hasAnyQuery && (
                <button type="button" onClick={clearAll} className="text-sm text-muted-foreground hover:text-primary hover:underline">
                  清除搜索与筛选
                </button>
              )}
            </div>

            {pageItems.length > 0 ? (
              <div className="mt-4 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {pageItems.map((tool) => <ToolCard key={tool.id} tool={tool} />)}
              </div>
            ) : (
              <div className="mt-4 flex flex-col items-center rounded-2xl border border-dashed border-paper/15 bg-ink-soft/40 px-6 py-16 text-center">
                <SearchX className="h-10 w-10 text-gold/40" aria-hidden="true" />
                <h2 className="mt-4 text-lg font-semibold text-paper">没有找到匹配的工具</h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                  可以减少筛选条件或换一个更短的关键词。核验中的条目也可能暂未进入当前结果。
                </p>
                <Button variant="outline" size="sm" className="mt-5" onClick={clearAll}>清除搜索与筛选</Button>
              </div>
            )}

            {totalPages > 1 && (
              <nav className="mt-9 flex flex-wrap items-center justify-center gap-1" aria-label="工具列表分页">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={currentPage === 1}
                  onClick={() => goToPage(currentPage - 1)}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
                  上一页
                </Button>
                {buildPageList(currentPage, totalPages).map((item, index) =>
                  item === 'ellipsis' ? (
                    <span key={`ellipsis-${index}`} className="px-2 text-sm text-muted-foreground" aria-hidden="true">…</span>
                  ) : (
                    <button
                      key={item}
                      type="button"
                      onClick={() => goToPage(item)}
                      aria-current={item === currentPage ? 'page' : undefined}
                      aria-label={`第 ${item} 页`}
                      className={cn(
                        'h-9 min-w-9 rounded-md border px-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        item === currentPage
                          ? 'border-primary bg-primary font-medium text-primary-foreground shadow-[0_0_14px_-2px_hsl(var(--gold)/0.5)]'
                          : 'border-paper/10 bg-ink-soft/60 text-foreground/80 hover:border-gold/30 hover:bg-gold/10 hover:text-gold-soft',
                      )}
                    >
                      {item}
                    </button>
                  ),
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={currentPage === totalPages}
                  onClick={() => goToPage(currentPage + 1)}
                >
                  下一页
                  <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
                </Button>
              </nav>
            )}
          </div>
        </div>
      </div>

      {mobileFiltersOpen && (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-ink/70 backdrop-blur-[2px]"
            onClick={() => {
              setMobileFiltersOpen(false)
              requestAnimationFrame(() => filterButtonRef.current?.focus())
            }}
            aria-label="关闭筛选"
          />
          <aside
            ref={filterDrawerRef}
            id="mobile-tool-filters"
            className="absolute inset-y-0 right-0 flex w-[min(90vw,23rem)] flex-col border-l border-paper/10 bg-background shadow-2xl shadow-black/60"
            role="dialog"
            aria-modal="true"
            aria-label="筛选 AI 工具"
          >
            <div className="flex h-[4.5rem] items-center justify-between border-b border-border px-5">
              <span className="flex items-center gap-2 font-semibold text-paper">
                <SlidersHorizontal className="h-4 w-4 text-gold" aria-hidden="true" />
                筛选 AI 工具
              </span>
              <button
                ref={filterCloseRef}
                type="button"
                onClick={() => {
                  setMobileFiltersOpen(false)
                  requestAnimationFrame(() => filterButtonRef.current?.focus())
                }}
                className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="关闭筛选"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <ToolFilters {...filterProps} />
            </div>
            <div className="border-t border-border bg-card p-4">
              <Button
                className="w-full"
                onClick={() => {
                  setMobileFiltersOpen(false)
                  requestAnimationFrame(() => filterButtonRef.current?.focus())
                }}
              >
                查看 {filteredTools.length} 个结果
              </Button>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
