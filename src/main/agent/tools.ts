import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { BrowserWindow, nativeImage, webContents, type NativeImage, type WebContents } from 'electron'
import type { AgentContent, AgentTabInfo } from '@shared/types'
import { recentDownloads } from '../downloads'
import { withUnloadAllowed } from '../unload-guard'
import { pageAgent, type PageScriptArgs } from './page-scripts'
import type { RendererRpc } from './renderer-rpc'
import { saveFile, SaveError } from './save-file'

// Arbitrary but stable id: our helper globals live in this world, invisible to the page's own JS.
const ISOLATED_WORLD = 7311

export class ToolError extends Error {}

type Args = Record<string, unknown>
type Result = AgentContent[]

const text = (value: unknown): Result => [
  { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }
]

const str = (args: Args, key: string): string | undefined =>
  typeof args[key] === 'string' && args[key] !== '' ? (args[key] as string) : undefined
const num = (args: Args, key: string): number | undefined =>
  typeof args[key] === 'number' && Number.isFinite(args[key]) ? (args[key] as number) : undefined

const isHttpUrl = (value: string): boolean => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

const sameUrl = (a: string, b: string): boolean => {
  try {
    return new URL(a).href.replace(/\/$/, '') === new URL(b).href.replace(/\/$/, '')
  } catch {
    return a === b
  }
}

/**
 * Resolves once the main frame commits a navigation (full or in-page) or fails.
 * true = something committed (even back to the same URL after a redirect).
 */
function nextCommit(wc: WebContents, timeout = 10000): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (committed: boolean): void => {
      clearTimeout(timer)
      wc.off('did-navigate', navigated)
      wc.off('did-navigate-in-page', inPage)
      wc.off('did-fail-load', failed)
      resolve(committed)
    }
    const navigated = (): void => finish(true)
    const inPage = (_e: unknown, _url: string, isMainFrame: boolean): void => {
      if (isMainFrame) finish(true)
    }
    const failed = (_e: unknown, code: number, _d: string, _u: string, isMainFrame: boolean): void => {
      if (isMainFrame && code !== -3) finish(true)
    }
    const timer = setTimeout(() => finish(false), timeout)
    wc.on('did-navigate', navigated)
    wc.on('did-navigate-in-page', inPage)
    wc.on('did-fail-load', failed)
  })
}

async function settle(wc: WebContents, initialWait = 350): Promise<void> {
  await delay(initialWait)
  if (wc.isDestroyed() || !wc.isLoading()) return
  await Promise.race([once(wc, 'did-stop-loading'), delay(15000)])
}

// Chromium occasionally leaves a guest pointing at a stale frame for a moment (process
// swaps during load): retry briefly before giving up.
async function withFrameRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run()
    } catch (err) {
      const stale = err instanceof Error && err.message.includes('Render frame was disposed')
      if (!stale) throw err
      if (attempt >= 3) {
        throw new ToolError('la pagina non risponde (frame non disponibile): ricaricala con navigate url="reload"')
      }
      await delay(400)
    }
  }
}

async function runInPage<T>(
  wc: WebContents,
  op: string,
  args: PageScriptArgs = {},
  userGesture = false
): Promise<T> {
  const code = `(${pageAgent.toString()})(${JSON.stringify({ ...args, op })})`
  const result = (await withFrameRetry(() =>
    wc.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [{ code }], userGesture)
  )) as T & { error?: string }
  if (result && typeof result === 'object' && 'error' in result && result.error) {
    throw new ToolError(result.error)
  }
  return result
}

const KEY_ALIASES: Record<string, string> = {
  enter: 'Enter', return: 'Enter', tab: 'Tab', esc: 'Escape', escape: 'Escape',
  backspace: 'Backspace', delete: 'Delete', del: 'Delete', space: 'Space',
  arrowup: 'Up', up: 'Up', arrowdown: 'Down', down: 'Down', arrowleft: 'Left', left: 'Left',
  arrowright: 'Right', right: 'Right', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown'
}
const MODIFIERS: Record<string, 'control' | 'shift' | 'alt' | 'meta'> = {
  ctrl: 'control', control: 'control', shift: 'shift', alt: 'alt', meta: 'meta', cmd: 'meta', win: 'meta'
}

function pressKey(wc: WebContents, combo: string): void {
  const parts = combo.split('+').map((p) => p.trim()).filter(Boolean)
  const keyPart = parts.pop()
  if (!keyPart) throw new ToolError(`tasto non valido: "${combo}"`)
  const modifiers = parts.map((p) => {
    const mod = MODIFIERS[p.toLowerCase()]
    if (!mod) throw new ToolError(`modificatore sconosciuto: "${p}"`)
    return mod
  })
  const keyCode = KEY_ALIASES[keyPart.toLowerCase()] ?? keyPart
  wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
  // Printable keys and Enter also need a 'char' event, or inputs and forms don't react.
  const noCtrl = !modifiers.includes('control') && !modifiers.includes('meta') && !modifiers.includes('alt')
  if (noCtrl && (keyPart.length === 1 || keyCode === 'Enter')) {
    wc.sendInputEvent({ type: 'char', keyCode: keyCode === 'Enter' ? '\r' : keyPart, modifiers })
  }
  wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
}

// Pages without a background are transparent: composite them on white like a browser
// would, otherwise the JPEG turns those pixels black. Bitmap is premultiplied BGRA.
function onWhite(image: NativeImage): NativeImage {
  const { width, height } = image.getSize()
  const px = Buffer.from(image.toBitmap())
  for (let i = 0; i < px.length; i += 4) {
    const transparency = 255 - px[i + 3]
    if (transparency === 0) continue
    px[i] += transparency
    px[i + 1] += transparency
    px[i + 2] += transparency
    px[i + 3] = 255
  }
  return nativeImage.createFromBitmap(px, { width, height })
}

// A minimised window stops painting and drops real mouse input to its webviews.
const windowMinimized = (wc: WebContents): boolean => {
  const host = wc.hostWebContents
  const win = host ? BrowserWindow.fromWebContents(host) : null
  return Boolean(win?.isMinimized())
}

async function clickAt(wc: WebContents, x: number, y: number, clickCount: number): Promise<void> {
  wc.sendInputEvent({ type: 'mouseMove', x, y })
  for (let i = 1; i <= clickCount; i++) {
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: i })
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: i })
  }
}

export function createTools(rpc: RendererRpc, bindings: Map<string, number>, onActivity: (tabId: string) => void) {
  async function resolveTab(args: Args): Promise<{ tab: AgentTabInfo; wc: WebContents }> {
    const tabs = await rpc.call<AgentTabInfo[]>('list')
    const wanted = str(args, 'tab_id')
    const tab = wanted ? tabs.find((t) => t.tabId === wanted) : tabs.find((t) => t.active)
    if (!tab) {
      throw new ToolError(wanted ? `nessuna scheda con id ${wanted}: usa list_tabs` : 'nessuna scheda aperta')
    }
    const wcId = bindings.get(tab.tabId)
    const wc = wcId !== undefined ? webContents.fromId(wcId) : undefined
    if (!wc || wc.isDestroyed()) throw new ToolError('la scheda non ha ancora finito di aprirsi, riprova tra poco')
    onActivity(tab.tabId)
    return { tab, wc }
  }

  async function waitForBinding(tabId: string): Promise<WebContents> {
    for (let i = 0; i < 100; i++) {
      const id = bindings.get(tabId)
      const wc = id !== undefined ? webContents.fromId(id) : undefined
      if (wc) return wc
      await delay(100)
    }
    throw new ToolError('la nuova scheda non si è aperta in tempo')
  }

  const pageState = (wc: WebContents): string => `URL: ${wc.getURL()}\nTitolo: ${wc.getTitle()}`

  const tools: Record<string, (args: Args) => Promise<Result>> = {
    async list_accounts() {
      return text(await rpc.call('accounts'))
    },

    async list_tabs() {
      return text(await rpc.call('list'))
    },

    async open_tab(args) {
      const account = str(args, 'account')
      const url = str(args, 'url')
      if (!account) throw new ToolError('specifica account (id o nome)')
      if (url && !isHttpUrl(url)) throw new ToolError('url deve essere http(s)')
      const tabId = await rpc.call<string>('open', {
        account,
        environment: str(args, 'environment'),
        url,
        background: args.background === true
      })
      const wc = await waitForBinding(tabId)
      onActivity(tabId)
      await settle(wc, 600)
      return text(`Scheda aperta: ${tabId}\n${pageState(wc)}`)
    },

    async select_tab(args) {
      const { tab } = await resolveTab(args)
      await rpc.call('select', { tabId: tab.tabId })
      return text(`Scheda attiva: ${tab.tabId} (${tab.accountName})`)
    },

    async close_tab(args) {
      const { tab } = await resolveTab(args)
      await rpc.call('close', { tabId: tab.tabId })
      return text(`Scheda chiusa: ${tab.tabId}`)
    },

    async navigate(args) {
      const { wc } = await resolveTab(args)
      const target = str(args, 'url')
      if (!target) throw new ToolError('specifica url, oppure "back", "forward" o "reload"')
      const history = wc.navigationHistory
      const before = wc.getURL()

      let committed = false
      await withUnloadAllowed(wc, async () => {
        const commit = nextCommit(wc)
        if (target === 'back') {
          if (!history.canGoBack()) throw new ToolError('nessuna pagina precedente')
          history.goBack()
        } else if (target === 'forward') {
          if (!history.canGoForward()) throw new ToolError('nessuna pagina successiva')
          history.goForward()
        } else if (target === 'reload' || sameUrl(before, target)) {
          wc.reload()
        } else {
          if (!isHttpUrl(target)) throw new ToolError('url deve essere http(s)')
          // loadURL rejects on aborted redirects too: the final state is checked below anyway.
          wc.loadURL(target).catch(() => undefined)
        }
        committed = await commit
        await settle(wc, 300)

        // Some SPAs swallow a navigation to their own origin and keep the old view:
        // retry as a hard navigation from inside the page.
        if (!committed && isHttpUrl(target)) {
          const retried = nextCommit(wc)
          await wc.executeJavaScript(`location.assign(${JSON.stringify(target)})`).catch(() => undefined)
          committed = await retried
          await settle(wc, 300)
        }
      })

      const unchanged = !committed && sameUrl(wc.getURL(), before)
      return text(
        (unchanged ? `Attenzione: la pagina è rimasta su ${before}, la navigazione è stata ignorata.
` : '') +
          pageState(wc)
      )
    },

    async save_file(args) {
      const { wc } = await resolveTab(args)
      const path = str(args, 'path')
      if (!path) throw new ToolError('specifica path (file o cartella, percorso assoluto)')
      let url = str(args, 'url')
      const ref = str(args, 'ref')
      if (!url && ref) url = (await runInPage<{ url: string }>(wc, 'source', { ref })).url
      if (!url) throw new ToolError("specifica url oppure ref di un'immagine, link o media")
      try {
        const saved = await saveFile(wc, url, path, args.overwrite === true)
        return text(`Salvato: ${saved.path}
Dimensione: ${saved.bytes} byte
Tipo: ${saved.mime}`)
      } catch (err) {
        throw new ToolError(err instanceof SaveError ? `download non riuscito: ${err.message}` : String(err))
      }
    },

    async list_downloads(args) {
      const limit = Math.min(Math.max(num(args, 'limit') ?? 10, 1), 50)
      const tabByContents = new Map([...bindings].map(([tabId, wcId]) => [wcId, tabId]))
      const list = recentDownloads()
        .slice(0, limit)
        .map(({ webContentsId, ...d }) => ({
          ...d,
          tabId: webContentsId !== undefined ? tabByContents.get(webContentsId) : undefined
        }))
      return text(list.length ? list : "Nessun download in questa sessione dell'app.")
    },

    async get_page_text(args) {
      const { wc } = await resolveTab(args)
      const r = await runInPage<{ url: string; title: string; text: string }>(wc, 'text', {
        maxChars: num(args, 'max_chars')
      })
      return text(`URL: ${r.url}\nTitolo: ${r.title}\n\n${r.text}`)
    },

    async read_page(args) {
      const { wc } = await resolveTab(args)
      const r = await runInPage<{ url: string; title: string; viewport: unknown; tree: string }>(wc, 'read', {
        filter: args.filter === 'all' ? 'all' : 'interactive',
        maxChars: num(args, 'max_chars')
      })
      return text(`URL: ${r.url}\nTitolo: ${r.title}\nViewport: ${JSON.stringify(r.viewport)}\n\n${r.tree}`)
    },

    async find(args) {
      const { wc } = await resolveTab(args)
      const query = str(args, 'query')
      if (!query) throw new ToolError('specifica query')
      const matches = await runInPage<string[]>(wc, 'find', { query })
      return text(matches.length ? matches.join('\n') : `Nessun elemento corrisponde a "${query}"`)
    },

    async click(args) {
      const { wc } = await resolveTab(args)
      const ref = str(args, 'ref')
      let x = num(args, 'x')
      let y = num(args, 'y')
      if (!ref && (x === undefined || y === undefined)) throw new ToolError('specifica ref oppure x e y')
      if (ref) ({ x, y } = await runInPage<{ x: number; y: number }>(wc, 'locate', { ref }))
      const hit = await runInPage<{ label: string }>(wc, 'hit', { x, y })

      const minimized = windowMinimized(wc)
      let delivered = false
      if (!minimized) {
        await runInPage(wc, 'probe-install')
        await clickAt(wc, x!, y!, args.double === true ? 2 : 1)
        await delay(150)
        delivered = wc.isLoading() || (await runInPage<{ pointer: boolean }>(wc, 'probe-read')).pointer
      }
      // Real input never reached the page (window minimised, or not painted): use DOM events.
      let note = ''
      if (!delivered) {
        await runInPage(wc, 'activate', ref ? { ref } : { x, y }, true)
        note = minimized
          ? ' (simulato nel DOM: la finestra di MultiSession è minimizzata)'
          : ' (simulato nel DOM: il click reale non è arrivato alla pagina)'
      }
      await settle(wc)
      return text(`Click su (${x}, ${y}) → ${hit.label}${note}.\n${pageState(wc)}`)
    },

    async type(args) {
      const { wc } = await resolveTab(args)
      const value = typeof args.text === 'string' ? args.text : undefined
      if (value === undefined) throw new ToolError('specifica text')
      const ref = str(args, 'ref')
      wc.focus()
      if (ref) await runInPage(wc, 'focus', { ref })
      if (args.clear === true) await runInPage(wc, 'select-all')
      // insertText produces trusted input events, like real typing.
      await wc.insertText(value)
      if (args.submit !== true) {
        await settle(wc, 100)
        return text(`Testo inserito (${value.length} caratteri).`)
      }

      // Rich editors (ProseMirror, React state) need a beat to register the text before Enter.
      await delay(200)
      await runInPage(wc, 'probe-install')
      pressKey(wc, 'Enter')
      await delay(300)
      const probe = await runInPage<{ key: boolean; navigated?: boolean }>(wc, 'probe-read')
      let note = ''
      if (!probe.key) {
        await runInPage(wc, 'dom-enter', {}, true)
        note = ' Invio simulato nel DOM: il tasto reale non è arrivato alla pagina.'
      }
      await settle(wc, 400)
      if (!probe.navigated) {
        const { text: left } = await runInPage<{ text: string }>(wc, 'field-text')
        if (left.trim() && left.includes(value.trim().slice(0, 40))) {
          note +=
            " Attenzione: il testo è ancora nel campo, quindi l'invio probabilmente non è partito: premi il pulsante di invio con click."
        }
      }
      return text(`Testo inserito (${value.length} caratteri) e Invio premuto.${note}\n${pageState(wc)}`)
    },

    async press_key(args) {
      const { wc } = await resolveTab(args)
      const keys = str(args, 'keys')
      if (!keys) throw new ToolError('specifica keys, es. "Enter" o "ctrl+a"')
      wc.focus()
      await runInPage(wc, 'probe-install')
      for (const combo of keys.split(/\s+/)) {
        pressKey(wc, combo)
        await delay(30)
      }
      await delay(150)
      const probe = await runInPage<{ key: boolean }>(wc, 'probe-read')
      await settle(wc, 250)
      const warning = probe.key
        ? ''
        : 'Attenzione: i tasti non sono arrivati alla pagina (finestra minimizzata o non disegnata).\n'
      return text(`${warning}Tasti premuti: ${keys}\n${pageState(wc)}`)
    },

    async scroll(args) {
      const { wc } = await resolveTab(args)
      const direction = str(args, 'direction') ?? 'down'
      const amount = Math.min(Math.max(num(args, 'amount') ?? 3, 1), 20)
      const ref = str(args, 'ref')
      let x = num(args, 'x')
      let y = num(args, 'y')
      if (ref) ({ x, y } = await runInPage<{ x: number; y: number }>(wc, 'locate', { ref }))
      const step = 100 * amount
      const dx = direction === 'left' ? -step : direction === 'right' ? step : 0
      const dy = direction === 'up' ? -step : direction === 'down' ? step : 0
      const r = await runInPage<{ moved: boolean; scrollTop: number; scrollHeight: number; clientHeight: number }>(
        wc,
        'scroll',
        { x, y, dx, dy }
      )
      return text(
        r.moved
          ? `Scroll ${direction}: posizione ${r.scrollTop} di ${r.scrollHeight - r.clientHeight}.`
          : `Nessuno spostamento: il contenuto è già al limite (${direction}).`
      )
    },

    async screenshot(args) {
      const { wc } = await resolveTab(args)
      const viewport = await runInPage<{ width: number; height: number }>(wc, 'viewport')
      // Background tabs repaint lazily: ask for a fresh frame so the capture isn't stale.
      wc.invalidate()
      await delay(200)
      // A minimised window has no frames to capture: capturePage throws or returns empty.
      const image = await wc.capturePage(undefined, { stayHidden: true }).catch(() => nativeImage.createEmpty())
      if (image.isEmpty()) {
        throw new ToolError(
          windowMinimized(wc)
            ? 'screenshot non disponibile: la finestra di MultiSession è minimizzata. Usa read_page/get_page_text, o chiedi di ripristinarla'
            : 'screenshot vuoto: Chromium non ha disegnato la scheda. Riprova tra un attimo, oppure attivala con select_tab'
        )
      }
      // Scale to CSS pixels so coordinates in the image are exactly what click/scroll expect.
      const flat = onWhite(image)
      const scaled = flat.getSize().width !== viewport.width ? flat.resize({ width: viewport.width }) : flat
      return [
        { type: 'image', data: scaled.toJPEG(80).toString('base64'), mimeType: 'image/jpeg' },
        { type: 'text', text: `${pageState(wc)}\nDimensioni: ${viewport.width}×${viewport.height} (coordinate valide per click/scroll)` }
      ]
    },

    async javascript(args) {
      const { wc } = await resolveTab(args)
      const code = str(args, 'code')
      if (!code) throw new ToolError('specifica code')
      // Electron only says "Script failed to execute": the real error goes to the page console.
      const consoleErrors: string[] = []
      const onConsole = (...params: unknown[]): void => {
        const [first, level, message] = params as [{ level?: unknown; message?: string }, unknown, string]
        const lvl = first?.level ?? level
        if (lvl === 'error' || lvl === 3) consoleErrors.push(first?.message ?? message)
      }
      wc.on('console-message', onConsole)
      try {
        const result = await withFrameRetry(() => wc.executeJavaScript(code, true))
        return text(result === undefined ? 'undefined' : result)
      } catch (err) {
        await delay(50)
        const reason = consoleErrors.at(-1) ?? (err instanceof Error ? err.message : String(err))
        throw new ToolError(`errore nello script: ${reason}`)
      } finally {
        wc.off('console-message', onConsole)
      }
    }
  }

  return tools
}
