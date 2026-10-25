import { useEffect, useRef } from 'react'
import type { WebviewTag } from 'electron'
import { RotateCw, TriangleAlert } from 'lucide-react'
import { partitionFor } from '@shared/types'
import { Button } from '@/components/ui/button'
import { describeLoadError } from '@/lib/load-errors'
import { cn } from '@/lib/utils'
import { webviews } from '@/lib/webviews'
import { selectRuntime, useAppStore, type Tab } from '@/store/app-store'

const ERR_ABORTED = -3

export function WebviewPane({ tab, active }: { tab: Tab; active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const error = useAppStore((s) => selectRuntime(tab.id)(s).error)

  // <webview> isn't a React component: it is created imperatively so that `partition`
  // is set before `src` (it can't change after the first navigation) and React never
  // touches it again. Moving or re-creating the node would reload the page.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const { updateTab, setRuntime } = useAppStore.getState()
    const initialUrl = useAppStore.getState().tabs.find((t) => t.id === tab.id)?.url ?? tab.url

    const el = document.createElement('webview') as WebviewTag
    el.setAttribute('partition', partitionFor(tab.accountId))
    el.setAttribute('allowpopups', '')
    el.setAttribute('src', initialUrl)
    el.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;'

    const syncHistory = (): void =>
      setRuntime(tab.id, { canGoBack: el.canGoBack(), canGoForward: el.canGoForward() })

    const handlers: Record<string, (e: never) => void> = {
      'dom-ready': () => webviews.bindContents(tab.id, el.getWebContentsId()),
      'did-start-loading': () => setRuntime(tab.id, { loading: true, error: null }),
      'did-stop-loading': () => {
        setRuntime(tab.id, { loading: false })
        syncHistory()
      },
      'did-navigate': (e: Electron.DidNavigateEvent) => {
        updateTab(tab.id, { url: e.url })
        syncHistory()
      },
      // Most webmails are SPAs: keep the in-page (hash/pushState) URL, not just full loads.
      'did-navigate-in-page': (e: Electron.DidNavigateInPageEvent) => {
        if (!e.isMainFrame) return
        updateTab(tab.id, { url: e.url })
        syncHistory()
      },
      'page-title-updated': (e: Electron.PageTitleUpdatedEvent) => updateTab(tab.id, { title: e.title }),
      'did-fail-load': (e: Electron.DidFailLoadEvent) => {
        if (!e.isMainFrame || e.errorCode === ERR_ABORTED) return
        // Like a browser: the address bar (and the saved state) keep the URL that failed.
        if (e.validatedURL) updateTab(tab.id, { url: e.validatedURL })
        setRuntime(tab.id, {
          loading: false,
          error: {
            code: e.errorCode,
            message: describeLoadError(e.errorCode, e.errorDescription),
            url: e.validatedURL
          }
        })
      },
      'render-process-gone': () =>
        setRuntime(tab.id, {
          loading: false,
          error: { code: 0, message: 'La pagina si è interrotta in modo imprevisto.', url: el.getURL() }
        })
    }

    for (const [event, handler] of Object.entries(handlers)) el.addEventListener(event, handler as EventListener)
    container.appendChild(el)
    webviews.register(tab.id, el)

    return () => {
      for (const [event, handler] of Object.entries(handlers)) el.removeEventListener(event, handler as EventListener)
      webviews.unregister(tab.id)
      el.remove()
    }
  }, [tab.id, tab.accountId])

  useEffect(() => {
    if (active) webviews.get(tab.id)?.focus()
  }, [active, tab.id])

  const retry = (): void => {
    const el = webviews.get(tab.id)
    if (!el || !error) return
    if (error.url) el.loadURL(error.url)
    else el.reload()
  }

  return (
    <div
      ref={containerRef}
      aria-hidden={!active}
      // Inactive tabs stay rendered underneath the active one rather than hidden: a hidden
      // webview isn't painted, so screenshots and mouse input from the assistant would fail.
      className={cn('absolute inset-0 bg-background', active ? 'z-10' : 'pointer-events-none z-0')}
    >
      {error && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background p-8">
          <div className="flex max-w-md flex-col items-center gap-5 text-center">
            <div className="flex size-11 items-center justify-center rounded-full bg-hover">
              <TriangleAlert className="size-5 text-muted-foreground" />
            </div>
            <div className="flex flex-col gap-2">
              <h2 className="text-base font-medium">Pagina non disponibile</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{error.message}</p>
              {error.url && (
                <p className="truncate text-xs text-muted-foreground/80 select-text">{error.url}</p>
              )}
            </div>
            <Button variant="outline" onClick={retry}>
              <RotateCw />
              Riprova
            </Button>
            {error.code !== 0 && (
              <span className="text-xs text-muted-foreground/70">Codice errore {error.code}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
