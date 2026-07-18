import type { VerificationStatus } from '@/data/tools'

export type VisibleStatus = '' | Exclude<VerificationStatus, 'excluded'>
export type ToolSort = 'recommended' | 'recently-verified' | 'name'

export const SORT_OPTIONS: ReadonlyArray<{ value: ToolSort; label: string }> = [
  { value: 'recommended', label: '推荐优先' },
  { value: 'recently-verified', label: '最近核验' },
  { value: 'name', label: '名称排序' },
]

export const VISIBLE_STATUSES: ReadonlyArray<Exclude<VisibleStatus, ''>> = [
  'verified',
  'needs-review',
  'unreviewed',
]
