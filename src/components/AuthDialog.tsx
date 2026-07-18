import { useEffect, useState } from 'react'
import { CircleAlert, Clapperboard } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/auth'

export type AuthMode = 'login' | 'register'

/**
 * 登录 / 注册弹窗
 * - open / mode 状态由 Layout 控制；TOOLS 工程师在 Layout 中监听 'hd:require-auth' 事件打开本弹窗
 * - 表单校验：用户名 ≥ 3 字符、密码 ≥ 6 字符；注册时需两次密码一致
 * - 登录/注册返回的 error 直接展示；成功后关闭弹窗并清空表单
 */
export interface AuthDialogProps {
  open: boolean
  mode: AuthMode
  onOpenChange: (open: boolean) => void
  onModeChange: (mode: AuthMode) => void
}

const MIN_USERNAME_LEN = 3
const MIN_PASSWORD_LEN = 6

export default function AuthDialog({ open, mode, onOpenChange, onModeChange }: AuthDialogProps) {
  const { login, register } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const isRegister = mode === 'register'

  // 每次打开弹窗或切换模式时重置表单与错误
  useEffect(() => {
    if (open) {
      setUsername('')
      setPassword('')
      setConfirmPassword('')
      setError(null)
    }
  }, [open, mode])

  /** 前端基础校验，返回错误文案；校验通过返回 null */
  const validate = (): string | null => {
    if (username.trim().length < MIN_USERNAME_LEN) return `用户名至少 ${MIN_USERNAME_LEN} 个字符`
    if (password.length < MIN_PASSWORD_LEN) return `密码至少 ${MIN_PASSWORD_LEN} 个字符`
    if (isRegister && password !== confirmPassword) return '两次输入的密码不一致'
    return null
  }

  const clearForm = () => {
    setUsername('')
    setPassword('')
    setConfirmPassword('')
    setError(null)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    const result = isRegister ? register(username, password) : login(username, password)
    if (result.ok) {
      clearForm()
      onOpenChange(false)
    } else {
      setError(result.error ?? '操作失败，请重试')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2">
            <Clapperboard className="h-5 w-5 text-gold" />
            <DialogTitle>{isRegister ? '注册账号' : '登录'}</DialogTitle>
          </div>
          <DialogDescription>
            {isRegister
              ? '注册即自动登录，账号仅保存在本机浏览器（演示版）。'
              : '登录后可收藏工具，组建你的剧组工具箱。'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="auth-username">用户名</Label>
            <Input
              id="auth-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={`至少 ${MIN_USERNAME_LEN} 个字符`}
              autoComplete="username"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="auth-password">密码</Label>
            <Input
              id="auth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`至少 ${MIN_PASSWORD_LEN} 个字符`}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
            />
          </div>

          {isRegister && (
            <div className="space-y-2">
              <Label htmlFor="auth-confirm-password">确认密码</Label>
              <Input
                id="auth-confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="请再次输入密码"
                autoComplete="new-password"
              />
            </div>
          )}

          {error && (
            <p className="flex items-start gap-1.5 text-sm text-crimson">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          )}

          <Button type="submit" className="w-full">
            {isRegister ? '注册并登录' : '登录'}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            {isRegister ? '已有账号？' : '没有账号？'}
            <button
              type="button"
              className="text-primary underline-offset-4 hover:underline"
              onClick={() => onModeChange(isRegister ? 'login' : 'register')}
            >
              {isRegister ? '去登录' : '去注册'}
            </button>
          </p>
        </form>
      </DialogContent>
    </Dialog>
  )
}
