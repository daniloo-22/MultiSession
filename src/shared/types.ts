/** A workspace grouping accounts and their tabs (e.g. "ChatGPT", "Scuola"). */
export interface Environment {
  id: string
  name: string
  color: string
}

export interface Account {
  id: string
  name: string
  url: string
  color: string
  envId: string
}

export interface SavedTab {
  id: string
  accountId: string
  url: string
  title: string
}

export interface SessionState {
  /** All tabs of every environment, in display order */
  tabs: SavedTab[]
  /** Index of the active tab in `tabs` (kept for older versions) */
  activeIndex: number
  activeEnvId?: string
  /** Last active tab of each environment, so switching back lands where you were */
  activeTabByEnv?: Record<string, string>
}

export type Theme = 'light' | 'dark'

export interface Preferences {
  theme: Theme
  /** Local MCP control server for AI assistants */
  agentAccess: boolean
}

export interface PersistedState {
  environments: Environment[]
  accounts: Account[]
  session: SessionState
  preferences: Preferences
}

export interface LoadedState {
  environments: Environment[]
  accounts: Account[]
  /** null when session-state.json does not exist yet */
  session: SessionState | null
  preferences: Preferences
}

export interface OpenTabRequest {
  /** webContents id of the guest that asked for the new window */
  sourceWebContentsId: number
  url: string
  /** ctrl/middle-click: open without switching to it */
  background: boolean
}

export type Shortcut =
  | 'next-tab'
  | 'prev-tab'
  | 'close-tab'
  | 'reload'
  | 'focus-url'
  | 'back'
  | 'forward'

export const IPC = {
  loadState: 'state:load',
  saveState: 'state:save',
  saveStateSync: 'state:save-sync',
  clearSession: 'session:clear',
  openTab: 'tab:open',
  shortcut: 'shortcut',
  bindTab: 'tab:bind',
  unbindTab: 'tab:unbind',
  controlCommand: 'control:command',
  controlResult: 'control:result',
  agentActivity: 'agent:activity',
  downloadDone: 'download:done',
  showInFolder: 'download:show'
} as const

export interface DownloadNotice {
  filename: string
  path: string
  state: 'completed' | 'cancelled' | 'interrupted' | 'progressing'
}

export const DEFAULT_PREFERENCES: Preferences = { theme: 'light', agentAccess: true }

export interface AgentTabInfo {
  tabId: string
  environment: string
  accountId: string
  accountName: string
  title: string
  url: string
  active: boolean
  loading: boolean
}

/** MCP-shaped content, passed through as-is by the bridge. */
export type AgentContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

export type ControlCommand =
  | { id: number; cmd: 'list' | 'accounts' }
  | {
      id: number
      cmd: 'open'
      args: { account: string; environment?: string; url?: string; background: boolean }
    }
  | { id: number; cmd: 'select' | 'close'; args: { tabId: string } }

export interface ControlResult {
  id: number
  ok: boolean
  value?: unknown
  error?: string
}

/** Written to userData while the control server runs; read by the MCP bridge. */
export interface AgentEndpoint {
  port: number
  token: string
  pid: number
}

export const AGENT_ENDPOINT_FILE = 'agent-endpoint.json'

export const DEFAULT_ENVIRONMENT: Environment = { id: 'principale', name: 'Principale', color: '#b9694e' }

export const partitionFor = (accountId: string): string => `persist:${accountId}`
