/**
 * 演示模式横幅。
 *
 * 演示站的产出是浏览器本地生成的占位内容。不把这件事摆在最显眼的位置，
 * 看的人很容易把占位图当成模型真实生成的效果，进而对能力形成错误预期——
 * 这比功能少一块更糟。
 */
import { FlaskConical, RotateCcw } from 'lucide-react'
import { isDemoMode } from '@/lib/portalApi'

export function DemoBanner() {
  if (!isDemoMode()) return null

  return (
    <div
      className="mb-6 flex flex-wrap items-start gap-3 rounded-lg border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-200"
      role="status"
    >
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-semibold">演示模式：产出为占位内容，不是模型真实生成结果。</p>
        <p className="text-amber-200/80">
          本站是静态托管，没有连接后端与算力。表单、参数校验、排队、额度与结果页
          都按真实逻辑运行，只有生成这一步由浏览器本地模拟，不产生任何费用。
          数据存在当前标签页，关闭即清空。
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          // 动态载入，避免正式构建把演示后端一并打包进来。
          void import('@/lib/demoBackend').then(({ resetDemo }) => {
            resetDemo()
            window.location.reload()
          })
        }}
        className="flex shrink-0 items-center gap-1.5 rounded-md border border-amber-400/25 px-2.5 py-1.5 text-xs font-medium hover:bg-amber-400/10"
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        重置演示数据
      </button>
    </div>
  )
}
