import { create } from 'zustand'
import {
  DEFAULT_ENVIRONMENT,
  DEFAULT_PREFERENCES,
  type Account,
  type Environment,
  type LoadedState,
  type PersistedState,
  type Preferences,
  type SavedTab,
  type Theme
} from '@shared/types'
import { newId } from '@/lib/utils'

export type Tab = SavedTab

/** Live per-tab state that is never persisted. */
export interface TabRuntime {
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error: { code: number; message: string; url: string } | null
  /** An AI assistant acted on this tab in the last few seconds */
  agent: boolean
}

const IDLE: TabRuntime = { loading: false, canGoBack: false, canGoForward: false, error: null, agent: false }

interface AppState {
  hydrated: boolean
  environments: Environment[]
  accounts: Account[]
  /** Tabs of every environment, in display order */
  tabs: Tab[]
  activeEnvId: string
  /** Active tab of the active environment (what the toolbar and content area show) */
  activeTabId: string | null
  /** Last active tab of each environment */
  activeTabByEnv: Record<string, string>
  preferences: Preferences
  runtime: Record<string, TabRuntime>

  hydrate: (loaded: LoadedState) => void

  addEnvironment: (data: Omit<Environment, 'id'>) => void
  updateEnvironment: (id: string, patch: Partial<Omit<Environment, 'id'>>) => void
  /** Removes the environment with its accounts and tabs; returns the removed account ids. */
  removeEnvironment: (id: string) => string[]
  switchEnvironment: (id: string) => void

  addAccount: (data: Omit<Account, 'id'>) => void
  updateAccount: (id: string, patch: Partial<Omit<Account, 'id'>>) => void
  removeAccount: (id: string) => void

  openTab: (
    accountId: string,
    url?: string,
    opts?: { background?: boolean; afterTabId?: string }
  ) => string | undefined
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  cycleTab: (direction: 1 | -1) => void
  moveTab: (fromId: string, toId: string) => void
  updateTab: (tabId: string, patch: Partial<Pick<Tab, 'url' | 'title'>>) => void

  setRuntime: (tabId: string, patch: Partial<TabRuntime>) => void
  setTheme: (theme: Theme) => void
  setAgentAccess: (enabled: boolean) => void
}

type Snapshot = Pick<AppState, 'environments' | 'accounts' | 'tabs' | 'activeEnvId' | 'activeTabByEnv'>

export const envOfTab = (s: Pick<AppState, 'accounts'>, tab: Tab | undefined): string | undefined =>
  tab && s.accounts.find((a) => a.id === tab.accountId)?.envId

export const tabsOfEnv = (s: Pick<AppState, 'accounts' | 'tabs'>, envId: string): Tab[] => {
  const ids = new Set(s.accounts.filter((a) => a.envId === envId).map((a) => a.id))
  return s.tabs.filter((t) => ids.has(t.accountId))
}

/**
 * The single place that derives which tab is shown: the remembered tab of the active
 * environment if it still exists, otherwise its first tab. Every action that changes
 * tabs, accounts or environments goes through it, so the two never drift apart.
 */
function resolveActive(s: Snapshot): Pick<AppState, 'activeEnvId' | 'activeTabId' | 'activeTabByEnv'> {
  const activeEnvId = s.environments.some((e) => e.id === s.activeEnvId)
    ? s.activeEnvId
    : s.environments[0]?.id ?? DEFAULT_ENVIRONMENT.id
  const activeTabByEnv: Record<string, string> = {}
  for (const env of s.environments) {
    const envTabs = tabsOfEnv(s, env.id)
    const remembered = s.activeTabByEnv[env.id]
    const tabId = envTabs.some((t) => t.id === remembered) ? remembered : envTabs[0]?.id
    if (tabId) activeTabByEnv[env.id] = tabId
  }
  return { activeEnvId, activeTabByEnv, activeTabId: activeTabByEnv[activeEnvId] ?? null }
}

export const useAppStore = create<AppState>()((set, get) => {
  /** Applies a change and re-derives the active environment/tab from the result. */
  const update = (change: (s: AppState) => Partial<AppState>): void =>
    set((s) => {
      const patch = change(s)
      return { ...patch, ...resolveActive({ ...s, ...patch }) }
    })

  return {
    hydrated: false,
    environments: [DEFAULT_ENVIRONMENT],
    accounts: [],
    tabs: [],
    activeEnvId: DEFAULT_ENVIRONMENT.id,
    activeTabId: null,
    activeTabByEnv: {},
    preferences: DEFAULT_PREFERENCES,
    runtime: {},

    hydrate: ({ environments, accounts, session, preferences }) => {
      // No session-state.json yet: one tab per configured account.
      const tabs: Tab[] = session
        ? session.tabs
        : accounts.map((a) => ({ id: newId(), accountId: a.id, url: a.url, title: a.name }))
      const legacyActive = tabs[session?.activeIndex ?? 0]
      const legacyEnv = envOfTab({ accounts }, legacyActive)
      const activeTabByEnv = { ...(session?.activeTabByEnv ?? {}) }
      if (legacyActive && legacyEnv && !activeTabByEnv[legacyEnv]) activeTabByEnv[legacyEnv] = legacyActive.id
      set({
        hydrated: true,
        preferences,
        environments,
        accounts,
        tabs,
        ...resolveActive({
          environments,
          accounts,
          tabs,
          activeEnvId: session?.activeEnvId ?? legacyEnv ?? environments[0].id,
          activeTabByEnv
        })
      })
    },

    addEnvironment: (data) => {
      const env: Environment = { ...data, id: newId() }
      update((s) => ({ environments: [...s.environments, env], activeEnvId: env.id }))
    },

    updateEnvironment: (id, patch) =>
      update((s) => ({ environments: s.environments.map((e) => (e.id === id ? { ...e, ...patch } : e)) })),

    removeEnvironment: (id) => {
      const { environments, accounts } = get()
      if (environments.length <= 1) return []
      const removed = accounts.filter((a) => a.envId === id).map((a) => a.id)
      update((s) => {
        const gone = new Set(removed)
        const runtime = { ...s.runtime }
        for (const t of s.tabs) if (gone.has(t.accountId)) delete runtime[t.id]
        return {
          environments: s.environments.filter((e) => e.id !== id),
          accounts: s.accounts.filter((a) => !gone.has(a.id)),
          tabs: s.tabs.filter((t) => !gone.has(t.accountId)),
          runtime
        }
      })
      return removed
    },

    switchEnvironment: (id) => update(() => ({ activeEnvId: id })),

    addAccount: (data) => {
      const account: Account = { ...data, id: newId() }
      update((s) => ({ accounts: [...s.accounts, account], activeEnvId: account.envId }))
      get().openTab(account.id)
    },

    updateAccount: (id, patch) =>
      update((s) => ({ accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),

    removeAccount: (id) =>
      update((s) => {
        const runtime = { ...s.runtime }
        for (const t of s.tabs) if (t.accountId === id) delete runtime[t.id]
        const tabs = s.tabs.filter((t) => t.accountId !== id)
        // Keep the shown tab close to where it was rather than jumping to the first one.
        const activeTabByEnv = { ...s.activeTabByEnv }
        if (s.activeTabId && !tabs.some((t) => t.id === s.activeTabId)) {
          const neighbour = neighbourAfterRemoval(tabsOfEnv(s, s.activeEnvId), s.activeTabId, tabs)
          if (neighbour) activeTabByEnv[s.activeEnvId] = neighbour
        }
        return { accounts: s.accounts.filter((a) => a.id !== id), tabs, runtime, activeTabByEnv }
      }),

    openTab: (accountId, url, opts = {}) => {
      const account = get().accounts.find((a) => a.id === accountId)
      if (!account) return
      const tab: Tab = { id: newId(), accountId, url: url ?? account.url, title: account.name }
      update((s) => {
        const tabs = [...s.tabs]
        const anchor = opts.afterTabId ? tabs.findIndex((t) => t.id === opts.afterTabId) : -1
        if (anchor >= 0) tabs.splice(anchor + 1, 0, tab)
        else tabs.push(tab)
        if (opts.background) return { tabs }
        return {
          tabs,
          activeEnvId: account.envId,
          activeTabByEnv: { ...s.activeTabByEnv, [account.envId]: tab.id }
        }
      })
      return tab.id
    },

    closeTab: (tabId) =>
      update((s) => {
        const runtime = { ...s.runtime }
        delete runtime[tabId]
        const tabs = s.tabs.filter((t) => t.id !== tabId)
        const envId = envOfTab(s, s.tabs.find((t) => t.id === tabId))
        const activeTabByEnv = { ...s.activeTabByEnv }
        if (envId && activeTabByEnv[envId] === tabId) {
          const neighbour = neighbourAfterRemoval(tabsOfEnv(s, envId), tabId, tabs)
          if (neighbour) activeTabByEnv[envId] = neighbour
          else delete activeTabByEnv[envId]
        }
        return { tabs, runtime, activeTabByEnv }
      }),

    // Selecting a tab of another environment (e.g. from the assistant) switches to it.
    setActiveTab: (tabId) =>
      update((s) => {
        const envId = envOfTab(s, s.tabs.find((t) => t.id === tabId))
        if (!envId) return {}
        return { activeEnvId: envId, activeTabByEnv: { ...s.activeTabByEnv, [envId]: tabId } }
      }),

    cycleTab: (direction) => {
      const s = get()
      const envTabs = tabsOfEnv(s, s.activeEnvId)
      if (envTabs.length < 2) return
      const i = envTabs.findIndex((t) => t.id === s.activeTabId)
      s.setActiveTab(envTabs[(i + direction + envTabs.length) % envTabs.length].id)
    },

    moveTab: (fromId, toId) =>
      set((s) => {
        const from = s.tabs.findIndex((t) => t.id === fromId)
        const to = s.tabs.findIndex((t) => t.id === toId)
        if (from < 0 || to < 0 || from === to) return {}
        const tabs = [...s.tabs]
        tabs.splice(to, 0, tabs.splice(from, 1)[0])
        return { tabs }
      }),

    updateTab: (tabId, patch) =>
      set((s) => {
        const current = s.tabs.find((t) => t.id === tabId)
        if (!current) return {}
        const changed = (Object.keys(patch) as (keyof typeof patch)[]).some(
          (k) => patch[k] !== undefined && patch[k] !== current[k]
        )
        if (!changed) return {}
        return { tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t)) }
      }),

    setRuntime: (tabId, patch) =>
      set((s) => ({ runtime: { ...s.runtime, [tabId]: { ...(s.runtime[tabId] ?? IDLE), ...patch } } })),

    setTheme: (theme) => set((s) => ({ preferences: { ...s.preferences, theme } })),
    setAgentAccess: (agentAccess) => set((s) => ({ preferences: { ...s.preferences, agentAccess } }))
  }
})

/** The tab that takes the place of a removed one: the next in line, or the previous. */
function neighbourAfterRemoval(before: Tab[], removedId: string, remaining: Tab[]): string | undefined {
  const alive = new Set(remaining.map((t) => t.id))
  const index = before.findIndex((t) => t.id === removedId)
  const after = before.slice(index + 1).find((t) => alive.has(t.id))
  const prior = before.slice(0, Math.max(index, 0)).reverse().find((t) => alive.has(t.id))
  return (after ?? prior)?.id
}

export const selectRuntime = (tabId: string | null) => (s: AppState): TabRuntime =>
  (tabId && s.runtime[tabId]) || IDLE

export function snapshot(): PersistedState {
  const { environments, accounts, tabs, activeTabId, activeEnvId, activeTabByEnv, preferences } =
    useAppStore.getState()
  return {
    environments,
    accounts,
    preferences,
    session: {
      tabs: tabs.map(({ id, accountId, url, title }) => ({ id, accountId, url, title })),
      activeIndex: Math.max(0, tabs.findIndex((t) => t.id === activeTabId)),
      activeEnvId,
      activeTabByEnv
    }
  }
}

/**
 * Debounced autosave: any change to environments, accounts, tabs (url, title, order),
 * active tab or preferences is written within a moment, so a crash doesn't lose the session.
 */
export function startAutosave(delay = 400): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = (): void => {
    clearTimeout(timer)
    timer = undefined
    window.api.saveState(snapshot())
  }

  const unsubscribe = useAppStore.subscribe((s, prev) => {
    if (!s.hydrated) return
    if (
      s.environments === prev.environments &&
      s.accounts === prev.accounts &&
      s.tabs === prev.tabs &&
      s.activeTabId === prev.activeTabId &&
      s.activeEnvId === prev.activeEnvId &&
      s.preferences === prev.preferences
    ) {
      return
    }
    clearTimeout(timer)
    timer = setTimeout(flush, delay)
  })

  const onUnload = (): void => {
    clearTimeout(timer)
    if (useAppStore.getState().hydrated) window.api.saveStateSync(snapshot())
  }
  window.addEventListener('beforeunload', onUnload)

  return () => {
    unsubscribe()
    clearTimeout(timer)
    window.removeEventListener('beforeunload', onUnload)
  }
}
