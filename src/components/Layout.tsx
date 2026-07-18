import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import {
  CheckCircle2,
  CircleAlert,
  Heart,
  LogOut,
  Menu,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import AuthDialog from '@/components/AuthDialog'
import type { AuthMode } from '@/components/AuthDialog'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { to: '/', label: '首页', end: true },
  { to: '/tools', label: 'AI 工具库', end: false },
] as const

const requireProfile = () => window.dispatchEvent(new CustomEvent('hd:require-auth'))
const routeScrollPositions = new Map<string, number>()

export default function Layout() {
  const {
    currentUser,
    favorites,
    logout,
    storageAvailable,
    storageNotice,
    actionNotice,
    clearActionNotice,
  } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const [mobileOpenKey, setMobileOpenKey] = useState<string | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const mainRef = useRef<HTMLElement>(null)
  const currentScrollKeyRef = useRef(location.key)
  const restoringScrollRef = useRef(false)
  const scrollCommitTimerRef = useRef<number | null>(null)
  const focusedPageRef = useRef<string | null>(null)
  const headerRef = useRef<HTMLElement>(null)
  const footerRef = useRef<HTMLElement>(null)
  const mobileDrawerRef = useRef<HTMLElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const mobileCloseRef = useRef<HTMLButtonElement>(null)
  const mobileOpen = mobileOpenKey === location.key

  // 统一管理所有路由历史项的滚动位置，避免 Tools 与首页之间 POP 时相互覆盖。
  useEffect(() => {
    const previousMode = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    const rememberBeforeHistoryChange = () => {
      if (restoringScrollRef.current) return
      routeScrollPositions.set(currentScrollKeyRef.current, window.scrollY)
    }
    const scheduleStablePosition = () => {
      if (restoringScrollRef.current) return
      if (scrollCommitTimerRef.current !== null) {
        window.clearTimeout(scrollCommitTimerRef.current)
      }
      const key = currentScrollKeyRef.current
      const y = window.scrollY
      // 只提交已经稳定的用户位置。路由库为激活固定页头链接而执行的
      // 临时 scrollIntoView 会紧接着发生导航，并在 key 切换时被取消。
      scrollCommitTimerRef.current = window.setTimeout(() => {
        if (!restoringScrollRef.current && currentScrollKeyRef.current === key) {
          routeScrollPositions.set(key, y)
        }
        scrollCommitTimerRef.current = null
      }, 500)
    }
    rememberBeforeHistoryChange()
    window.addEventListener('scroll', scheduleStablePosition, { passive: true })
    window.addEventListener('hd:remember-scroll', rememberBeforeHistoryChange)
    return () => {
      if (scrollCommitTimerRef.current !== null) {
        window.clearTimeout(scrollCommitTimerRef.current)
      }
      window.removeEventListener('scroll', scheduleStablePosition)
      window.removeEventListener('hd:remember-scroll', rememberBeforeHistoryChange)
      window.history.scrollRestoration = previousMode
    }
  }, [])

  useLayoutEffect(() => {
    const previousKey = currentScrollKeyRef.current
    if (previousKey !== location.key) {
      if (scrollCommitTimerRef.current !== null) {
        window.clearTimeout(scrollCommitTimerRef.current)
        scrollCommitTimerRef.current = null
      }
      if (navigationType === 'REPLACE' && !routeScrollPositions.has(location.key)) {
        routeScrollPositions.set(
          location.key,
          routeScrollPositions.get(previousKey) ?? window.scrollY,
        )
      }
      currentScrollKeyRef.current = location.key
    }
    if (navigationType !== 'POP') return

    const target = routeScrollPositions.get(location.key) ?? 0
    const root = document.documentElement
    const previousBehavior = root.style.scrollBehavior
    let frame = 0
    let attempts = 0
    restoringScrollRef.current = true
    root.style.scrollBehavior = 'auto'

    // POP 时新页面可能尚未撑开到原高度。双帧后开始恢复，并在约半秒内
    // 重试，防止目标位置被浏览器按临时页面高度截断。
    const restore = () => {
      window.scrollTo({ top: target, behavior: 'auto' })
      attempts += 1
      if (Math.abs(window.scrollY - target) <= 2 || attempts >= 30) {
        restoringScrollRef.current = false
        routeScrollPositions.set(location.key, window.scrollY)
        root.style.scrollBehavior = previousBehavior
        return
      }
      frame = requestAnimationFrame(restore)
    }
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(restore)
    })

    return () => {
      cancelAnimationFrame(frame)
      restoringScrollRef.current = false
      root.style.scrollBehavior = previousBehavior
    }
  }, [location.key, navigationType])

  const openAuth = (mode: AuthMode = 'login') => {
    setAuthMode(mode)
    setAuthOpen(true)
    setMobileOpenKey(null)
  }

  const closeMobile = (returnFocus = false) => {
    setMobileOpenKey(null)
    if (returnFocus) requestAnimationFrame(() => menuButtonRef.current?.focus())
  }

  const handleLogout = () => {
    logout()
    closeMobile()
    if (location.pathname === '/favorites') {
      routeScrollPositions.set(currentScrollKeyRef.current, window.scrollY)
      navigate('/')
    }
  }

  // 路由切换后把键盘/读屏焦点移到主内容；锚点由目标区块接管滚动。
  useEffect(() => {
    const pageIdentity = `${location.pathname}${location.hash}`
    // 搜索与筛选只改变 query，不属于换页；不能在用户输入时抢走焦点。
    if (focusedPageRef.current === pageIdentity) return
    focusedPageRef.current = pageIdentity
    const frame = requestAnimationFrame(() => {
      mainRef.current?.focus({ preventScroll: true })
      if (location.hash) {
        const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
        document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior })
      } else if (navigationType !== 'POP') {
        window.scrollTo({ top: 0, behavior: 'auto' })
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [location.pathname, location.hash, navigationType])

  // 从移动断点切换到桌面端时主动关闭抽屉，避免 body 继续被锁定。
  useEffect(() => {
    if (!mobileOpen) return
    const media = window.matchMedia('(min-width: 1024px)')
    const closeAtDesktop = () => {
      if (media.matches) setMobileOpenKey(null)
    }
    media.addEventListener('change', closeAtDesktop)
    return () => media.removeEventListener('change', closeAtDesktop)
  }, [mobileOpen])

  // 移动抽屉：打开后聚焦关闭按钮，Escape 关闭并把焦点还给触发按钮。
  useEffect(() => {
    if (!mobileOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const backgroundRoots = [headerRef.current, mainRef.current, footerRef.current].filter(Boolean) as HTMLElement[]
    backgroundRoots.forEach((element) => element.setAttribute('inert', ''))
    requestAnimationFrame(() => mobileCloseRef.current?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMobile(true)
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(
        mobileDrawerRef.current?.querySelectorAll<HTMLElement>(
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
      } else if (!mobileDrawerRef.current?.contains(document.activeElement)) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      backgroundRoots.forEach((element) => element.removeAttribute('inert'))
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [mobileOpen])

  useEffect(() => {
    const handleRequireAuth = () => openAuth('login')
    window.addEventListener('hd:require-auth', handleRequireAuth)
    return () => window.removeEventListener('hd:require-auth', handleRequireAuth)
  }, [])

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'relative rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-soft',
      isActive ? 'text-gold-soft' : 'text-paper/72 hover:text-paper',
    )

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <a
        href="#main-content"
        onClick={(event) => {
          event.preventDefault()
          mainRef.current?.focus()
        }}
        className="fixed left-4 top-3 z-[100] -translate-y-24 rounded-md bg-paper px-4 py-2 text-sm font-semibold text-ink shadow-lg transition-transform focus:translate-y-0"
      >
        跳到主要内容
      </a>

      <header ref={headerRef} className="fixed inset-x-0 top-0 z-50 border-b border-paper/10 bg-ink text-paper shadow-[0_1px_0_rgba(255,255,255,0.04)]">
        <div className="mx-auto grid h-[4.5rem] max-w-7xl grid-cols-[1fr_auto] items-center gap-4 px-4 lg:grid-cols-[1fr_auto_1fr] lg:px-6">
          <Link
            to="/"
            className="flex min-w-0 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-soft"
            aria-label="横店影视数智服务门户首页"
          >
            <img
              src={`${import.meta.env.BASE_URL}brand/hengdian-world-studios-logo.png`}
              alt="横店影视城"
              className="h-7 w-auto shrink-0 object-contain sm:h-9"
            />
            <span className="ml-2 border-l border-paper/25 pl-2 text-xs font-semibold tracking-[0.08em] text-paper sm:ml-3 sm:pl-3 sm:text-base sm:tracking-[0.12em]">
              AIGC 工具
            </span>
          </Link>

          <nav className="hidden items-center gap-1 lg:flex" aria-label="主导航">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
                {item.label}
              </NavLink>
            ))}
            <Link
              to={{ pathname: '/', hash: '#scenes' }}
              className="rounded-md px-3 py-2 text-sm font-medium text-paper/72 transition-colors hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-soft"
            >
              场景
            </Link>
          </nav>

          <div className="hidden items-center justify-end gap-2 lg:flex">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-paper/76 hover:bg-paper/10 hover:text-paper"
            >
              <Link to="/favorites" aria-label={`我的收藏，当前 ${favorites.length} 个工具`}>
                <Heart className="mr-1.5 h-4 w-4" aria-hidden="true" />
                收藏
                {favorites.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-gold px-1.5 py-0.5 text-[0.65rem] font-bold leading-none text-ink">
                    {favorites.length}
                  </span>
                )}
              </Link>
            </Button>
            <span className="h-5 w-px bg-paper/15" aria-hidden="true" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={requireProfile}
              className="max-w-40 text-paper/76 hover:bg-paper/10 hover:text-paper"
            >
              <UserRound className="mr-1.5 h-4 w-4 shrink-0 text-gold-soft" aria-hidden="true" />
              <span className="truncate">{currentUser?.username ?? '建立本机档案'}</span>
            </Button>
            {currentUser && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={handleLogout}
                className="text-paper/55 hover:bg-paper/10 hover:text-paper"
                aria-label="离开当前档案"
                title="离开当前档案"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </div>

          <button
            ref={menuButtonRef}
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center justify-self-end rounded-md border border-paper/15 text-paper/80 transition-colors hover:bg-paper/10 hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-soft lg:hidden"
            onClick={() => setMobileOpenKey(mobileOpen ? null : location.key)}
            aria-label={mobileOpen ? '关闭菜单' : '打开菜单'}
            aria-expanded={mobileOpen}
            aria-controls="mobile-navigation"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </header>
      <div className="h-[4.5rem] shrink-0" aria-hidden="true" />

      {mobileOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-ink/72 backdrop-blur-[2px]"
            onClick={() => closeMobile(true)}
            aria-label="关闭菜单"
          />
          <aside
            ref={mobileDrawerRef}
            id="mobile-navigation"
            className="absolute inset-y-0 right-0 flex w-[min(88vw,22rem)] flex-col bg-background shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="移动端导航"
          >
            <div className="flex h-[4.5rem] items-center justify-between border-b border-border px-5">
              <span className="flex items-center gap-2 font-semibold">
                <Sparkles className="h-4 w-4 text-primary" />
                门户导航
              </span>
              <button
                ref={mobileCloseRef}
                type="button"
                className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => closeMobile(true)}
                aria-label="关闭菜单"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-4 py-5" aria-label="移动端主导航">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      'rounded-lg px-4 py-3 text-sm font-medium transition-colors',
                      isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
              <Link
                to={{ pathname: '/', hash: '#scenes' }}
                className="rounded-lg px-4 py-3 text-sm font-medium transition-colors hover:bg-muted"
              >
                场景
              </Link>
            </nav>

            <div className="border-t border-border p-4">
              <Link
                to="/favorites"
                className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium"
              >
                <span className="flex items-center gap-2">
                  <Heart className="h-4 w-4 text-primary" />
                  我的收藏
                </span>
                <span className="text-muted-foreground">{favorites.length}</span>
              </Link>
              <button
                type="button"
                onClick={requireProfile}
                className="mt-2 flex w-full items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-left text-sm font-medium"
              >
                <UserRound className="h-4 w-4 text-primary" />
                <span className="flex-1 truncate">{currentUser?.username ?? '建立本机档案'}</span>
              </button>
              {currentUser && (
                <button
                  type="button"
                  onClick={handleLogout}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <LogOut className="h-4 w-4" />
                  离开当前档案
                </button>
              )}
            </div>
          </aside>
        </div>
      )}

      <main
        id="main-content"
        ref={mainRef}
        tabIndex={-1}
        className="flex-1 outline-none"
      >
        {storageNotice && location.pathname !== '/favorites' && (
          <div
            className="border-b border-amber-800/20 bg-amber-50 px-4 py-2.5 text-sm text-amber-950"
            role={storageAvailable ? 'status' : 'alert'}
            aria-live="polite"
          >
            <div className="mx-auto flex max-w-7xl items-start gap-2 lg:px-2">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{storageNotice}</span>
            </div>
          </div>
        )}
        {actionNotice && location.pathname !== '/favorites' && (
          <div className="border-b border-primary/15 bg-accent px-4 py-2.5 text-sm text-accent-foreground" role="status" aria-live="polite">
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 lg:px-2">
              <span className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {actionNotice}
              </span>
              <button type="button" onClick={clearActionNotice} className="shrink-0 rounded-md px-2 py-1 font-medium hover:bg-background/70">
                知道了
              </button>
            </div>
          </div>
        )}
        <Outlet />
      </main>

      <footer ref={footerRef} className="border-t border-paper/10 bg-ink text-paper/68">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-[1fr_auto] lg:px-6">
          <div>
            <div className="flex items-center text-paper">
              <img
                src={`${import.meta.env.BASE_URL}brand/hengdian-world-studios-logo.png`}
                alt="横店影视城"
                className="h-8 w-auto object-contain"
              />
              <span className="ml-3 border-l border-paper/20 pl-3 text-sm font-semibold tracking-wide">AIGC 工具</span>
            </div>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed">
              首发 AI 工具模块，以剧组真实工作场景组织经过编辑核验的工具入口；后续服务模块可在同一门户持续扩展。
            </p>
          </div>
          <nav className="grid grid-cols-2 gap-x-7 gap-y-3 text-sm sm:text-right" aria-label="页脚导航">
            <Link className="hover:text-paper" to="/tools">AI 工具</Link>
            <Link className="hover:text-paper" to={{ pathname: '/', hash: '#scenes' }}>场景总览</Link>
            <Link className="hover:text-paper" to="/favorites">我的收藏</Link>
            <Link className="hover:text-paper" to="/about">关于门户</Link>
          </nav>
        </div>
        <div className="border-t border-paper/10">
          <div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-2 px-4 py-4 text-xs text-paper/60 lg:px-6">
            <span>数据经编辑整理与核验，访问与使用请以工具官网条款为准。</span>
            <span>© 2026 横店影视数智服务门户 · v0.2 内部可用版</span>
          </div>
        </div>
      </footer>

      <AuthDialog
        open={authOpen}
        mode={authMode}
        onOpenChange={setAuthOpen}
        onModeChange={setAuthMode}
      />
    </div>
  )
}
