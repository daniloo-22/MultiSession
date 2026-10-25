import { app } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_ENVIRONMENT,
  DEFAULT_PREFERENCES,
  type Account,
  type Environment,
  type LoadedState,
  type PersistedState,
  type Preferences,
  type SessionState
} from '@shared/types'

const file = (name: string): string => join(app.getPath('userData'), name)

export const FILES = {
  environments: () => file('environments.json'),
  accounts: () => file('accounts.json'),
  session: () => file('session-state.json'),
  preferences: () => file('preferences.json'),
  window: () => file('window-state.json')
}

export function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch (err) {
    console.error(`[storage] file illeggibile, ignorato: ${path}`, err)
    return null
  }
}

// Write to a temp file and rename: a kill mid-write never leaves a truncated JSON behind.
export function writeJson(path: string, data: unknown): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, path)
}

const isHttpUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function sanitizeEnvironments(raw: unknown): Environment[] {
  const list = Array.isArray(raw)
    ? raw.filter(
        (e): e is Environment =>
          e && typeof e.id === 'string' && typeof e.name === 'string' && typeof e.color === 'string'
      )
    : []
  return list.length ? list : [DEFAULT_ENVIRONMENT]
}

// Accounts from before environments existed (or pointing at a deleted one) land in the first.
function sanitizeAccounts(raw: unknown, environments: Environment[]): Account[] {
  if (!Array.isArray(raw)) return []
  const known = new Set(environments.map((e) => e.id))
  return raw
    .filter(
      (a): a is Account =>
        a &&
        typeof a.id === 'string' &&
        typeof a.name === 'string' &&
        typeof a.color === 'string' &&
        isHttpUrl(a.url)
    )
    .map((a) => (known.has(a.envId) ? a : { ...a, envId: environments[0].id }))
}

function sanitizeSession(raw: SessionState | null, accounts: Account[]): SessionState | null {
  if (!raw || !Array.isArray(raw.tabs)) return null
  const known = new Set(accounts.map((a) => a.id))
  const tabs = raw.tabs.filter(
    (t) => t && typeof t.id === 'string' && known.has(t.accountId) && isHttpUrl(t.url)
  )
  const activeIndex = Math.min(Math.max(0, Number(raw.activeIndex) || 0), Math.max(0, tabs.length - 1))
  const tabIds = new Set(tabs.map((t) => t.id))
  const activeTabByEnv = Object.fromEntries(
    Object.entries(raw.activeTabByEnv ?? {}).filter(([, tabId]) => tabIds.has(tabId))
  )
  return {
    tabs: tabs.map((t) => ({ ...t, title: String(t.title ?? '') })),
    activeIndex,
    activeEnvId: typeof raw.activeEnvId === 'string' ? raw.activeEnvId : undefined,
    activeTabByEnv
  }
}

export function loadState(): LoadedState {
  const environments = sanitizeEnvironments(readJson(FILES.environments()))
  const accounts = sanitizeAccounts(readJson(FILES.accounts()), environments)
  const session = sanitizeSession(readJson<SessionState>(FILES.session()), accounts)
  const preferences: Preferences = {
    ...DEFAULT_PREFERENCES,
    ...(readJson<Partial<Preferences>>(FILES.preferences()) ?? {})
  }
  return { environments, accounts, session, preferences }
}

export function saveState(state: PersistedState): void {
  const environments = sanitizeEnvironments(state.environments)
  const accounts = sanitizeAccounts(state.accounts, environments)
  const session = sanitizeSession(state.session, accounts) ?? { tabs: [], activeIndex: 0 }
  writeJson(FILES.environments(), environments)
  writeJson(FILES.accounts(), accounts)
  writeJson(FILES.session(), session)
  writeJson(FILES.preferences(), state.preferences)
}
