import type { AgentTabInfo, ControlCommand } from '@shared/types'
import { useAppStore } from '@/store/app-store'

const AGENT_BADGE_MS = 4000
const badgeTimers = new Map<string, ReturnType<typeof setTimeout>>()

const envName = (envId: string): string =>
  useAppStore.getState().environments.find((e) => e.id === envId)?.name ?? '?'

/**
 * Account by id, or by name: the same name can exist in several environments, so an
 * environment (by name or id, or as "Ambiente/Account") narrows it down.
 */
function findAccount(account: string, environment?: string) {
  const { accounts, environments } = useAppStore.getState()
  const byId = accounts.find((a) => a.id === account)
  if (byId) return byId

  let name = account.trim()
  let envHint = environment?.trim()
  if (!envHint && name.includes('/')) [envHint, name] = name.split('/', 2).map((p) => p.trim())

  let candidates = accounts.filter((a) => a.name.toLowerCase() === name.toLowerCase())
  if (envHint) {
    const env = environments.find((e) => e.id === envHint || e.name.toLowerCase() === envHint!.toLowerCase())
    if (!env) throw new Error(`nessun ambiente "${envHint}": usa list_accounts`)
    candidates = candidates.filter((a) => a.envId === env.id)
  }
  if (candidates.length === 0) throw new Error(`nessun account "${account}": usa list_accounts`)
  if (candidates.length > 1) {
    const options = candidates.map((a) => `"${envName(a.envId)}/${a.name}"`).join(', ')
    throw new Error(`"${name}" esiste in più ambienti: specifica environment, oppure usa ${options}`)
  }
  return candidates[0]
}

function execute(command: ControlCommand): unknown {
  const state = useAppStore.getState()
  switch (command.cmd) {
    case 'list':
      return state.tabs.map((t): AgentTabInfo => {
        const account = state.accounts.find((a) => a.id === t.accountId)
        return {
          tabId: t.id,
          environment: state.environments.find((e) => e.id === account?.envId)?.name ?? '',
          accountId: t.accountId,
          accountName: account?.name ?? '',
        title: t.title,
        url: t.url,
        active: t.id === state.activeTabId,
          loading: state.runtime[t.id]?.loading ?? false
        }
      })
    case 'accounts':
      return state.accounts.map(({ id, name, url, envId }) => ({
        id,
        name,
        url,
        environment: state.environments.find((e) => e.id === envId)?.name ?? ''
      }))
    case 'open': {
      const { url, background } = command.args
      const match = findAccount(command.args.account, command.args.environment)
      return state.openTab(match.id, url, { background })
    }
    case 'select':
    case 'close': {
      const { tabId } = command.args
      if (!state.tabs.some((t) => t.id === tabId)) throw new Error(`nessuna scheda con id ${tabId}`)
      if (command.cmd === 'select') state.setActiveTab(tabId)
      else state.closeTab(tabId)
      return true
    }
  }
}

/** Answers the main process's tab commands and shows which tab the assistant is touching. */
export function startAgentControl(): () => void {
  const offCommand = window.api.onControlCommand((command) => {
    try {
      window.api.sendControlResult({ id: command.id, ok: true, value: execute(command) })
    } catch (err) {
      window.api.sendControlResult({
        id: command.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  })

  const offActivity = window.api.onAgentActivity((tabId) => {
    const { setRuntime } = useAppStore.getState()
    setRuntime(tabId, { agent: true })
    clearTimeout(badgeTimers.get(tabId))
    badgeTimers.set(
      tabId,
      setTimeout(() => {
        badgeTimers.delete(tabId)
        if (useAppStore.getState().tabs.some((t) => t.id === tabId)) setRuntime(tabId, { agent: false })
      }, AGENT_BADGE_MS)
    )
  })

  return () => {
    offCommand()
    offActivity()
  }
}
