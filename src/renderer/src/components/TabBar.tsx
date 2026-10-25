import { useMemo, useState } from 'react'
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import { restrictToHorizontalAxis, restrictToParentElement } from '@dnd-kit/modifiers'
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Bot,
  Check,
  ChevronsUpDown,
  CopyPlus,
  FolderPlus,
  Eraser,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
  Users,
  X
} from 'lucide-react'
import type { Account } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip } from '@/components/ui/tooltip'
import { hostOf } from '@/lib/url'
import { cn } from '@/lib/utils'
import { tabsOfEnv, useAppStore, type Tab } from '@/store/app-store'

export interface TabActions {
  onNewEnvironment: () => void
  onEditEnvironment: (envId: string) => void
  onDeleteEnvironment: (envId: string) => void
  onNewAccount: () => void
  onManageAccounts: () => void
  onEditAccount: (accountId: string) => void
  onDeleteAccount: (accountId: string) => void
  onClearSession: (accountId: string) => void
}

export function TabBar(actions: TabActions) {
  const allTabs = useAppStore((s) => s.tabs)
  const allAccounts = useAppStore((s) => s.accounts)
  const activeEnvId = useAppStore((s) => s.activeEnvId)
  // The bar only shows the active environment: its accounts and its tabs.
  const accounts = useMemo(() => allAccounts.filter((a) => a.envId === activeEnvId), [allAccounts, activeEnvId])
  const tabs = useMemo(
    () => tabsOfEnv({ accounts: allAccounts, tabs: allTabs }, activeEnvId),
    [allAccounts, allTabs, activeEnvId]
  )
  const moveTab = useAppStore((s) => s.moveTab)
  const openTab = useAppStore((s) => s.openTab)

  // A small distance threshold keeps plain clicks working as clicks.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    if (over && active.id !== over.id) moveTab(String(active.id), String(over.id))
  }

  const seen = new Set<string>()
  const labelled = tabs.map((tab) => {
    const account = accounts.find((a) => a.id === tab.accountId)
    // The first tab of an account carries its name; extra tabs (popups, links) show the page.
    const primary = !seen.has(tab.accountId)
    seen.add(tab.accountId)
    return { tab, account, label: primary ? account?.name : tab.title || hostOf(tab.url) }
  })

  return (
    <div
      className={cn(
        'titlebar flex h-12 shrink-0 items-center gap-2 bg-chrome pr-2',
        window.api.platform === 'darwin' ? 'pl-20' : 'pl-3'
      )}
      // Window Controls Overlay: leave room for the native window buttons on the right.
      style={{ paddingRight: 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 8px)' }}
    >
      <EnvironmentSwitcher actions={actions} />
      <span aria-hidden className="h-5 w-px shrink-0 bg-border" />

      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1 [scrollbar-width:none]">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToHorizontalAxis, restrictToParentElement]}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
            {labelled.map(({ tab, account, label }) =>
              account ? (
                <TabPill key={tab.id} tab={tab} account={account} label={label ?? ''} actions={actions} />
              ) : null
            )}
          </SortableContext>
        </DndContext>

        <DropdownMenu>
          <Tooltip content="Nuova scheda">
            <DropdownMenuTrigger asChild>
              <Button variant="subtle" size="icon-sm" className="ml-1 rounded-full">
                <Plus />
              </Button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="start">
            {accounts.length > 0 && (
              <>
                <DropdownMenuLabel>Apri una scheda per</DropdownMenuLabel>
                {accounts.map((a) => (
                  <DropdownMenuItem key={a.id} onSelect={() => openTab(a.id)}>
                    <ColorDot color={a.color} />
                    <span className="truncate">{a.name}</span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onSelect={actions.onNewAccount}>
              <UserPlus />
              Nuovo account…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Tooltip content="Gestisci account">
        <Button variant="subtle" size="icon" onClick={actions.onManageAccounts}>
          <Users />
        </Button>
      </Tooltip>
    </div>
  )
}

function EnvironmentSwitcher({ actions }: { actions: TabActions }) {
  const environments = useAppStore((s) => s.environments)
  const accounts = useAppStore((s) => s.accounts)
  const activeEnvId = useAppStore((s) => s.activeEnvId)
  const switchEnvironment = useAppStore((s) => s.switchEnvironment)
  const active = environments.find((e) => e.id === activeEnvId) ?? environments[0]

  return (
    <DropdownMenu>
      <Tooltip content="Cambia ambiente">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-8 max-w-48 shrink-0 items-center gap-2 rounded-full pr-2 pl-3 text-[13px] font-medium text-foreground transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-hover"
          >
            <ColorDot color={active.color} />
            <span className="truncate">{active.name}</span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="start" className="min-w-60">
        <DropdownMenuLabel>Ambienti</DropdownMenuLabel>
        {environments.map((env) => {
          const count = accounts.filter((a) => a.envId === env.id).length
          return (
            <DropdownMenuItem key={env.id} onSelect={() => switchEnvironment(env.id)}>
              <ColorDot color={env.color} />
              <span className="flex-1 truncate">{env.name}</span>
              <span className="text-xs text-muted-foreground">{count === 1 ? '1 account' : `${count} account`}</span>
              <Check className={cn('size-4', env.id === active.id ? 'opacity-100' : 'opacity-0')} />
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={actions.onNewEnvironment}>
          <FolderPlus />
          Nuovo ambiente…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.onEditEnvironment(active.id)}>
          <Pencil />
          Modifica “{active.name}”…
        </DropdownMenuItem>
        <DropdownMenuItem
          destructive
          disabled={environments.length <= 1}
          onSelect={() => actions.onDeleteEnvironment(active.id)}
        >
          <Trash2 />
          Elimina “{active.name}”…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TabPill({
  tab,
  account,
  label,
  actions
}: {
  tab: Tab
  account: Account
  label: string
  actions: TabActions
}) {
  const active = useAppStore((s) => s.activeTabId === tab.id)
  const loading = useAppStore((s) => s.runtime[tab.id]?.loading ?? false)
  const failed = useAppStore((s) => Boolean(s.runtime[tab.id]?.error))
  const agent = useAppStore((s) => s.runtime[tab.id]?.agent ?? false)
  const { setActiveTab, closeTab, openTab } = useAppStore.getState()
  const [menuOpen, setMenuOpen] = useState(false)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('relative shrink-0', isDragging && 'z-10')}
    >
      <Tooltip
        delayDuration={700}
        content={
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">{account.name}</span>
            {tab.title && tab.title !== account.name && <span>{tab.title}</span>}
            <span className="text-muted-foreground">{hostOf(tab.url)}</span>
          </div>
        }
      >
        <div
          {...attributes}
          {...listeners}
          role="tab"
          aria-selected={active}
          onClick={() => setActiveTab(tab.id)}
          onAuxClick={(e) => e.button === 1 && closeTab(tab.id)}
          onContextMenu={(e) => {
            e.preventDefault()
            setMenuOpen(true)
          }}
          className={cn(
            'group flex h-8 w-44 cursor-default items-center gap-2 rounded-full pr-1.5 pl-3 text-[13px] transition-colors',
            active
              ? 'bg-surface text-foreground ring-1 ring-accent/45'
              : 'text-muted-foreground hover:bg-hover hover:text-foreground',
            isDragging && 'opacity-80'
          )}
        >
          {agent ? (
            <Bot className="size-3.5 shrink-0 text-accent" aria-label="Assistente al lavoro" />
          ) : loading ? (
            <Loader2 className="size-3 shrink-0 animate-spin" style={{ color: account.color }} />
          ) : (
            <ColorDot color={account.color} />
          )}
          <span className={cn('min-w-0 flex-1 truncate', active && 'font-medium', failed && 'opacity-60')}>
            {label}
          </span>
          <button
            type="button"
            aria-label="Chiudi scheda"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              closeTab(tab.id)
            }}
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-active hover:text-foreground',
              active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            )}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </Tooltip>

      {/* Context menu: a zero-size trigger anchored under the pill, opened on right-click. */}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <span aria-hidden className="pointer-events-none absolute bottom-0 left-3 size-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel className="flex items-center gap-2">
            <ColorDot color={account.color} />
            <span className="truncate">{account.name}</span>
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => openTab(account.id, tab.url, { afterTabId: tab.id })}>
            <CopyPlus />
            Duplica scheda
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => actions.onEditAccount(account.id)}>
            <Pencil />
            Modifica account…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => actions.onClearSession(account.id)}>
            <Eraser />
            Svuota sessione…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => closeTab(tab.id)}>
            <X />
            Chiudi scheda
          </DropdownMenuItem>
          <DropdownMenuItem destructive onSelect={() => actions.onDeleteAccount(account.id)}>
            <Trash2 />
            Elimina account…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function ColorDot({ color, className }: { color: string; className?: string }) {
  return <span className={cn('size-2 shrink-0 rounded-full', className)} style={{ backgroundColor: color }} />
}
