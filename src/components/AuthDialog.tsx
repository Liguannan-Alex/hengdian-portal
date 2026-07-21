import { useRef, useState } from 'react'
import { CheckCircle2, CircleAlert, Clapperboard, HardDrive } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth, validateProfileName } from '@/lib/auth'

/** 仅为兼容 Layout 既有调用保留；本机档案不再区分登录与注册。 */
export type AuthMode = 'login' | 'register'

export interface AuthDialogProps {
  open: boolean
  mode: AuthMode
  onOpenChange: (open: boolean) => void
  onModeChange: (mode: AuthMode) => void
}

interface ProfileDialogBodyProps {
  onDone: () => void
}

function ProfileDialogBody({ onDone }: ProfileDialogBodyProps) {
  const { profile, saveProfile, pendingFavoriteId, storageAvailable, storageNotice } = useAuth()
  const [name, setName] = useState(() => profile?.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  const focusInvalidField = () => nameInputRef.current?.focus()

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const validationError = validateProfileName(name)
    if (validationError) {
      setError(validationError)
      focusInvalidField()
      return
    }

    const result = saveProfile(name)
    if (!result.ok) {
      setError(result.error ?? '档案保存失败，请重试')
      focusInvalidField()
      return
    }

    setError(null)
    setSuccess(result.message ?? '本机档案已保存。')
  }

  return (
    <>
      <DialogHeader>
        <div className="mb-1 flex items-center gap-2">
          <Clapperboard className="h-5 w-5 text-gold" />
          <DialogTitle>本机档案</DialogTitle>
        </div>
        <DialogDescription>
          {profile
            ? '修改本机显示名称；无需密码，不会创建网络账号。'
            : pendingFavoriteId !== null
              ? '填写名称后，刚才选择的工具会自动加入本机工具箱。'
              : '填写一个显示名称即可建立本机工具箱；无需密码。'}
        </DialogDescription>
      </DialogHeader>

      {storageNotice && (
        <div
          className="flex items-start gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
          role={storageAvailable ? 'status' : 'alert'}
          aria-live="polite"
        >
          <HardDrive className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{storageNotice}</span>
        </div>
      )}

      {success ? (
        <div className="space-y-4">
          <p
            className="flex items-start gap-2 rounded-md bg-accent px-3 py-3 text-sm text-accent-foreground"
            role="status"
            aria-live="polite"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span>{success}</span>
          </p>
          <Button
            type="button"
            className="w-full shadow-[0_0_20px_-6px_hsl(var(--gold)/0.5)]"
            onClick={onDone}
            autoFocus
          >
            完成
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="local-profile-name">名称</Label>
            <Input
              ref={nameInputRef}
              id="local-profile-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                if (error) setError(null)
              }}
              placeholder="2–20 个字符"
              autoComplete="name"
              maxLength={20}
              autoFocus
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'local-profile-name-hint local-profile-name-error' : 'local-profile-name-hint'}
            />
            <p id="local-profile-name-hint" className="text-xs text-muted-foreground">
              名称仅用于这台设备上的显示，可随时修改。
            </p>
          </div>

          {error && (
            <p
              id="local-profile-name-error"
              className="flex items-start gap-1.5 text-sm text-red-300"
              role="alert"
              aria-live="assertive"
            >
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </p>
          )}

          <Button type="submit" className="w-full shadow-[0_0_20px_-6px_hsl(var(--gold)/0.5)]">
            保存本机档案
          </Button>
        </form>
      )}
    </>
  )
}

export default function AuthDialog({ open, onOpenChange }: AuthDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-paper/10 shadow-2xl shadow-black/60 sm:max-w-sm">
        {open ? <ProfileDialogBody onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}
