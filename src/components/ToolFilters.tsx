import { RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'
import type { SceneDefinition } from '@/data/tools'
import { VERIFICATION_STATUS_LABELS } from '@/data/tools'
import { cn } from '@/lib/utils'
import { SORT_OPTIONS, VISIBLE_STATUSES, type ToolSort, type VisibleStatus } from '@/components/tool-filter-options'

const CATEGORY_SHORT: Record<string, string> = {
  视频AI工具: '视频工具',
  图片AI工具: '图片工具',
  文字创作AI工具: '文字创作工具',
}

function FilterButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'bg-accent font-medium text-accent-foreground'
          : 'text-foreground/72 hover:bg-muted hover:text-foreground',
      )}
    >
      <span>{children}</span>
      {active && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />}
    </button>
  )
}

export interface ToolFiltersProps {
  categories: readonly string[]
  scenes: readonly SceneDefinition[]
  category: string
  scene: string
  status: VisibleStatus
  sort: ToolSort
  hasActiveFilters: boolean
  onCategoryChange: (value: string) => void
  onSceneChange: (value: string) => void
  onStatusChange: (value: VisibleStatus) => void
  onSortChange: (value: ToolSort) => void
  onClear: () => void
}

export function ToolFilters({
  categories,
  scenes,
  category,
  scene,
  status,
  sort,
  hasActiveFilters,
  onCategoryChange,
  onSceneChange,
  onStatusChange,
  onSortChange,
  onClear,
}: ToolFiltersProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">筛选工具</h2>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            重置
          </button>
        )}
      </div>

      <fieldset>
        <legend className="mb-2 px-1 text-xs font-semibold tracking-wide text-muted-foreground">工作场景</legend>
        <div className="space-y-1">
          <FilterButton active={scene === ''} onClick={() => onSceneChange('')}>
            全部场景
          </FilterButton>
          {scenes.map((item) => (
            <FilterButton
              key={item.slug}
              active={scene === item.slug}
              onClick={() => onSceneChange(item.slug)}
            >
              {item.name}
            </FilterButton>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 px-1 text-xs font-semibold tracking-wide text-muted-foreground">工具分类</legend>
        <div className="space-y-1">
          <FilterButton active={category === ''} onClick={() => onCategoryChange('')}>
            全部分类
          </FilterButton>
          {categories.map((item) => (
            <FilterButton key={item} active={category === item} onClick={() => onCategoryChange(item)}>
              {CATEGORY_SHORT[item] ?? item}
            </FilterButton>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 px-1 text-xs font-semibold tracking-wide text-muted-foreground">核验状态</legend>
        <div className="space-y-1">
          <FilterButton active={status === ''} onClick={() => onStatusChange('')}>
            全部状态
          </FilterButton>
          {VISIBLE_STATUSES.map((item) => (
            <FilterButton key={item} active={status === item} onClick={() => onStatusChange(item)}>
              {VERIFICATION_STATUS_LABELS[item]}
            </FilterButton>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="tool-sort" className="mb-2 block px-1 text-xs font-semibold tracking-wide text-muted-foreground">
          排序方式
        </label>
        <select
          id="tool-sort"
          value={sort}
          onChange={(event) => onSortChange(event.target.value as ToolSort)}
          className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {SORT_OPTIONS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
