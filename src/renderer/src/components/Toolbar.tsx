import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Bot, BotOff, Eraser, Moon, RotateCw, Sun, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { normalizeUrl } from '@/lib/url'
import { cn } from '@/lib/utils'
import { webviews } from '@/lib/webviews'
import { selectRuntime, useAppStore } from '@/store/app-store'

export const FOCUS_URL_EVENT = 'multisession:focus-url'

export function Toolbar({ onClearSession }: { onClearSession: (accountId: string) => void }) {
  const activeTabId = useAppStore((s) => s.activeTabId)
  const tab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const runtime = useAppStore(selectRuntime(activeTabId))
  const theme = useAppStore((s) => s.preferences.theme)
  const setTheme = useAppStore((s) => s.setTheme)
  const agentAccess = useAppStore((s) => s.preferences.agentAccess)
  const setAgentAccess = useAppStore((s) => s.setAgentAccess)

  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(tab?.url ?? '')
  }, [tab?.url, tab?.id, editing])

  useEffect(() => {
    const focus = (): void => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener(FOCUS_URL_EVENT, focus)
    return () => window.removeEventListener(FOCUS_URL_EVENT, focus)
  }, [])

  const webview = (): Electron.WebviewTag | undefined => webviews.get(activeTabId)

  const submit = (): void => {
    const url = normalizeUrl(draft)
    if (!url) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setEditing(false)
    inputRef.current?.blur()
    webview()?.loadURL(url)
  }

  const disabled = !tab

  return (
    <div className="relative flex h-12 shrink-0 items-center gap-1.5 bg-toolbar px-3">
      <Tooltip content="Indietro">
        <Button variant="subtle" size="icon" disabled={disabled || !runtime.canGoBack} onClick={() => webview()?.goBack()}>
          <ArrowLeft />
        </Button>
      </Tooltip>
      <Tooltip content="Avanti">
        <Button variant="subtle" size="icon" disabled={disabled || !runtime.canGoForward} onClick={() => webview()?.goForward()}>
          <ArrowRight />
        </Button>
      </Tooltip>
      <Tooltip content={runtime.loading ? 'Interrompi' : 'Ricarica'}>
        <Button
          variant="subtle"
          size="icon"
          disabled={disabled}
          onClick={() => (runtime.loading ? webview()?.stop() : webview()?.reload())}
        >
          {runtime.loading ? <X /> : <RotateCw />}
        </Button>
      </Tooltip>

      <form
        className="mx-1.5 flex-1"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <input
          ref={inputRef}
          value={draft}
          disabled={disabled}
          spellCheck={false}
          placeholder={disabled ? '' : 'Inserisci un indirizzo'}
          aria-invalid={invalid}
          onChange={(e) => {
            setDraft(e.target.value)
            setInvalid(false)
          }}
          onFocus={(e) => {
            setEditing(true)
            e.currentTarget.select()
          }}
          onBlur={() => {
            setEditing(false)
            setInvalid(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setDraft(tab?.url ?? '')
              e.currentTarget.blur()
            }
          }}
          className={cn(
            'h-8 w-full rounded-full border border-transparent bg-hover px-4 text-[13px] text-foreground transition-colors placeholder:text-muted-foreground',
            'hover:bg-active focus:border-accent focus:bg-surface focus:ring-2 focus:ring-ring',
            invalid && 'border-destructive focus:border-destructive'
          )}
        />
      </form>

      <Tooltip content="Svuota sessione">
        <Button variant="subtle" size="icon" disabled={disabled} onClick={() => tab && onClearSession(tab.accountId)}>
          <Eraser />
        </Button>
      </Tooltip>
      <Tooltip
        content={
          agentAccess
            ? 'Accesso assistente attivo: Claude può leggere e usare le schede. Clicca per disattivarlo'
            : 'Accesso assistente disattivato. Clicca per attivarlo'
        }
      >
        <Button variant="subtle" size="icon" aria-pressed={agentAccess} onClick={() => setAgentAccess(!agentAccess)}>
          {agentAccess ? <Bot /> : <BotOff />}
        </Button>
      </Tooltip>
      <Tooltip content={theme === 'dark' ? 'Tema chiaro' : 'Tema scuro'}>
        <Button variant="subtle" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? <Sun /> : <Moon />}
        </Button>
      </Tooltip>

      {runtime.loading && (
        <div className="pointer-events-none absolute inset-x-0 top-full h-0.5 overflow-hidden">
          <div className="h-full w-2/5 animate-indeterminate rounded-full bg-muted-foreground/40" />
        </div>
      )}
    </div>
  )
}
