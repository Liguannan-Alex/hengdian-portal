/**
 * 工作流账号闸门。
 *
 * 工作流会消耗真实算力费用，必须先有可归属的账号。未登录时这里就地给出
 * 登录/注册表单，而不是把用户弹回首页——用户是带着「我要跑这条流水线」
 * 的意图来的，中断得越少越好。
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { KeyRound, Loader2, ServerCog, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useServerAccount } from '@/lib/serverAccount'
import { ApiError, IDENTITY_LABELS, type ServerAccount } from '@/lib/portalApi'
import { fieldClass } from '@/components/ui/field-styles'
import { cn } from '@/lib/utils'

const IDENTITIES = Object.keys(IDENTITY_LABELS) as ServerAccount['identity'][]

function Notice({ tone, children }: { tone: 'warn' | 'error'; children: ReactNode }) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-lg border px-4 py-3 text-sm',
        tone === 'warn'
          ? 'border-amber-400/25 bg-amber-400/10 text-amber-200'
          : 'border-destructive/30 bg-destructive/10 text-red-300',
      )}
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function AccountForm() {
  const { login, register } = useServerAccount()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [identity, setIdentity] = useState<ServerAccount['identity']>('crew')
  const [org, setOrg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'login') {
        await login(username.trim(), password)
      } else {
        await register({
          username: username.trim(),
          password,
          displayName: displayName.trim(),
          identity,
          org: org.trim() || undefined,
        })
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '请求失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-1">
        {(['login', 'register'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setMode(value)
              setError(null)
            }}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              mode === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
            )}
          >
            {value === 'login' ? '登录' : '注册'}
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sa-username">用户名</Label>
        <Input
          id="sa-username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          placeholder="3 至 32 位字母、数字、下划线或连字符"
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sa-password">口令</Label>
        <Input
          id="sa-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          placeholder="8 至 128 位，需同时含字母与数字"
          required
        />
      </div>

      {mode === 'register' && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="sa-display">显示名称</Label>
            <Input
              id="sa-display"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="同事能认出你的称呼"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sa-identity">身份</Label>
            <select
              id="sa-identity"
              className={fieldClass}
              value={identity}
              onChange={(event) => setIdentity(event.target.value as ServerAccount['identity'])}
            >
              {IDENTITIES.map((value) => (
                <option key={value} value={value}>
                  {IDENTITY_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sa-org">单位（选填）</Label>
            <Input
              id="sa-org"
              value={org}
              onChange={(event) => setOrg(event.target.value)}
              placeholder="剧组或公司名称"
            />
          </div>
        </>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      <Button type="submit" className="w-full" disabled={busy}>
        {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
        {mode === 'login' ? '登录并继续' : '注册并继续'}
      </Button>

      <p className="text-xs leading-5 text-muted-foreground">
        该账号与首页的「本机档案」是两回事：本机档案不含密码、只存在本浏览器；
        工作流账号存在门户后端，用于归属任务、控制额度与产出可见范围。
        请勿在参数中填入未公开的项目内容。
      </p>
    </form>
  )
}

/** 未登录或后端不可用时展示提示，登录后渲染 children。 */
export function ServerAccountGate({ children }: { children: ReactNode }) {
  const { account, loading, configured, connectionError } = useServerAccount()

  if (!configured) {
    return (
      <div className="mx-auto max-w-xl">
        <Notice tone="warn">
          <p className="font-semibold">工作流需要门户后端，当前构建未配置后端地址。</p>
          <p className="text-amber-200/80">
            本地开发请启动 <code className="font-mono">server/</code> 后重试；
            正式环境需在构建时设置 <code className="font-mono">VITE_PORTAL_API</code> 指向已部署的后端。
            工具库与本机收藏不受影响，仍可正常使用。
          </p>
        </Notice>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        正在确认登录状态…
      </div>
    )
  }

  if (connectionError) {
    return (
      <div className="mx-auto max-w-xl">
        <Notice tone="warn">
          <p className="font-semibold">连接门户后端失败。</p>
          <p className="text-amber-200/80">{connectionError}</p>
        </Notice>
      </div>
    )
  }

  if (!account) {
    return (
      <div className="mx-auto max-w-md">
        <div className="glass-panel rounded-2xl px-6 py-8 shadow-xl shadow-black/40">
          <div className="mb-5 flex items-center gap-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-gold/25 bg-gold/10">
              <KeyRound className="h-5 w-5 text-gold" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-lg font-bold text-paper">工作流账号</h2>
              <p className="text-xs text-muted-foreground">运行工作流需要可归属的账号</p>
            </div>
          </div>
          <AccountForm />
        </div>
      </div>
    )
  }

  return <>{children}</>
}

/** 页面右上角的当前账号条。 */
export function ServerAccountBar() {
  const { account, logout } = useServerAccount()
  if (!account) return null

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <ServerCog className="h-3.5 w-3.5 text-gold-soft" aria-hidden="true" />
      <span>
        {account.displayName}
        <span className="ml-1.5 text-muted-foreground/70">
          {IDENTITY_LABELS[account.identity]}
          {account.org ? ` · ${account.org}` : ''}
        </span>
      </span>
      <button
        type="button"
        onClick={() => void logout()}
        className="rounded-md px-2 py-1 underline-offset-2 hover:bg-muted hover:underline"
      >
        退出
      </button>
    </div>
  )
}
