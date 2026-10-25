import { useEffect, useState } from 'react'
import type { Account } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ACCOUNT_COLORS, pickColor } from '@/lib/colors'
import { normalizeUrl } from '@/lib/url'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { ColorPicker } from './ColorPicker'
import { ColorDot } from './TabBar'

/** `account` undefined = create mode, in the active environment. */
export function AccountDialog({
  open,
  account,
  onOpenChange
}: {
  open: boolean
  account?: Account
  onOpenChange: (open: boolean) => void
}) {
  const accounts = useAppStore((s) => s.accounts)
  const environments = useAppStore((s) => s.environments)
  const activeEnvId = useAppStore((s) => s.activeEnvId)
  const addAccount = useAppStore((s) => s.addAccount)
  const updateAccount = useAppStore((s) => s.updateAccount)

  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [color, setColor] = useState<string>(ACCOUNT_COLORS[0])
  const [envId, setEnvId] = useState(activeEnvId)
  const [urlError, setUrlError] = useState(false)

  useEffect(() => {
    if (!open) return
    const targetEnv = account?.envId ?? activeEnvId
    setName(account?.name ?? '')
    setUrl(account?.url ?? '')
    setEnvId(targetEnv)
    setColor(account?.color ?? pickColor(accounts.filter((a) => a.envId === targetEnv).map((a) => a.color)))
    setUrlError(false)
    // Reset only when the dialog opens, not on every accounts change.
  }, [open, account?.id])

  const submit = (): void => {
    const normalized = normalizeUrl(url)
    if (!normalized) {
      setUrlError(true)
      return
    }
    const data = { name: name.trim() || new URL(normalized).hostname, url: normalized, color, envId }
    if (account) updateAccount(account.id, data)
    else addAccount(data)
    onOpenChange(false)
  }

  const moving = account && envId !== account.envId

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{account ? 'Modifica account' : 'Nuovo account'}</DialogTitle>
          <DialogDescription>
            {account
              ? "L'indirizzo di partenza vale per le nuove schede: quelle aperte restano dove sono."
              : 'Ogni account ha cookie, login e dati separati da tutti gli altri.'}
          </DialogDescription>
        </DialogHeader>

        <form
          id="account-form"
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="account-name">Nome</Label>
            <Input
              id="account-name"
              autoFocus
              value={name}
              placeholder="Es. Lavoro"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="account-url">Indirizzo</Label>
            <Input
              id="account-url"
              value={url}
              placeholder="mail.esempio.it"
              aria-invalid={urlError}
              onChange={(e) => {
                setUrl(e.target.value)
                setUrlError(false)
              }}
            />
            {urlError && <p className="text-xs text-destructive">Inserisci un indirizzo web valido.</p>}
          </div>
          {environments.length > 1 && (
            <div className="grid gap-2.5">
              <Label>Ambiente</Label>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Ambiente">
                {environments.map((env) => (
                  <button
                    key={env.id}
                    type="button"
                    role="radio"
                    aria-checked={env.id === envId}
                    onClick={() => setEnvId(env.id)}
                    className={cn(
                      'flex h-8 items-center gap-2 rounded-full border px-3 text-[13px] transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                      env.id === envId
                        ? 'border-accent/50 bg-surface font-medium text-foreground'
                        : 'border-border text-muted-foreground hover:bg-hover hover:text-foreground'
                    )}
                  >
                    <ColorDot color={env.color} />
                    {env.name}
                  </button>
                ))}
              </div>
              {moving && (
                <p className="text-xs text-muted-foreground">
                  L'account e le sue schede passano all'altro ambiente; login e dati restano.
                </p>
              )}
            </div>
          )}
          <div className="grid gap-2.5">
            <Label>Colore</Label>
            <ColorPicker value={color} onChange={setColor} />
          </div>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annulla
          </Button>
          <Button type="submit" form="account-form">
            {account ? 'Salva' : 'Aggiungi'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
