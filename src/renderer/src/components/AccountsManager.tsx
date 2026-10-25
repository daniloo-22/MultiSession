import { Pencil, Plus, SquareArrowOutUpRight, Trash2, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Tooltip } from '@/components/ui/tooltip'
import { hostOf } from '@/lib/url'
import { useAppStore } from '@/store/app-store'
import { ColorDot } from './TabBar'

export function AccountsManager({
  open,
  onOpenChange,
  onNew,
  onEdit,
  onDelete
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNew: () => void
  onEdit: (accountId: string) => void
  onDelete: (accountId: string) => void
}) {
  const allAccounts = useAppStore((s) => s.accounts)
  const tabs = useAppStore((s) => s.tabs)
  const environment = useAppStore((s) => s.environments.find((e) => e.id === s.activeEnvId))
  const accounts = allAccounts.filter((a) => a.envId === environment?.id)
  const openTab = useAppStore((s) => s.openTab)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* No autofocus: focusing the first icon button would pop its tooltip on open. */}
      <DialogContent className="sm:max-w-lg" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Account
            {environment && (
              <span className="flex items-center gap-1.5 text-sm font-normal text-muted-foreground">
                · <ColorDot color={environment.color} /> {environment.name}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            Gli account di questo ambiente. Ognuno ha una sessione separata e persistente; per spostarne uno in un altro
            ambiente usa Modifica.
          </DialogDescription>
        </DialogHeader>

        {accounts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            Nessun account in questo ambiente.
          </p>
        ) : (
          <ul className="-mx-2 flex max-h-[50vh] flex-col gap-0.5 overflow-y-auto">
            {accounts.map((a) => {
              const openCount = tabs.filter((t) => t.accountId === a.id).length
              return (
                <li key={a.id} className="group flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-hover">
                  <ColorDot color={a.color} className="size-2.5" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{a.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {hostOf(a.url)}
                      {openCount > 0 && ` · ${openCount} ${openCount === 1 ? 'scheda' : 'schede'}`}
                    </span>
                  </div>
                  <Tooltip content="Apri in una nuova scheda">
                    <Button
                      variant="subtle"
                      size="icon-sm"
                      onClick={() => {
                        openTab(a.id)
                        onOpenChange(false)
                      }}
                    >
                      <SquareArrowOutUpRight />
                    </Button>
                  </Tooltip>
                  <Tooltip content="Modifica">
                    <Button variant="subtle" size="icon-sm" onClick={() => onEdit(a.id)}>
                      <Pencil />
                    </Button>
                  </Tooltip>
                  <Tooltip content="Elimina">
                    <Button variant="subtle" size="icon-sm" onClick={() => onDelete(a.id)}>
                      <Trash2 />
                    </Button>
                  </Tooltip>
                </li>
              )
            })}
          </ul>
        )}

        <DialogFooter>
          <Button onClick={onNew}>
            {accounts.length === 0 ? <UserPlus /> : <Plus />}
            Nuovo account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
