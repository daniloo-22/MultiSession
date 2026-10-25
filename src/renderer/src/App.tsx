import { useEffect, useMemo, useState } from 'react'
import type { Shortcut } from '@shared/types'
import { AccountDialog } from '@/components/AccountDialog'
import { AccountsManager } from '@/components/AccountsManager'
import { DownloadToasts } from '@/components/DownloadToasts'
import { EnvironmentDialog } from '@/components/EnvironmentDialog'
import { EmptyState } from '@/components/EmptyState'
import { TabBar } from '@/components/TabBar'
import { FOCUS_URL_EVENT, Toolbar } from '@/components/Toolbar'
import { WebviewPane } from '@/components/WebviewPane'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { startAgentControl } from '@/lib/agent-control'
import { webviews } from '@/lib/webviews'
import { startAutosave, useAppStore } from '@/store/app-store'

type Confirm =
  | { kind: 'clear' | 'delete'; accountId: string }
  | { kind: 'delete-env'; envId: string }
  | null
type AccountForm = { accountId?: string } | null
type EnvironmentForm = { envId?: string } | null

export function App() {
  const hydrated = useAppStore((s) => s.hydrated)
  const tabs = useAppStore((s) => s.tabs)
  const accounts = useAppStore((s) => s.accounts)
  const environments = useAppStore((s) => s.environments)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const theme = useAppStore((s) => s.preferences.theme)

  const [accountForm, setAccountForm] = useState<AccountForm>(null)
  const [environmentForm, setEnvironmentForm] = useState<EnvironmentForm>(null)
  const [managerOpen, setManagerOpen] = useState(false)
  const [confirm, setConfirm] = useState<Confirm>(null)

  useEffect(() => {
    let stopAutosave: (() => void) | undefined
    window.api.loadState().then((loaded) => {
      useAppStore.getState().hydrate(loaded)
      stopAutosave = startAutosave()
    })
    return () => stopAutosave?.()
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  useEffect(() => {
    const offOpenTab = window.api.onOpenTab(({ sourceWebContentsId, url, background }) => {
      const { tabs, openTab } = useAppStore.getState()
      const source = tabs.find((t) => t.id === webviews.tabForContents(sourceWebContentsId))
      if (source) openTab(source.accountId, url, { afterTabId: source.id, background })
    })

    const offShortcut = window.api.onShortcut((shortcut: Shortcut) => {
      const { activeTabId, closeTab, cycleTab } = useAppStore.getState()
      const webview = webviews.get(activeTabId)
      switch (shortcut) {
        case 'next-tab':
          return cycleTab(1)
        case 'prev-tab':
          return cycleTab(-1)
        case 'close-tab':
          return activeTabId && closeTab(activeTabId)
        case 'reload':
          return webview?.reload()
        case 'back':
          return webview?.canGoBack() && webview.goBack()
        case 'forward':
          return webview?.canGoForward() && webview.goForward()
        case 'focus-url':
          return window.dispatchEvent(new Event(FOCUS_URL_EVENT))
      }
    })

    const stopAgentControl = startAgentControl()

    return () => {
      offOpenTab()
      offShortcut()
      stopAgentControl()
    }
  }, [])

  // Panes render in a fixed order (by id) independent of the tab order: reordering tabs
  // must never move a <webview> in the DOM, or it would reload.
  const panes = useMemo(() => [...tabs].sort((a, b) => (a.id < b.id ? -1 : 1)), [tabs])

  const editingAccount = accounts.find((a) => a.id === accountForm?.accountId)
  const editingEnvironment = environments.find((e) => e.id === environmentForm?.envId)

  const runConfirm = async (): Promise<void> => {
    if (!confirm) return
    const store = useAppStore.getState()
    if (confirm.kind === 'delete-env') {
      // Its accounts go with it, sessions (cookies, logins) included.
      for (const accountId of store.removeEnvironment(confirm.envId)) await window.api.clearSession(accountId)
      return
    }
    const { accountId } = confirm
    if (confirm.kind === 'delete') {
      store.removeAccount(accountId)
      await window.api.clearSession(accountId)
      return
    }
    await window.api.clearSession(accountId)
    const startUrl = store.accounts.find((a) => a.id === accountId)?.url
    for (const tab of store.tabs) {
      if (tab.accountId === accountId && startUrl) webviews.get(tab.id)?.loadURL(startUrl)
    }
  }

  const confirmText = ((): { title: string; body: string; action: string } | null => {
    if (!confirm) return null
    if (confirm.kind === 'delete-env') {
      const env = environments.find((e) => e.id === confirm.envId)
      const count = accounts.filter((a) => a.envId === confirm.envId).length
      return {
        title: `Eliminare l'ambiente “${env?.name}”?`,
        body:
          count > 0
            ? `Verrà eliminato anche ${count === 1 ? 'il suo account' : `i suoi ${count} account`}, con schede, cookie, login e dati salvati. L'operazione non si può annullare.`
            : "L'ambiente è vuoto. L'operazione non si può annullare.",
        action: 'Elimina ambiente'
      }
    }
    const name = accounts.find((a) => a.id === confirm.accountId)?.name
    return confirm.kind === 'delete'
      ? {
          title: `Eliminare “${name}”?`,
          body: "Le schede dell'account verranno chiuse e cookie, login e dati salvati cancellati. L'operazione non si può annullare.",
          action: 'Elimina'
        }
      : {
          title: `Svuotare la sessione di “${name}”?`,
          body: "Cookie, localStorage, IndexedDB e cache di questo account verranno cancellati: dovrai rifare l'accesso. Le schede restano aperte.",
          action: 'Svuota sessione'
        }
  })()

  if (!hydrated) return <div className="h-full bg-background" />

  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={200}>
      <div className="flex h-full flex-col">
        <TabBar
          onNewEnvironment={() => setEnvironmentForm({})}
          onEditEnvironment={(envId) => setEnvironmentForm({ envId })}
          onDeleteEnvironment={(envId) => setConfirm({ kind: 'delete-env', envId })}
          onNewAccount={() => setAccountForm({})}
          onManageAccounts={() => setManagerOpen(true)}
          onEditAccount={(accountId) => setAccountForm({ accountId })}
          onDeleteAccount={(accountId) => setConfirm({ kind: 'delete', accountId })}
          onClearSession={(accountId) => setConfirm({ kind: 'clear', accountId })}
        />
        <Toolbar onClearSession={(accountId) => setConfirm({ kind: 'clear', accountId })} />

        <main className="relative min-h-0 flex-1 bg-background">
          {panes.map((tab) => (
            <WebviewPane key={tab.id} tab={tab} active={tab.id === activeTabId} />
          ))}
          {/* Tabs of other environments stay mounted underneath: cover them. */}
          {activeTabId === null && (
            <div className="absolute inset-0 z-20 bg-background">
              <EmptyState onNewAccount={() => setAccountForm({})} />
            </div>
          )}
        </main>
      </div>

      <DownloadToasts />

      <AccountDialog
        open={accountForm !== null}
        account={editingAccount}
        onOpenChange={(open) => !open && setAccountForm(null)}
      />

      <EnvironmentDialog
        open={environmentForm !== null}
        environment={editingEnvironment}
        onOpenChange={(open) => !open && setEnvironmentForm(null)}
      />

      <AccountsManager
        open={managerOpen}
        onOpenChange={setManagerOpen}
        onNew={() => setAccountForm({})}
        onEdit={(accountId) => setAccountForm({ accountId })}
        onDelete={(accountId) => setConfirm({ kind: 'delete', accountId })}
      />

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmText?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmText?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction destructive onClick={() => void runConfirm()}>
              {confirmText?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  )
}
