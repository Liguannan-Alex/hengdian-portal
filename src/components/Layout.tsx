import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Clapperboard, Menu, X, User as UserIcon, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import AuthDialog from '@/components/AuthDialog'
import type { AuthMode } from '@/components/AuthDialog'
import { useAuth } from '@/lib/auth'

const NAV_ITEMS = [
  { to: '/', label: '首页' },
  { to: '/tools', label: '工具库' },
  { to: '/favorites', label: '我的收藏' },
] as const

/**
 * 全局布局：顶部导航 + 内容区(Outlet) + 页脚
 * - 登录/注册弹窗的 open / mode 状态在此控制，传给 AuthDialog
 * - 「场景」入口指向首页锚点 /#scenes（首页工程师请在场景区块加 id="scenes"）
 */
export default function Layout() {
  const { currentUser, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<AuthMode>('login')

  const openAuth = (mode: AuthMode) => {
    setAuthMode(mode)
    setAuthOpen(true)
    setMobileOpen(false)
  }

  const handleLogout = () => {
    logout()
    setMobileOpen(false)
    if (location.pathname === '/favorites') navigate('/')
  }

  // 路由变化：关闭移动菜单；带 hash 时滚动到锚点，否则回顶部
  useEffect(() => {
    setMobileOpen(false)
    if (location.hash) {
      const timer = setTimeout(() => {
        document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' })
      }, 50)
      return () => clearTimeout(timer)
    }
    window.scrollTo(0, 0)
  }, [location.pathname, location.hash])

  // 监听全局「需要登录」事件（如未登录点击收藏星标），打开登录弹窗
  useEffect(() => {
    const handleRequireAuth = () => {
      setAuthMode('login')
      setAuthOpen(true)
    }
    window.addEventListener('hd:require-auth', handleRequireAuth)
    return () => window.removeEventListener('hd:require-auth', handleRequireAuth)
  }, [])

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `text-sm font-medium transition-colors hover:text-primary ${
      isActive ? 'text-primary' : 'text-foreground/80'
    }`

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2">
            <Clapperboard className="h-6 w-6 text-primary" />
            <span className="text-lg font-bold tracking-tight">
              横店影视 <span className="text-primary">AIGC</span> 门户
            </span>
          </Link>

          {/* 桌面端导航 */}
          <nav className="hidden items-center gap-6 md:flex">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.to === '/'} className={navLinkClass}>
                {item.label}
              </NavLink>
            ))}
            <Link to="/#scenes" className="text-sm font-medium text-foreground/80 transition-colors hover:text-primary">
              场景
            </Link>
          </nav>

          {/* 桌面端账号区 */}
          <div className="hidden items-center gap-2 md:flex">
            {currentUser ? (
              <>
                <span className="flex items-center gap-1.5 text-sm text-foreground/80">
                  <UserIcon className="h-4 w-4 text-primary" />
                  {currentUser.username}
                </span>
                <Button variant="outline" size="sm" onClick={handleLogout}>
                  <LogOut className="mr-1 h-4 w-4" />
                  退出
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={() => openAuth('login')}>
                  登录
                </Button>
                <Button size="sm" onClick={() => openAuth('register')}>
                  注册
                </Button>
              </>
            )}
          </div>

          {/* 移动端菜单按钮 */}
          <button
            className="inline-flex items-center justify-center rounded-md p-2 text-foreground/80 hover:bg-accent md:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="打开菜单"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* 移动端抽屉 */}
        {mobileOpen && (
          <div className="border-t border-border bg-background md:hidden">
            <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    `rounded-md px-3 py-2 text-sm font-medium ${
                      isActive ? 'bg-accent text-accent-foreground' : 'text-foreground/80 hover:bg-accent'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
              <Link
                to="/#scenes"
                className="rounded-md px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-accent"
              >
                场景
              </Link>
              <div className="mt-2 flex items-center gap-2 border-t border-border pt-3">
                {currentUser ? (
                  <>
                    <span className="flex flex-1 items-center gap-1.5 px-3 text-sm text-foreground/80">
                      <UserIcon className="h-4 w-4 text-primary" />
                      {currentUser.username}
                    </span>
                    <Button variant="outline" size="sm" onClick={handleLogout}>
                      退出
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => openAuth('login')}>
                      登录
                    </Button>
                    <Button size="sm" className="flex-1" onClick={() => openAuth('register')}>
                      注册
                    </Button>
                  </>
                )}
              </div>
            </nav>
          </div>
        )}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="bg-ink text-paper/70">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <div className="flex items-center gap-2 text-paper">
            <Clapperboard className="h-5 w-5 text-gold-soft" />
            <span className="font-bold">
              横店影视 <span className="text-gold-soft">AIGC</span> 门户
            </span>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed">
            面向横店中小剧组的一站式 AI 工具导航与应用门户：把散落的 AI 工具按影视生产流程重新组织，
            让剧组人员找得到、看得懂、用得上。
          </p>
          <p className="mt-4 text-xs">
            数据来源：ai-bot.cn ｜ 本站仅作工具导航与演示，工具权益归原厂商所有
          </p>
          <p className="mt-1 text-xs text-paper/50">© 2026 横店影视 AIGC 门户（MVP 演示版）</p>
        </div>
      </footer>

      <AuthDialog open={authOpen} mode={authMode} onOpenChange={setAuthOpen} onModeChange={setAuthMode} />
    </div>
  )
}
