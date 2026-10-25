import { Layers, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { hostOf } from '@/lib/url'
import { useAppStore } from '@/store/app-store'
import { ColorDot } from './TabBar'

export function EmptyState({ onNewAccount }: { onNewAccount: () => void }) {
  const allAccounts = useAppStore((s) => s.accounts)
  const environment = useAppStore((s) => s.environments.find((e) => e.id === s.activeEnvId))
  const accounts = allAccounts.filter((a) => a.envId === environment?.id)
  const openTab = useAppStore((s) => s.openTab)

  return (
    <div className="flex h-full items-center justify-center p-10">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-hover">
          <Layers className="size-5 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-base font-medium">
            {accounts.length
              ? `Nessuna scheda aperta in “${environment?.name}”`
              : `Aggiungi il primo account a “${environment?.name}”`}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {accounts.length
              ? 'Riapri uno dei tuoi account, ognuno con la sua sessione.'
              : 'Ogni account vive in una sessione isolata: puoi tenere aperte più caselle dello stesso provider senza fare logout.'}
          </p>
        </div>

        {accounts.length > 0 && (
          <div className="flex w-full flex-col gap-1 rounded-lg border border-border bg-surface p-1.5">
            {accounts.map((a) => (
              <button
                key={a.id}
                onClick={() => openTab(a.id)}
                className="flex items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-hover"
              >
                <ColorDot color={a.color} className="size-2.5" />
                <span className="flex-1 truncate text-sm font-medium">{a.name}</span>
                <span className="truncate text-xs text-muted-foreground">{hostOf(a.url)}</span>
              </button>
            ))}
          </div>
        )}

        <Button variant={accounts.length ? 'outline' : 'default'} onClick={onNewAccount}>
          <UserPlus />
          Nuovo account
        </Button>
      </div>
    </div>
  )
}
